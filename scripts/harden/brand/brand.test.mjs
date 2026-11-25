// The committed logo and icon files are what `make.mjs` writes from `mark.svg`: the text files
// are compared in full, the images by their format and size (drawing them needs a browser, so
// `pnpm test` does not redraw them).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  brandColors,
  brandCss,
  contrast,
  faviconFile,
  markModule,
  OUTPUTS,
  readMark,
  SURFACES,
  templateSvg,
  tintFor,
} from "./brand.mjs";

const path = (file) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));
const read = (file) => readFileSync(path(file));
const mark = readMark();
const colors = brandColors(mark);

/** Width and height of a PNG, from its header. */
function pngSize(buffer) {
  expect(buffer.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

describe("the brand's one source", () => {
  it("is a two-colour mark: every shape filled with the red or the white, outlined in the red", () => {
    expect(mark.shapes.length).toBeGreaterThan(0);
    expect(new Set(mark.shapes.map((shape) => shape.fill))).toEqual(
      new Set([mark.ink, mark.paper]),
    );
    expect(() => readMark('<svg viewBox="0 0 24 24"></svg>')).toThrow(/viewBox 0 0 32 32/);
    expect(() =>
      readMark('<svg viewBox="0 0 32 32"><path id="a" d="M0 0" fill="red"/></svg>'),
    ).toThrow(/data-fill/);
  });

  it("the red reads on both themes: 3:1 as a graphic, 4.5:1 as the wordmark's text", () => {
    for (const surface of [...Object.values(SURFACES.light), ...Object.values(SURFACES.dark)]) {
      expect(contrast(colors.red, surface), surface).toBeGreaterThanOrEqual(3);
    }
    for (const surface of Object.values(SURFACES.light)) {
      expect(contrast(colors.textOnLight, surface), surface).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of Object.values(SURFACES.dark)) {
      expect(contrast(colors.textOnDark, surface), surface).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(colors.white, colors.red)).toBeGreaterThanOrEqual(3);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(tintFor("#ffffff", ["#000000"])).toBe("#ffffff");
    // A red too dark for the dark theme is refused, not shipped.
    const dim = { ...mark, ink: "#3a0a0f" };
    expect(() => brandColors(dim)).toThrow(/does not reach 3:1/);
  });

  it("the menu-bar template is one colour", () => {
    const fills = [...templateSvg(mark).matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(fills)).toEqual(new Set(["black", "white", "#000000"]));
  });
});

describe("the committed files are the ones make.mjs writes", () => {
  const stale = "run `node scripts/harden/brand/make.mjs` and commit the result";

  it("the text files match mark.svg", () => {
    expect(read(OUTPUTS.favicon).toString(), stale).toBe(faviconFile(mark));
    expect(read(OUTPUTS.module).toString(), stale).toBe(markModule(mark, colors));
    expect(read(OUTPUTS.css).toString(), stale).toBe(brandCss(colors));
  });

  // biome-ignore format: one file per line
  it.each([
    [`${OUTPUTS.web}/icon-192.png`, 192],
    [`${OUTPUTS.web}/icon-512.png`, 512],
    [`${OUTPUTS.web}/maskable-192.png`, 192],
    [`${OUTPUTS.web}/maskable-512.png`, 512],
    [`${OUTPUTS.web}/apple-touch-icon.png`, 180],
    [`${OUTPUTS.desktopBuild}/icon.png`, 1024],
    ...[16, 32, 48, 64, 128, 256, 512].map((size) => [`${OUTPUTS.desktopBuild}/icons/${size}x${size}.png`, size]),
    [`${OUTPUTS.desktopAssets}/icon.png`, 256],
    [`${OUTPUTS.desktopAssets}/tray.png`, 16],
    [`${OUTPUTS.desktopAssets}/tray@2x.png`, 32],
    [`${OUTPUTS.desktopAssets}/trayTemplate.png`, 16],
    [`${OUTPUTS.desktopAssets}/trayTemplate@2x.png`, 32],
  ])("%s is a %i px PNG", (file, size) => {
    expect(pngSize(read(file))).toEqual([size, size]);
  });

  it("the macOS icon holds every size up to 1024 px", () => {
    const icns = read(`${OUTPUTS.desktopBuild}/icon.icns`);
    expect(icns.toString("latin1", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const sizes = [];
    for (let at = 8; at < icns.length; at += icns.readUInt32BE(at + 4)) {
      sizes.push(pngSize(icns.subarray(at + 8))[0]);
    }
    expect([...new Set(sizes)].sort((a, b) => a - b)).toEqual([16, 32, 64, 128, 256, 512, 1024]);
  });

  it("the Windows icon holds 16 to 256 px", () => {
    const ico = read(`${OUTPUTS.desktopBuild}/icon.ico`);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256);
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256]);
    const last = 6 + (count - 1) * 16;
    expect(ico.readUInt32LE(last + 12) + ico.readUInt32LE(last + 8)).toBe(ico.length);
  });

  it("upstream's own images are still in place, untouched by the script", () => {
    for (const file of [
      "apps/web/public/favicon.svg",
      "apps/web/public/icons/icon-512.png",
      "apps/desktop/build/icon.png",
      "apps/desktop/assets/tray.png",
      "apps/desktop/assets/trayTemplate.png",
      "apps/desktop/assets/icon.png",
    ]) {
      expect(existsSync(path(file)), file).toBe(true);
    }
    expect(read("apps/web/public/favicon.svg").toString()).not.toBe(faviconFile(mark));
  });
});
