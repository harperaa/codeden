// The CodeHarden brand, read from its one source (`mark.svg` beside this file): the mark's
// shapes and its two colours, and everything drawn from them (the app icon on its tile, the
// menu-bar template, the web-app icons) as SVG text. No browser here: `make.mjs` renders these
// to files, `contact-sheet.mjs` to one preview image, and `brand.test.mjs` checks the committed
// text outputs against them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MARK_FILE = fileURLToPath(new URL("./mark.svg", import.meta.url));

/**
 * The themes' surfaces the wordmark is read on (`--background`, `--sidebar` and `--card` in
 * `apps/web/src/index.css`, as sRGB): the page, the sidebar, and the card of Settings › About.
 */
export const SURFACES = {
  light: { page: "#f9fafb", sidebar: "#f4f5f7", card: "#ffffff" },
  dark: { page: "#0d0e12", sidebar: "#090a0d", card: "#131519" },
};
/** The tile behind the mark in app icons: near white, so the red shield reads on any Dock. */
export const TILE = "#fbfbfc";

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The mark: its view box, the two colours and its shapes in drawing order. */
export function readMark(text = readFileSync(MARK_FILE, "utf8")) {
  const viewBox = attr(/<svg\b[^>]*>/.exec(text)?.[0] ?? "", "viewBox");
  const shapes = [...text.matchAll(/<path\b[^>]*\/>/g)].map(([tag]) => ({
    id: attr(tag, "id"),
    role: attr(tag, "data-fill"),
    d: attr(tag, "d"),
    fill: attr(tag, "fill")?.toLowerCase(),
    stroke: attr(tag, "stroke")?.toLowerCase(),
    strokeWidth: Number(attr(tag, "stroke-width")),
  }));
  const ink = shapes.find((shape) => shape.role === "ink")?.fill;
  const paper = shapes.find((shape) => shape.role === "paper")?.fill;
  const hex = /^#[0-9a-f]{6}$/;
  if (viewBox !== "0 0 32 32") throw new Error("mark.svg must keep viewBox 0 0 32 32");
  if (!ink || !paper || !hex.test(ink) || !hex.test(paper)) {
    throw new Error(
      'mark.svg needs a data-fill="ink" and a data-fill="paper" path with #rrggbb fills',
    );
  }
  for (const shape of shapes) {
    const own = shape.role === "ink" ? ink : shape.role === "paper" ? paper : null;
    if (!shape.id || !shape.d || shape.fill !== own || shape.stroke !== ink || !shape.strokeWidth) {
      throw new Error(
        `mark.svg: every path needs an id, a d, data-fill ink or paper with that colour as fill, the ink as stroke and a stroke-width (${shape.id ?? "a path without id"})`,
      );
    }
  }
  const title = /<title>([^<]*)<\/title>/.exec(text)?.[1] ?? "";
  return { viewBox, title, ink, paper, shapes };
}

// ---------------------------------------------------------------- colour

const channels = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG contrast ratio of two `#rrggbb` colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `hex` mixed towards white in 1% steps until it reaches `ratio` on every one of `surfaces`. */
export function tintFor(hex, surfaces, ratio = 4.5) {
  const from = channels(hex);
  for (let step = 0; step <= 100; step++) {
    const tint = `#${from
      .map((v) =>
        Math.round(v + ((255 - v) * step) / 100)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
    if (surfaces.every((surface) => contrast(tint, surface) >= ratio)) return tint;
  }
  return "#ffffff";
}

/**
 * The brand's colours: the red of the mark, and the red of the word in the wordmark on each
 * theme. On the light theme that is the mark's red; on the dark theme a lighter tint of it, so
 * small text reaches 4.5:1 there too.
 */
export function brandColors(mark = readMark()) {
  const dark = Object.values(SURFACES.dark);
  const light = Object.values(SURFACES.light);
  const colors = {
    red: mark.ink,
    white: mark.paper,
    textOnLight: mark.ink,
    textOnDark: tintFor(mark.ink, dark),
  };
  const worst = (color, surfaces) => Math.min(...surfaces.map((s) => contrast(color, s)));
  const on = (color, surfaces) =>
    Object.fromEntries(Object.entries(surfaces).map(([name, s]) => [name, contrast(color, s)]));
  const ratios = {
    whiteOnRed: contrast(mark.paper, mark.ink),
    light: on(mark.ink, SURFACES.light),
    darkMark: on(mark.ink, SURFACES.dark),
    darkText: on(colors.textOnDark, SURFACES.dark),
  };
  // WCAG AA: 3:1 for graphics and large text. A red that fails it is not usable as the brand.
  if (worst(mark.ink, [...light, ...dark]) < 3 || ratios.whiteOnRed < 3) {
    throw new Error(`the red ${mark.ink} does not reach 3:1 on the themes' surfaces and on white`);
  }
  return { ...colors, ratios };
}

// ---------------------------------------------------------------- drawings

const path = (shape, fill, stroke, widen = 0) =>
  `<path d="${shape.d}" fill="${fill}" stroke="${stroke}" stroke-width="${shape.strokeWidth + widen}" stroke-linejoin="round"/>`;

/** The mark's shapes in its own colours; `widen` thickens the outline for the smallest sizes. */
export function markShapes(mark, widen = 0) {
  return mark.shapes.map((shape) => path(shape, shape.fill, mark.ink, widen)).join("");
}

/** Text as it is written inside an XML element. */
const escapeXml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const svg = (body, viewBox = "0 0 32 32") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

/** The mark alone on a transparent ground: the favicon and the Windows and Linux tray icon. */
export function markSvg(mark, { crop = false, widen = 0 } = {}) {
  return svg(markShapes(mark, widen), crop ? "2 2 28 28" : "0 0 32 32");
}

