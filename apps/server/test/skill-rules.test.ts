import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@decimalturn/toml-patch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRuleChange,
  type RuleSkill,
  readRules,
  renderRuleSwitch,
  ruleChange,
  ruleState,
} from "../src/services/agent-config/skill-rules";
import { ServiceError } from "../src/services/errors";
import { removeTree } from "./support/remove-tree";

/**
 * The rewrite of `[[skills.config]]` in a person's Codex `config.toml`, without the service
 * around it (`agent-config-skills.test.ts` has the switch end to end): which rule decides a
 * skill, what a switch does to the list, and that switching off and on again gives the file
 * back as it was.
 */

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-skill-rules-"));
  file = join(dir, "config.toml");
});
afterEach(() => removeTree(dir));

const skill = (name: string, folder = "user"): RuleSkill => ({
  name,
  path: join(tmpdir(), "codeden-skill-rules", folder, "skills", name, "SKILL.md"),
});
const REVIEW = skill("review");
const DEPLOY = skill("deploy");
/** A project skill with the user skill's name, in another folder. */
const PROJECT_REVIEW = skill("review", "project");

/** A path as a TOML basic string. */
const toml = (path: string) => JSON.stringify(path);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof ServiceError ? `${error.status} ${error.code}` : String(error);
  }
  return "no error";
};

/** Apply a switch to the file, as the service writes it; returns the change. */
function flip(target: RuleSkill, byPath: boolean, on: boolean) {
  const change = renderRuleSwitch(file, target, byPath, on);
  if (change.changed) writeFileSync(file, change.after);
  return change;
}
const state = (target: RuleSkill) => ruleState(readRules(file), target);

describe("readRules", () => {
  it("gives the entries in order", () => {
    writeFileSync(
      file,
      `model = "gpt-5"\n\n[[skills.config]]\nname = "review"\nenabled = false\n\n[[skills.config]]\npath = ${toml(DEPLOY.path)}\nenabled = true\n`,
    );
    expect(plain(readRules(file))).toEqual([
      { name: "review", enabled: false },
      { path: DEPLOY.path, enabled: true },
    ]);
  });

  it("gives none for a missing file, one without rules, or one it can't use", () => {
    expect(readRules(file)).toEqual([]);
    for (const text of [
      "",
      'model = "gpt-5"\n',
      "[skills]\n",
      "[[skills.config]\nname = ",
      'skills = "all"\n',
      '[skills]\nconfig = "all"\n',
    ]) {
      writeFileSync(file, text);
      expect(readRules(file)).toEqual([]);
    }
  });
});

describe("ruleState", () => {
  it("leaves a skill on that no rule selects", () => {
    expect(ruleState([], REVIEW)).toEqual({ enabled: true, set: false });
    expect(
      ruleState(
        [
          { name: "deploy", enabled: false },
          { path: DEPLOY.path, enabled: false },
          // Not rules: no `enabled`, or not a table.
          { name: "review" },
          { name: "review", enabled: "false" },
          "review",
          null,
        ],
        REVIEW,
      ),
    ).toEqual({ enabled: true, set: false });
  });

  it("lets the last rule that selects the skill decide", () => {
    const off = { name: "review", enabled: false };
    const on = { path: REVIEW.path, enabled: true };
    expect(ruleState([off], REVIEW)).toEqual({ enabled: false, set: true });
    expect(ruleState([off, on], REVIEW)).toEqual({ enabled: true, set: true });
    expect(ruleState([on, off], REVIEW)).toEqual({ enabled: false, set: true });
    expect(ruleState([on, off, { name: "deploy", enabled: true }], REVIEW)).toEqual({
      enabled: false,
      set: true,
    });
  });

  it("selects by path when a rule has one, whatever its name", () => {
    // Another skill's path with this skill's name: not this skill's rule.
    expect(ruleState([{ path: DEPLOY.path, name: "review", enabled: false }], REVIEW)).toEqual({
      enabled: true,
      set: false,
    });
    expect(
      ruleState([{ path: REVIEW.path, name: "something else", enabled: false }], REVIEW),
    ).toEqual({ enabled: false, set: true });
  });

  it("lets one rule by name decide every skill of that name", () => {
    const rules = [{ name: "review", enabled: false }];
    expect(ruleState(rules, REVIEW).enabled).toBe(false);
    expect(ruleState(rules, PROJECT_REVIEW).enabled).toBe(false);
    expect(ruleState(rules, DEPLOY)).toEqual({ enabled: true, set: false });
  });
});

describe("ruleChange and applyRuleChange", () => {
  const rules = [
    { path: REVIEW.path, enabled: true },
    { name: "review", enabled: false },
    { path: DEPLOY.path, enabled: false },
    { path: REVIEW.path, enabled: false },
    { name: "deploy", enabled: false },
    { path: PROJECT_REVIEW.path, name: "review", enabled: false },
  ];

  it("switches off by path: this skill's path entries go, one is appended", () => {
    const change = ruleChange(rules, REVIEW, true, false);
    expect([...change.drop]).toEqual([0, 3]);
    expect(change.append).toEqual({ path: REVIEW.path, enabled: false });
    expect(applyRuleChange(rules, change)).toEqual([
      rules[1],
      rules[2],
      rules[4],
      rules[5],
      { path: REVIEW.path, enabled: false },
    ]);
  });

  it("switches off by name: this name's entries without a path go, one is appended", () => {
    const change = ruleChange(rules, REVIEW, false, false);
    expect([...change.drop]).toEqual([1]);
    expect(change.append).toEqual({ name: "review", enabled: false });
    const next = applyRuleChange(rules, change);
    expect(next).toHaveLength(rules.length);
    expect(next.at(-1)).toEqual({ name: "review", enabled: false });
    expect(ruleState(next, REVIEW).enabled).toBe(false);
  });

  it("switches on by dropping every entry that selects the skill, by path or by name", () => {
    for (const byPath of [true, false]) {
      const change = ruleChange(rules, REVIEW, byPath, true);
      expect([...change.drop]).toEqual([0, 1, 3]);
      expect(change.append).toBeNull();
      const next = applyRuleChange(rules, change);
      expect(next).toEqual([rules[2], rules[4], rules[5]]);
      expect(ruleState(next, REVIEW)).toEqual({ enabled: true, set: false });
    }
  });

  it("changes nothing to switch on a skill no rule selects", () => {
    const change = ruleChange(rules, skill("lint"), true, true);
    expect(change.drop.size).toBe(0);
    expect(applyRuleChange(rules, change)).toEqual(rules);
    // The list given is never changed itself.
    expect(rules).toHaveLength(6);
  });
});

