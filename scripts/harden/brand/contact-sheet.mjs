// A preview of the CodeHarden brand as it is in `mark.svg`, in one PNG: the mark at every size
// on light and dark, the wordmark on both themes, the app icon on a Dock and at its small
// sizes, the menu-bar template and the tray icon. For judging a change of shape or colour
// before (or after) `make.mjs` writes the real files.
// Run: node scripts/harden/brand/contact-sheet.mjs <out.png>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
  appIconAt,
  brandColors,
  FLAT,
  MAC,
  markSvg,
  readMark,
  SURFACES,
  templateSvg,
} from "./brand.mjs";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const font = readFileSync(
  require.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
).toString("base64");

const mark = readMark();
const colors = brandColors(mark);
const { ratios } = colors;
const r = (set) =>
  typeof set === "number"
    ? `${set.toFixed(2)}:1`
    : Object.entries(set)
        .map(([name, n]) => `${name} ${n.toFixed(2)}:1`)
        .join(", ");

let ids = 0;
/** An SVG at a pixel size (mask ids made unique: the page holds many copies). */
const at = (svg, size) =>
  svg
    .replace("<svg ", `<svg width="${size}" height="${size}" `)
    .replaceAll('"m"', `"m${++ids}"`)
    .replaceAll("url(#m)", `url(#m${ids})`);
const fig = (svg, size, label = size) =>
  `<figure>${at(svg, size)}<figcaption>${label}</figcaption></figure>`;
const sizes = () => [16, 32, 64, 128].map((s) => fig(markSvg(mark), s)).join("");
const wordmark = (px) =>
  `<span class="lockup">${at(markSvg(mark), Math.round(px * 1.45))}<span class="wm" style="font-size:${px}px">Code<span class="hard">Harden</span></span></span>`;
const small = (margin) =>
  [16, 24, 32, 48, 64, 128].map((s) => fig(appIconAt(mark, s, margin), s)).join("");
const tray = () =>
  `${at(markSvg(mark, { crop: true, widen: 0.6 }), 16)}&nbsp;&nbsp;${at(markSvg(mark, { crop: true }), 32)}`;
const bar = (ink) =>
  `<span class="menu">File&nbsp;&nbsp;Edit&nbsp;&nbsp;View</span><span class="right">${at(templateSvg(mark, ink), 16)}<span>Mon 9:41</span></span><span class="zoom">${at(templateSvg(mark, ink), 64)}</span>`;

const row = (light, dark, cls = "") =>
  `<div class="row"><div class="cell light ${cls}">${light}</div><div class="cell dark ${cls}">${dark}</div></div>`;
const note = (text) => `<span class="note">${text}</span>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Geist Variable";src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:100 900}
*{box-sizing:border-box}body{margin:0;padding:36px;width:1560px;background:#e9eaee;font-family:"Geist Variable",sans-serif;color:#1a1c22}
h1{font-size:26px;margin:0 0 4px}p{margin:0 0 6px;color:#555b68;font-size:14px}
section{background:#fff;border-radius:16px;padding:22px;margin-top:20px}
.row{display:flex;gap:14px;margin-bottom:14px}.row:last-child{margin-bottom:0}
.cell{flex:1;border-radius:10px;padding:18px;position:relative;display:flex;align-items:center;gap:22px;min-height:76px}
.light{background:${SURFACES.light.page};border:1px solid #0001}.dark{background:${SURFACES.dark.page}}
.strip{align-items:flex-end;padding-bottom:30px}.big{justify-content:center;padding:26px 18px 40px}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}figcaption,.note{font-size:11px;color:#7b8190}
.note{position:absolute;right:12px;bottom:7px}
.side.light{background:${SURFACES.light.sidebar};color:#282b33}.side.dark{background:${SURFACES.dark.sidebar};color:#d3d6dd}
.lockup{display:inline-flex;align-items:center;gap:.5em;margin-right:30px}.wm{font-weight:600;letter-spacing:-0.025em}
.light .hard{color:${colors.textOnLight}}.dark .hard{color:${colors.textOnDark}}
.dock{min-height:190px;justify-content:center}.dock.light{background:linear-gradient(#cfd6e4,#b9c2d6)}.dock.dark{background:linear-gradient(#262a35,#14161c)}
.dock svg{filter:drop-shadow(0 3px 5px #0004)}
.bar{min-height:92px;padding:0 14px;font-size:13px;font-weight:500}.bar .right{display:flex;align-items:center;gap:12px;margin-left:auto;margin-right:470px}
.bar .zoom{position:absolute;right:370px;top:14px}
.bar.light{background:#eceef2;color:#1d1d1f}.bar.dark{background:#22242b;color:#f5f5f7}
.task.light{background:#f1f3f8}.task.dark{background:#1b1d24}.task .right{margin-left:auto;margin-right:470px;display:flex;align-items:center}
</style></head><body>
<h1>CodeHarden: the mark, the wordmark and the icons</h1>
<p>One SVG source and one red, <b>${colors.red}</b> (white on it ${r(ratios.whiteOnRed)}). Every size is drawn at its true pixel size.</p>
<p>Light theme, the mark and the word Harden: ${r(ratios.light)}. Dark theme, the mark: ${r(ratios.darkMark)}; the word Harden in the tint <b>${colors.textOnDark}</b>: ${r(ratios.darkText)}. WCAG AA asks 3:1 for graphics and large text, 4.5:1 for normal text.</p>
<section>
${row(sizes(), sizes(), "strip")}
${row(fig(markSvg(mark), 512, "512 on light"), fig(markSvg(mark), 512, "512 on dark"), "big")}
${row(wordmark(15) + wordmark(28) + note("wordmark, light theme (sidebar size, then large)"), wordmark(15) + wordmark(28) + note("wordmark, dark theme"), "side")}
${row(at(appIconAt(mark, 160, MAC), 160) + note("app icon on a light Dock"), at(appIconAt(mark, 160, MAC), 160) + note("app icon on a dark Dock"), "dock")}
${row(small(MAC) + note("app icon, macOS sizes (.icns)"), small(MAC) + note("the same on dark"), "strip")}
${row(small(FLAT) + note("app icon, Windows (.ico) and Linux sizes"), small(FLAT) + note("the same on dark"), "strip")}
${row(bar("#1d1d1f") + note("macOS menu bar, light (template image, 16 px; enlarged right)"), bar("#f5f5f7") + note("macOS menu bar, dark"), "bar")}
${row(`<span class="right">${tray()}</span>${note("Windows / Linux tray, light taskbar (16 and 32 px)")}`, `<span class="right">${tray()}</span>${note("Windows / Linux tray, dark taskbar")}`, "task")}
</section></body></html>`;

const out = resolve(process.argv[2] ?? "contact-sheet.png");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1632, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await page.screenshot({ fullPage: true }));
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