/**
 * The menu-bar template (macOS): the mark's ink in one colour, its paper see-through. The
 * system tints it for a light or a dark bar.
 */
export function templateSvg(mark, color = "#000000") {
  const mask = mark.shapes
    .map((shape) => path(shape, shape.role === "ink" ? "white" : "black", "white"))
    .join("");
  return svg(
    `<mask id="m"><rect width="32" height="32" fill="black"/>${mask}</mask><rect width="32" height="32" fill="${color}" mask="url(#m)"/>`,
    "2 2 28 28",
  );
}

/**
 * The app icon: the mark on a rounded near-white tile. `inset` is the margin around the tile
 * (macOS icons keep one; a small icon uses none), `scale` the mark's size on the tile.
 */
export function appIconSvg(mark, { inset = 0, scale = 0.8, widen = 0 } = {}) {
  const tile = (32 - inset * 2) / 32;
  const at = 16 - 16 * scale;
  return svg(
    `<g transform="translate(${inset} ${inset}) scale(${tile})"><rect x="0.15" y="0.15" width="31.7" height="31.7" rx="7.1" fill="${TILE}" stroke="#000000" stroke-opacity="0.14" stroke-width="0.3"/><g transform="translate(${at} ${at}) scale(${scale})">${markShapes(mark, widen)}</g></g>`,
  );
}

/**
 * The app icon at one size. A large icon keeps the margin macOS icons have and the mark as
 * drawn; a small one fills its box, with a larger mark and a heavier outline so the white half
 * of the shield still reads against the tile.
 */
export function appIconAt(mark, size, margin) {
  if (size <= 24) return appIconSvg(mark, { inset: 0, scale: 0.94, widen: 1.5 });
  if (size <= 48) return appIconSvg(mark, { inset: margin / 3, scale: 0.88, widen: 0.9 });
  if (size <= 64) return appIconSvg(mark, { inset: margin / 2, scale: 0.84, widen: 0.4 });
  return appIconSvg(mark, { inset: margin, scale: 0.8 });
}
/** macOS: a tenth of the box around the tile. */
export const MAC = 3.2;
/** Windows and Linux: the tile nearly fills the box. */
export const FLAT = 1;

/** A full-bleed icon (maskable, apple-touch): the tile colour edge to edge, the mark centred. */
export function fullBleedSvg(mark, scale) {
  const at = 16 - 16 * scale;
  return svg(
    `<rect width="32" height="32" fill="${TILE}"/><g transform="translate(${at} ${at}) scale(${scale})">${markShapes(mark)}</g>`,
  );
}

// ---------------------------------------------------------------- generated text files

const GENERATED =
  "Generated by scripts/harden/brand/make.mjs from scripts/harden/brand/mark.svg. Do not edit: change the SVG and run the script.";

/** `public/harden/favicon.svg`: the mark as a browser draws it in a tab. */
export function faviconFile(mark) {
  return `${svg(`<title>${escapeXml(mark.title)}</title>${markShapes(mark)}`)}\n`;
}

/** `packages/contracts/src/harden-mark.ts`: the mark and its colours for the UI and the server's pages. */
export function markModule(mark, colors) {
  const shapes = mark.shapes
    .map(
      (shape) =>
        `    {\n      id: ${JSON.stringify(shape.id)},\n      fill: ${JSON.stringify(shape.role)},\n      strokeWidth: ${shape.strokeWidth},\n      d: ${JSON.stringify(shape.d)},\n    },\n`,
    )
    .join("");
  return `// ${GENERATED}

/** One shape of the mark: filled with the brand red (\`ink\`) or the white (\`paper\`), outlined in the red. */
export interface HardenMarkShape {
  id: string;
  fill: "ink" | "paper";
  strokeWidth: number;
  d: string;
}

/** The brand red: the shield, and the second half of the wordmark on a light ground. */
export const HARDEN_BRAND_RED = ${JSON.stringify(colors.red)};
/** The red of the wordmark on a dark ground: a lighter tint, 4.5:1 on the dark theme. */
export const HARDEN_BRAND_RED_ON_DARK = ${JSON.stringify(colors.textOnDark)};
/** The mark's second colour. */
export const HARDEN_BRAND_WHITE = ${JSON.stringify(colors.white)};

/** The mark (a halved shield), drawn in a 32-unit box: its shapes in drawing order. */
export const HARDEN_MARK: { viewBox: string; shapes: readonly HardenMarkShape[] } = {
  viewBox: ${JSON.stringify(mark.viewBox)},
  shapes: [
${shapes}  ],
};
`;
}

/** `apps/web/src/harden-brand.css`: the brand's colour tokens for both themes. */
export function brandCss(colors) {
  return `/* ${GENERATED} */

@theme inline {
  --color-brand: var(--brand);
  --color-brand-text: var(--brand-text);
}

/* --brand is the mark's red; --brand-text the red of the wordmark, readable on each theme. */
:root {
  --brand: ${colors.red};
  --brand-text: ${colors.textOnLight};
}

.dark {
  --brand-text: ${colors.textOnDark};
}
`;
}

/** Every file `make.mjs` writes, by repository path; the text ones carry their content. */
export const OUTPUTS = {
  favicon: "apps/web/public/harden/favicon.svg",
  module: "packages/contracts/src/harden-mark.ts",
  css: "apps/web/src/harden-brand.css",
  web: "apps/web/public/harden",
  desktopBuild: "apps/desktop/build/harden",
  desktopAssets: "apps/desktop/assets/harden",
};
