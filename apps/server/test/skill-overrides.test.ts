import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HookFile } from "../src/services/agent-config/hooks";
import {
  decidingOverride,
  highestFirst,
  type OverrideFile,
  type OverrideValue,
  planOverride,
  readOverrides,
  renderOverride,
} from "../src/services/agent-config/skill-overrides";
import { ServiceError } from "../src/services/errors";
import { removeTree } from "./support/remove-tree";

/**
 * The rewrite of `skillOverrides` in a person's Claude Code settings files, without the service
 * around it (`agent-config-skills.test.ts` has the switch end to end): which file decides a
 * skill, which one a switch writes, and that everything outside that one value stays byte for
 * byte.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-skill-overrides-"));
});
afterEach(() => removeTree(dir));

function put(name: string, text: string): string {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof ServiceError ? `${error.status} ${error.code}` : String(error);
  }
  return "no error";
};

/** The text before and after the `skillOverrides` value (an object without nested ones). */
function around(text: string): { head: string; tail: string } {
  const key = text.indexOf('"skillOverrides"');
  const open = text.indexOf("{", key);
  const close = text.indexOf("}", open);
  return { head: text.slice(0, open), tail: text.slice(close + 1) };
}

describe("renderOverride", () => {
  const TABS =
    '{\n\t"model": "opus",\n\t"skillOverrides": {\n\t\t"deploy": "off",\n\t\t"lint": "name-only"\n\t},\n\t"hooks": {"Stop": []}\n}\n';
  const CRLF_NO_NEWLINE =
    '{\r\n    "permissions" : { "allow" : [ "Bash(ls:*)" ] },\r\n      "skillOverrides" :   {"deploy":"off",   "lint":"name-only"},\r\n  "env":{"A":"1"}\r\n}';
  const ONE_LINE = '{"a":1,"skillOverrides":{"deploy":"off","lint":"name-only"},"z":[1,{"b":2}]}';
  const LAYOUTS = { TABS, CRLF_NO_NEWLINE, ONE_LINE };

  const CHANGES: Array<[string, OverrideValue | undefined, Record<string, string>]> = [
    ["review", "off", { deploy: "off", lint: "name-only", review: "off" }],
    ["deploy", "user-invocable-only", { deploy: "user-invocable-only", lint: "name-only" }],
    ["lint", "on", { deploy: "off", lint: "on" }],
    ["deploy", undefined, { lint: "name-only" }],
  ];

  for (const [layout, text] of Object.entries(LAYOUTS)) {
    it(`sets, changes and removes one name, keeping the rest byte for byte (${layout})`, () => {
      const file = put("settings.json", text);
      const { head, tail } = around(text);
      for (const [name, value, overrides] of CHANGES) {
        const change = renderOverride(file, name, value);
        expect(change).toMatchObject({ before: text, existed: true, changed: true });
        expect(change.after.startsWith(head)).toBe(true);
        expect(change.after.endsWith(tail)).toBe(true);
        expect(JSON.parse(change.after)).toEqual({
          ...JSON.parse(text),
          skillOverrides: overrides,
        });
        // The entries that stay keep their order, a new one goes last.
        expect(Object.keys(JSON.parse(change.after).skillOverrides)).toEqual(
          Object.keys(overrides),
        );
      }
    });
  }

  it("keeps an emptied skillOverrides in place", () => {
    const text = '{\n  "skillOverrides": {\n    "deploy": "off"\n  },\n  "model": "opus"\n}\n';
    const change = renderOverride(put("settings.json", text), "deploy", undefined);
    expect(change.after).toBe('{\n  "skillOverrides": {},\n  "model": "opus"\n}\n');
  });

  it("changes nothing for a value already set or a name already absent", () => {
    const file = put("settings.json", TABS);
    for (const [name, value] of [
      ["deploy", "off"],
      ["lint", "name-only"],
      ["review", undefined],
    ] as const) {
      expect(renderOverride(file, name, value)).toEqual({
        before: TABS,
        after: TABS,
        existed: true,
        changed: false,
      });
    }
  });

  it("adds skillOverrides to a file without it, after the other settings", () => {
    const text = '{\n    "model": "opus",\n    "env": { "A": "1" }\n}\n';
    const change = renderOverride(put("settings.json", text), "lint", "off");
    expect(change).toMatchObject({ existed: true, changed: true });
    expect(change.after.startsWith('{\n    "model": "opus",\n    "env": { "A": "1" }')).toBe(true);
    expect(change.after.endsWith("\n}\n")).toBe(true);
    expect(JSON.parse(change.after)).toEqual({
      model: "opus",
      env: { A: "1" },
      skillOverrides: { lint: "off" },
    });

    const empty = renderOverride(put("empty-object.json", "{}\n"), "lint", "off");
    expect(empty.after.endsWith("\n")).toBe(true);
    expect(JSON.parse(empty.after)).toEqual({ skillOverrides: { lint: "off" } });
  });

  it("replaces a skillOverrides that is not an object", () => {
    for (const value of ["null", '"off"', '["deploy"]', "3"]) {
      const text = `{\n  "skillOverrides": ${value},\n  "model": "opus"\n}\n`;
      const change = renderOverride(put("settings.json", text), "deploy", "off");
      expect(change.changed).toBe(true);
      expect(change.after).toBe(
        '{\n  "skillOverrides": {\n    "deploy": "off"\n  },\n  "model": "opus"\n}\n',
      );
    }
  });

  it("writes a whole document for an empty or missing file", () => {
    const whole = '{\n  "skillOverrides": {\n    "deploy": "off"\n  }\n}\n';
    for (const text of ["", "  \n\n"]) {
      expect(renderOverride(put("settings.json", text), "deploy", "off")).toEqual({
        before: text,
        after: whole,
        existed: true,
        changed: true,
      });
    }
    const missing = join(dir, "none", "settings.json");
    expect(renderOverride(missing, "deploy", "off")).toEqual({
      before: "",
      after: whole,
      existed: false,
      changed: true,
    });
    // Switching on what nothing switches off creates no file.
    expect(renderOverride(missing, "deploy", undefined)).toEqual({
      before: "",
      after: "",
      existed: false,
      changed: false,
    });
  });

  it("keeps a skill name that looks like an object key as a plain entry", () => {
    const text = '{\n  "skillOverrides": {\n    "deploy": "off"\n  }\n}\n';
    const change = renderOverride(put("settings.json", text), "__proto__", "off");
    expect(change.after).toBe(
      '{\n  "skillOverrides": {\n    "deploy": "off",\n    "__proto__": "off"\n  }\n}\n',
    );
  });

  it("refuses a file it can't parse: comments, a list, broken JSON", () => {
    for (const text of [
      '{\n  // my settings\n  "skillOverrides": { "deploy": "off" }\n}\n',
      '["deploy"]',
      "{ not json",
      "null",
    ]) {
      const file = put("settings.json", text);
      expect(errorCode(() => renderOverride(file, "deploy", "on"))).toBe("422 config_unparsable");
    }
  });
});

