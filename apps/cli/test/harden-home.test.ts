/**
 * The one line the CLI prints when CodeHarden starts in its own home for the first time and the
 * home it shared with upstream CodeDen is still there. Nothing is moved; it only tells.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oldHomeNotice } from "../src/harden-home";

const USER = join("/Users", "me");
const OWN = join(USER, ".codeharden");
const OLD = join(USER, ".codeden");
const having =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe("the old-home notice", () => {
  it("is given when the old home exists and the new default home doesn't yet", () => {
    const notice = oldHomeNotice(OWN, USER, having(OLD));
    expect(notice).toContain("~/.codeharden");
    expect(notice).toContain("--home ~/.codeden");
    expect(notice).not.toContain("\n");
  });

  it("is not given once the new home exists, or when there was no old home", () => {
    expect(oldHomeNotice(OWN, USER, having(OLD, OWN))).toBeNull();
    expect(oldHomeNotice(OWN, USER, having())).toBeNull();
  });

  it("is not given when the person chose the home (--home or CODEDEN_HOME)", () => {
    expect(oldHomeNotice(OLD, USER, having(OLD))).toBeNull();
    expect(oldHomeNotice(join(USER, "elsewhere"), USER, having(OLD))).toBeNull();
  });
});
