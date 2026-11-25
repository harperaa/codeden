// Makes every CodeHarden logo and icon from the one source, `scripts/harden/brand/mark.svg`:
//
//   packages/contracts/src/harden-mark.ts   the mark's shapes and colours (the UI's logo, the
//                                           wordmark's red on the server's own pages)
//   apps/web/src/harden-brand.css           the colour tokens of both themes
//   apps/web/public/harden/                 favicon.svg, the web-app icons (tile and maskable)
//                                           and the apple-touch icon
//   apps/desktop/build/harden/              the app icon: icon.png (1024), icon.icns (macOS),
//                                           icon.ico (Windows), icons/<n>x<n>.png (Linux)
//   apps/desktop/assets/harden/             the window icon, the tray icon (Windows, Linux) and
//                                           the menu-bar template (macOS), at 1x and 2x
//
// Upstream's own images stay where they are, untouched, so its changes to them never conflict;
// the code and the build point at these instead (`scripts/harden/upstream-drift.test.mjs`).
//
// Run `node scripts/harden/brand/make.mjs` after changing mark.svg and commit the results; a
// second run changes nothing. It needs Playwright's Chromium, which draws the PNGs
// (`pnpm --filter @codeden/web exec playwright install chromium`). The .icns and .ico files
// are written here, so no other tool is needed. `contact-sheet.mjs` draws one preview image.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import {
  appIconAt,
  appIconSvg,
  brandColors,
  brandCss,
  FLAT,
  faviconFile,
  fullBleedSvg,
  MAC,
  markModule,
  markSvg,
  OUTPUTS,
  readMark,
  templateSvg,
} from "./brand.mjs";

const root = resolve(import.meta.dirname, "../../..");
const mark = readMark();
const colors = brandColors(mark);
const appIcon = (size, margin) => appIconAt(mark, size, margin);

const ICNS = [
  ["icp4", 16],
  ["icp5", 32],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];
const ICO = [16, 24, 32, 48, 64, 128, 256];
const LINUX = [16, 32, 48, 64, 128, 256, 512];

/** PNG files: `[path, svg, size]`. */
const pngs = [
  [`${OUTPUTS.web}/icon-192.png`, appIconSvg(mark), 192],
  [`${OUTPUTS.web}/icon-512.png`, appIconSvg(mark), 512],
  // A maskable icon is cropped to a circle of 80% of its side: the mark stays well inside it.
  [`${OUTPUTS.web}/maskable-192.png`, fullBleedSvg(mark, 0.62), 192],
  [`${OUTPUTS.web}/maskable-512.png`, fullBleedSvg(mark, 0.62), 512],
  [`${OUTPUTS.web}/apple-touch-icon.png`, fullBleedSvg(mark, 0.74), 180],
  [`${OUTPUTS.desktopBuild}/icon.png`, appIcon(1024, MAC), 1024],
  ...LINUX.map((size) => [
    `${OUTPUTS.desktopBuild}/icons/${size}x${size}.png`,
    appIcon(size, FLAT),
    size,
  ]),
  [`${OUTPUTS.desktopAssets}/icon.png`, appIcon(256, FLAT), 256],
  [`${OUTPUTS.desktopAssets}/tray.png`, markSvg(mark, { crop: true, widen: 0.6 }), 16],
  [`${OUTPUTS.desktopAssets}/tray@2x.png`, markSvg(mark, { crop: true }), 32],
  [`${OUTPUTS.desktopAssets}/trayTemplate.png`, templateSvg(mark), 16],
  [`${OUTPUTS.desktopAssets}/trayTemplate@2x.png`, templateSvg(mark), 32],
];

// ---------------------------------------------------------------- containers

/** The RGBA pixels of an 8-bit, non-interlaced PNG (what Chromium's screenshots are). */
function pixels(png) {
  let offset = 8;
  let header = null;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = body;
    if (type === "IDAT") data.push(body);
    offset += length + 12;
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bpp = { 2: 3, 6: 4 }[header[9]];
  if (header[8] !== 8 || !bpp || header[12] !== 0) throw new Error("unexpected PNG format");
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * bpp;
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? rows[y * stride + x - bpp] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? rows[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter];
      rows[y * stride + x] = (value + add) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4, 0xff);
  for (let i = 0; i < width * height; i++) rows.copy(rgba, i * 4, i * bpp, i * bpp + bpp);
  return { width, height, rgba };
}

/** An .icns file: a list of PNGs, each under the type of its size. */
function icns(entries) {
  const parts = entries.map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "latin1");
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "latin1");
  head.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}

/** One .ico image under 256 px: a 32-bit bitmap, bottom row first, with its (empty) mask. */
function icoBitmap(png) {
  const { width, height, rgba } = pixels(png);
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(width, 4);
  head.writeInt32LE(height * 2, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  head.writeUInt32LE(width * height * 4, 20);
  const color = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = ((height - 1 - y) * width + x) * 4;
      color[to] = rgba[from + 2];
      color[to + 1] = rgba[from + 1];
      color[to + 2] = rgba[from];
      color[to + 3] = rgba[from + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(width / 32) * 4 * height);
  return Buffer.concat([head, color, mask]);
}

/** An .ico file: bitmaps for the small sizes (every Windows tool reads them), a PNG for 256. */
function ico(entries) {
  const images = entries.map(([size, png]) => [size, size < 256 ? icoBitmap(png) : png]);
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, image], index) => {
    const at = 6 + index * 16;
    head[at] = size % 256;
    head[at + 1] = size % 256;
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(image.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += image.length;
  });
  return Buffer.concat([head, ...images.map(([, image]) => image)]);
}

// ---------------------------------------------------------------- write

let changed = 0;
function write(file, content) {
  const out = resolve(root, file);
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
  let same = false;
  try {
    same = readFileSync(out).equals(next);
  } catch {}
  if (!same) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, next);
    changed++;
  }
  console.log(`${same ? "same " : "wrote"} ${file}`);
}

write(OUTPUTS.favicon, faviconFile(mark));
write(OUTPUTS.module, markModule(mark, colors));
write(OUTPUTS.css, brandCss(colors));

const require = createRequire(resolve(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (svg, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`,
    );
    return page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
  };
  for (const [file, svg, size] of pngs) write(file, await render(svg, size));

  const mac = new Map();
  for (const [, size] of ICNS)
    if (!mac.has(size)) mac.set(size, await render(appIcon(size, MAC), size));
  write(
    `${OUTPUTS.desktopBuild}/icon.icns`,
    icns(ICNS.map(([type, size]) => [type, mac.get(size)])),
  );

  const win = [];
  for (const size of ICO) win.push([size, await render(appIcon(size, FLAT), size)]);
  write(`${OUTPUTS.desktopBuild}/icon.ico`, ico(win));
} finally {
  await browser.close();
}

const r = (set) =>
  typeof set === "number"
    ? `${set.toFixed(2)}:1`
    : Object.entries(set)
        .map(([name, n]) => `${name} ${n.toFixed(2)}:1`)
        .join(", ");
const { ratios } = colors;
console.log(`
red ${colors.red}, white on it ${r(ratios.whiteOnRed)}
light theme, the mark and the wordmark: ${r(ratios.light)}
dark theme, the mark: ${r(ratios.darkMark)}
dark theme, the wordmark's ${colors.textOnDark}: ${r(ratios.darkText)}
${changed === 0 ? "nothing changed" : `${changed} file(s) changed`}`);