describe("which settings file decides a skill", () => {
  const source = (scope: HookFile["scope"], file: string): HookFile => ({
    provider: "claude",
    scope,
    projectId: scope === "user" ? null : "p1",
    root: scope === "user" ? "/home/me" : "/repo",
    file,
  });
  const overrideFile = (
    scope: HookFile["scope"],
    file: string,
    overrides: Record<string, OverrideValue> = {},
  ): OverrideFile => ({
    source: source(scope, file),
    overrides: new Map(Object.entries(overrides)),
  });

  const USER = "/home/me/.claude/settings.json";
  const PROJECT = "/repo/.claude/settings.json";
  const LOCAL_ROOT = "/repo/.claude/settings.local.json";
  const LOCAL_CWD = "/repo/packages/app/.claude/settings.local.json";
  /** Lowest first, as the service lists them. */
  const files = (overrides: Partial<Record<string, Record<string, OverrideValue>>> = {}) => [
    overrideFile("user", USER, overrides[USER]),
    overrideFile("project", PROJECT, overrides[PROJECT]),
    overrideFile("local", LOCAL_ROOT, overrides[LOCAL_ROOT]),
    overrideFile("local", LOCAL_CWD, overrides[LOCAL_CWD]),
  ];
  const paths = (list: OverrideFile[]) => list.map((f) => f.source.file);

  it("orders local before project before user, the repository-root local file first", () => {
    expect(paths(highestFirst(files()))).toEqual([LOCAL_ROOT, LOCAL_CWD, PROJECT, USER]);
    expect(highestFirst([])).toEqual([]);
    expect(paths(highestFirst(files().slice(0, 2)))).toEqual([PROJECT, USER]);
  });

  it("lets the highest file that sets a name decide it", () => {
    const decided = (overrides: Parameters<typeof files>[0], name = "deploy") => {
      const found = decidingOverride(highestFirst(files(overrides)), name);
      return found ? [found.file.source.file, found.value] : null;
    };
    expect(decided({})).toBeNull();
    expect(decided({ [USER]: { deploy: "off" } })).toEqual([USER, "off"]);
    expect(decided({ [USER]: { deploy: "off" }, [PROJECT]: { deploy: "on" } })).toEqual([
      PROJECT,
      "on",
    ]);
    expect(
      decided({
        [USER]: { deploy: "off" },
        [PROJECT]: { deploy: "on" },
        [LOCAL_CWD]: { deploy: "name-only" },
      }),
    ).toEqual([LOCAL_CWD, "name-only"]);
    expect(
      decided({ [LOCAL_CWD]: { deploy: "name-only" }, [LOCAL_ROOT]: { deploy: "off" } }),
    ).toEqual([LOCAL_ROOT, "off"]);
    // A file that sets other names doesn't decide this one.
    expect(decided({ [LOCAL_ROOT]: { lint: "off" }, [USER]: { deploy: "off" } })).toEqual([
      USER,
      "off",
    ]);
  });

  describe("planOverride", () => {
    const userFile = source("user", USER);
    const plan = (overrides: Parameters<typeof files>[0], enabled: boolean) => {
      const { target, value } = planOverride(files(overrides), userFile, "deploy", enabled);
      return [target.file, value];
    };

    it("writes the user file when no file decides the name", () => {
      expect(plan({}, false)).toEqual([USER, "off"]);
      expect(plan({}, true)).toEqual([USER, undefined]);
      expect(plan({ [PROJECT]: { lint: "off" } }, false)).toEqual([USER, "off"]);
      // The user file given, even when it is not among the files read.
      const { target } = planOverride([], userFile, "deploy", false);
      expect(target).toBe(userFile);
    });

    it("writes the file that decides the name", () => {
      const project = {
        [USER]: { deploy: "on" as const },
        [PROJECT]: { deploy: "name-only" as const },
      };
      expect(plan(project, false)).toEqual([PROJECT, "off"]);
      const local = { ...project, [LOCAL_CWD]: { deploy: "off" as const } };
      expect(plan(local, false)).toEqual([LOCAL_CWD, "off"]);
      expect(plan({ ...local, [LOCAL_ROOT]: { deploy: "on" as const } }, false)).toEqual([
        LOCAL_ROOT,
        "off",
      ]);
    });

    it("switches on by removing the entry, unless a lower file would then decide otherwise", () => {
      expect(plan({ [USER]: { deploy: "off" } }, true)).toEqual([USER, undefined]);
      expect(plan({ [PROJECT]: { deploy: "off" } }, true)).toEqual([PROJECT, undefined]);
      // Below it only "on", or nothing: removing is enough.
      expect(plan({ [PROJECT]: { deploy: "off" }, [USER]: { deploy: "on" } }, true)).toEqual([
        PROJECT,
        undefined,
      ]);
      // Below it the skill is off or limited: the deciding file says "on" itself.
      expect(plan({ [PROJECT]: { deploy: "off" }, [USER]: { deploy: "off" } }, true)).toEqual([
        PROJECT,
        "on",
      ]);
      expect(
        plan({ [LOCAL_ROOT]: { deploy: "off" }, [USER]: { deploy: "name-only" } }, true),
      ).toEqual([LOCAL_ROOT, "on"]);
      // Only the next file that sets it counts, not one further down.
      expect(
        plan(
          {
            [LOCAL_ROOT]: { deploy: "off" },
            [PROJECT]: { deploy: "on" },
            [USER]: { deploy: "off" },
          },
          true,
        ),
      ).toEqual([LOCAL_ROOT, undefined]);
    });
  });
});