describe("renderRuleSwitch", () => {
  const HEADER = '# Codex settings\nmodel = "gpt-5" # the default\n\n[features]\nweb = true\n';
  const OTHER_RULE =
    '\n# Not for me\n[[skills.config]]\nname = "deploy"\nenabled = false # for now\n';
  const TEXTS: Record<string, string> = {
    "no rules yet": HEADER,
    "another rule": `${HEADER}${OTHER_RULE}`,
    "a table after the rules": `${HEADER}${OTHER_RULE}\n[profiles.fast]\nmodel = "gpt-5-mini"\n`,
    "Windows line endings": `${HEADER}${OTHER_RULE}`.replaceAll("\n", "\r\n"),
    "no trailing newline": `${HEADER}${OTHER_RULE}`.trimEnd(),
  };

  for (const [name, text] of Object.entries(TEXTS)) {
    for (const byPath of [true, false]) {
      it(`gives the text back after off and on again (${name}, by ${byPath ? "path" : "name"})`, () => {
        writeFileSync(file, text);
        const off = flip(REVIEW, byPath, false);
        expect(off).toMatchObject({ before: text, existed: true, changed: true });
        expect(state(REVIEW)).toEqual({ enabled: false, set: true });
        // Everything else is still there, the other rule included.
        const { skills, ...rest } = plain(parse(off.after)) as { skills: { config: unknown[] } };
        const { skills: _before, ...restBefore } = plain(parse(text)) as Record<string, unknown>;
        expect(rest).toEqual(restBefore);
        expect(skills.config.at(-1)).toEqual(
          byPath ? { path: REVIEW.path, enabled: false } : { name: "review", enabled: false },
        );

        const on = flip(REVIEW, byPath, true);
        expect(on.changed).toBe(true);
        // A file that ended without a line break ends with one afterwards; nothing else differs.
        expect(on.after).toBe(/\n$/.test(text) ? text : `${text}\n`);
        expect(state(REVIEW)).toEqual({ enabled: true, set: false });
      });
    }
  }

  it("creates a missing file, and switching on again leaves it empty", () => {
    const off = flip(REVIEW, true, false);
    expect(off).toMatchObject({ before: "", existed: false, changed: true });
    expect(off.after).toBe(`[[skills.config]]\npath = ${toml(REVIEW.path)}\nenabled = false\n`);
    expect(flip(REVIEW, true, true).after).toBe("");
  });

  it("changes nothing when the switch is already as asked", () => {
    const text = `${HEADER}${OTHER_RULE}`;
    writeFileSync(file, text);
    const same = { before: text, after: text, existed: true, changed: false };
    expect(renderRuleSwitch(file, REVIEW, true, true)).toEqual(same);
    expect(renderRuleSwitch(file, DEPLOY, false, false)).toEqual(same);
    // A missing file stays missing.
    expect(renderRuleSwitch(join(dir, "none.toml"), REVIEW, true, true)).toEqual({
      before: "",
      after: "",
      existed: false,
      changed: false,
    });
  });

  it("switches one of two skills a rule by name matches, and on again frees both", () => {
    const text = `${HEADER}\n[[skills.config]]\nname = "review"\nenabled = false\n`;
    writeFileSync(file, text);
    expect(state(REVIEW).enabled).toBe(false);
    expect(state(PROJECT_REVIEW).enabled).toBe(false);

    // Off by path adds this skill's own entry and leaves the rule by name.
    flip(REVIEW, true, false);
    expect(plain(readRules(file))).toEqual([
      { name: "review", enabled: false },
      { path: REVIEW.path, enabled: false },
    ]);

    // On drops every entry that selects it: the rule by name too, so its namesake is on again.
    const on = flip(REVIEW, true, true);
    expect(on.after).toBe(HEADER);
    expect(state(REVIEW)).toEqual({ enabled: true, set: false });
    expect(state(PROJECT_REVIEW)).toEqual({ enabled: true, set: false });
  });

  it("refuses a file it can't parse and leaves it as it is", () => {
    for (const text of [
      "[[skills.config]\nname = ",
      'skills = "all"\n',
      '[skills]\nconfig = "all"\n',
    ]) {
      writeFileSync(file, text);
      for (const on of [false, true]) {
        expect(errorCode(() => renderRuleSwitch(file, REVIEW, true, on))).toBe(
          "422 config_unparsable",
        );
      }
      expect(readFileSync(file, "utf8")).toBe(text);
      expect(state(REVIEW)).toEqual({ enabled: true, set: false });
    }
  });
});
