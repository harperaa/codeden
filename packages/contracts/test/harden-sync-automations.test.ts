import { describe, expect, it } from "vitest";
import {
  AutomationFileFrontmatter,
  HARDEN_FORK_FILES,
  HARDEN_SYNC_AUTOMATIONS,
  HARDEN_SYNC_LABELS,
  HARDEN_SYNC_TEMPLATES_DIRNAME,
} from "../src/index";

describe("the shipped upstream-sync review automations", () => {
  it("are the first and the second review, with the work keys the hand-made ones had", () => {
    expect(HARDEN_SYNC_AUTOMATIONS).toEqual([
      { id: "upstream-sync-review", workKey: "automation:upstream-sync-review" },
      { id: "upstream-sync-second-review", workKey: "automation:upstream-sync-second-review" },
    ]);
  });

  it("have ids that are file names and work keys a definition accepts", () => {
    for (const { id, workKey } of HARDEN_SYNC_AUTOMATIONS) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      const frontmatter = AutomationFileFrontmatter.parse(
        JSON.parse(JSON.stringify({ name: id, trigger: { type: "manual" }, workKey })),
      );
      expect(frontmatter.workKey).toBe(workKey);
    }
    expect(new Set(HARDEN_SYNC_AUTOMATIONS.map((a) => a.workKey)).size).toBe(2);
  });

  it("are recognised by two files inside the checkout, never by a path that leaves it", () => {
    expect(HARDEN_FORK_FILES).toEqual([
      "scripts/harden/fork-config.sh",
      ".github/workflows/upstream-sync-merge.yml",
    ]);
    for (const file of HARDEN_FORK_FILES) {
      expect(file.startsWith("/")).toBe(false);
      expect(file.split("/")).not.toContain("..");
    }
    expect(HARDEN_SYNC_TEMPLATES_DIRNAME).toMatch(/^[a-z-]+$/);
  });

  it("name the four labels of a sync pull request", () => {
    expect(HARDEN_SYNC_LABELS).toEqual({
      approved: "sync-approved",
      firstPass: "sync-first-pass",
      needsReview: "sync-needs-review",
      hold: "sync-hold",
    });
  });
});