describe("readOverrides", () => {
  const sourceOf = (file: string, root = dir): HookFile => ({
    provider: "claude",
    scope: "user",
    projectId: null,
    root,
    file,
  });

  it("reads the known values and ignores the rest", () => {
    const file = put(
      "home/.claude/settings.json",
      JSON.stringify({
        skillOverrides: {
          deploy: "off",
          lint: "name-only",
          review: "user-invocable-only",
          release: "on",
          odd: "sometimes",
          flag: false,
          nested: { off: true },
        },
      }),
    );
    const read = readOverrides(sourceOf(file), true);
    expect(read.error).toBeUndefined();
    expect([...read.overrides]).toEqual([
      ["deploy", "off"],
      ["lint", "name-only"],
      ["review", "user-invocable-only"],
      ["release", "on"],
    ]);
  });

  it("sets nothing for a missing or empty file, or a skillOverrides that is not an object", () => {
    for (const file of [
      join(dir, "missing", "settings.json"),
      put("empty.json", ""),
      put("no-overrides.json", '{ "model": "opus" }'),
      put("list.json", '{ "skillOverrides": ["deploy"] }'),
    ]) {
      const read = readOverrides(sourceOf(file), true);
      expect(read.error).toBeUndefined();
      expect(read.overrides.size).toBe(0);
    }
  });

  it("refuses a file that does not parse with strict, and sets nothing without", () => {
    for (const text of ["{ not json", '["deploy"]', '{ /* mine */ "skillOverrides": {} }']) {
      const source = sourceOf(put("settings.json", text));
      expect(errorCode(() => readOverrides(source, true))).toBe("422 config_unparsable");
      const read = readOverrides(source);
      expect(read.source).toBe(source);
      expect(read.overrides.size).toBe(0);
      expect(read.error).toContain("could not be parsed");
    }
  });

  it("refuses a link leading outside its folder with strict, and sets nothing without", () => {
    const home = join(dir, "home");
    mkdirSync(home);
    put("outside/settings.json", JSON.stringify({ skillOverrides: { deploy: "off" } }));
    // The `.claude` folder links outside home (a junction needs no rights on Windows).
    symlinkSync(join(dir, "outside"), join(home, ".claude"), "junction");
    const source = sourceOf(join(home, ".claude", "settings.json"), home);

    expect(errorCode(() => readOverrides(source, true))).toBe("403 path_outside_root");
    const read = readOverrides(source);
    expect(read.overrides.size).toBe(0);
    expect(read.error).toContain("resolves outside");

    // The same file reached without the link is read.
    const direct = sourceOf(join(dir, "outside", "settings.json"), join(dir, "outside"));
    expect([...readOverrides(direct, true).overrides]).toEqual([["deploy", "off"]]);
  });
});
