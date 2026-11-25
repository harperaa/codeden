/** The wordmark: the product name in two parts, whatever a fork is called. */
import { describe, expect, it } from "vitest";
import {
  HARDEN_BRAND_RED,
  HARDEN_BRAND_RED_ON_DARK,
  HARDEN_FAVICON_PATH,
  HARDEN_MARK,
  HARDEN_PUBLIC_ICON_PATHS,
  hardenWordmark,
  hardenWordmarkHtml,
} from "../src/index";

describe("the wordmark", () => {
  it("splits CodeHarden into Code and Harden", () => {
    expect(hardenWordmark()).toEqual({ lead: "Code", accent: "Harden" });
    expect(hardenWordmark("CodeForge")).toEqual({ lead: "Code", accent: "Forge" });
  });

  it("writes a name of another shape whole, in the text colour", () => {
    expect(hardenWordmark("Acme Den")).toEqual({ lead: "Acme Den", accent: "" });
    expect(hardenWordmark("Code")).toEqual({ lead: "Code", accent: "" });
    expect(hardenWordmark("codeharden")).toEqual({ lead: "codeharden", accent: "" });
  });

  it("as HTML uses the red that reads on the page's ground, and reads as the plain name", () => {
    expect(hardenWordmarkHtml("light")).toBe(
      `Code<span style="color:${HARDEN_BRAND_RED}">Harden</span>`,
    );
    expect(hardenWordmarkHtml("dark")).toBe(
      `Code<span style="color:${HARDEN_BRAND_RED_ON_DARK}">Harden</span>`,
    );
    expect(hardenWordmarkHtml("dark", "Acme Den")).toBe("Acme Den");
    expect(hardenWordmarkHtml("light", "A<b>&")).toBe("A&#60;b&#62;&#38;");
  });
});

describe("the mark and the icons", () => {
  it("the mark has shapes in the two colours", () => {
    expect(HARDEN_MARK.viewBox).toBe("0 0 32 32");
    expect(HARDEN_MARK.shapes.map((shape) => shape.fill).sort()).toEqual(["ink", "paper"]);
    expect(HARDEN_BRAND_RED).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("the product's icons are served from their own folder", () => {
    expect(HARDEN_FAVICON_PATH).toBe("/harden/favicon.svg");
    expect(HARDEN_PUBLIC_ICON_PATHS).toHaveLength(6);
    for (const path of HARDEN_PUBLIC_ICON_PATHS) expect(path).toMatch(/^\/harden\//);
  });
});
