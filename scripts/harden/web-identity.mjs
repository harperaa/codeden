// The web app's name in its static files: the page title in `index.html` and the name an
// installed web app gets from `manifest.webmanifest`. Both files hold CodeHarden's name as
// written, so they are valid as they are (tests, a file opened by hand); a build, and the Vite
// dev server, put the product name of this build's channel in its place
// (`readHardenChannel().productName`, the same value the bundle gets as `HARDEN_PRODUCT_NAME`),
// so a fork configured with its own name gets it here too. The tab title the running app sets
// comes from `HARDEN_PRODUCT_NAME` (`apps/web/src/lib/attention/title.ts`).
//
// The icons go the same way. Both files keep upstream's icon paths, and upstream's images stay
// in the public folder untouched (so its changes to them never conflict); a build, and the dev
// server, point the page and the manifest at this product's own icons in `public/harden/`,
// which `scripts/harden/brand/make.mjs` draws from the one SVG source.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readHardenChannel } from "./channel-define.mjs";

export const MANIFEST_FILE = "manifest.webmanifest";

/**
 * Upstream's icon paths in `index.html` and the manifest, and this product's icon for each
 * (the same list as `HARDEN_WEB_ICONS` in `packages/contracts/src/harden-brand.ts`).
 */
export const HARDEN_ICONS = {
  "/favicon.svg": "/harden/favicon.svg",
  "/apple-touch-icon.png": "/harden/apple-touch-icon.png",
  "/icons/icon-192.png": "/harden/icon-192.png",
  "/icons/icon-512.png": "/harden/icon-512.png",
  "/icons/maskable-192.png": "/harden/maskable-192.png",
  "/icons/maskable-512.png": "/harden/maskable-512.png",
};
const OWN_ICONS = new Set(Object.values(HARDEN_ICONS));

const ICON_LINK = /(<link\s+rel="(icon|apple-touch-icon)"[^>]*?\shref=")([^"]*)(")/g;

const TITLE = /(<title>)[^<]*(<\/title>)/;
const APPLE_TITLE = /(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/;

/** `html` with the page title and the home-screen title set to `name`; throws when one is gone. */
export function titledHtml(html, name) {
  for (const [pattern, what] of [
    [TITLE, "<title>"],
    [APPLE_TITLE, 'the <meta name="apple-mobile-web-app-title"> tag'],
  ]) {
    if (!pattern.test(html)) {
      throw new Error(
        `index.html has no ${what} to put the product name in (scripts/harden/web-identity.mjs)`,
      );
    }
    html = html.replace(pattern, (_all, before, after) => `${before}${name}${after}`);
  }
  return html;
}

/**
 * `html` with its tab icon and apple-touch icon pointing at this product's own; throws when a
 * link is gone or names an icon this product has none for (upstream added or moved one).
 */
export function brandedHtml(html) {
  const seen = new Set();
  const out = html.replace(ICON_LINK, (_all, before, rel, href, after) => {
    seen.add(rel);
    if (OWN_ICONS.has(href)) return `${before}${href}${after}`;
    const own = HARDEN_ICONS[href];
    if (!own) {
      throw new Error(
        `index.html links the icon ${href}, which has no CodeHarden icon: draw one in scripts/harden/brand/make.mjs and add it to HARDEN_ICONS (scripts/harden/web-identity.mjs)`,
      );
    }
    return `${before}${own}${after}`;
  });
  for (const rel of ["icon", "apple-touch-icon"]) {
    if (!seen.has(rel)) {
      throw new Error(
        `index.html has no <link rel="${rel}"> to point at the product's icon (scripts/harden/web-identity.mjs)`,
      );
    }
  }
  return out;
}

/** The web manifest `text` with every icon replaced by this product's own. */
export function brandedManifest(text) {
  const manifest = JSON.parse(text);
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    throw new Error(
      `${MANIFEST_FILE} has no icons to replace with the product's (scripts/harden/web-identity.mjs)`,
    );
  }
  const icons = manifest.icons.map((icon) => {
    if (OWN_ICONS.has(icon.src)) return icon;
    const own = HARDEN_ICONS[icon.src];
    if (!own) {
      throw new Error(
        `${MANIFEST_FILE} lists the icon ${icon.src}, which has no CodeHarden icon: draw one in scripts/harden/brand/make.mjs and add it to HARDEN_ICONS (scripts/harden/web-identity.mjs)`,
      );
    }
    return { ...icon, src: own };
  });
  return `${JSON.stringify({ ...manifest, icons }, null, 2)}\n`;
}

/** The web manifest `text` with `name` and `short_name` set to `name`. */
export function namedManifest(text, name) {
  const manifest = JSON.parse(text);
  if (typeof manifest.name !== "string" || typeof manifest.short_name !== "string") {
    throw new Error(
      `${MANIFEST_FILE} has no name and short_name to put the product name in (scripts/harden/web-identity.mjs)`,
    );
  }
  return `${JSON.stringify({ ...manifest, name, short_name: name }, null, 2)}\n`;
}

/** The Vite plugin: names the page and the manifest after this build's product and gives them its icons. */
export function hardenWebIdentity(env = process.env, options = {}) {
  const { productName } = readHardenChannel(env, options);
  let config;
  return {
    name: "harden-web-identity",
    configResolved(resolved) {
      config = resolved;
    },
    transformIndexHtml: (html) => brandedHtml(titledHtml(html, productName)),
    // The dev server serves the public folder as it is: answer for the manifest before it does.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== `/${MANIFEST_FILE}`) return next();
        const file = join(config.publicDir, MANIFEST_FILE);
        if (!existsSync(file)) return next();
        res.setHeader("content-type", "application/manifest+json");
        res.end(brandedManifest(namedManifest(readFileSync(file, "utf8"), productName)));
      });
    },
    // A build copies the public folder into the output: name the copy.
    closeBundle() {
      if (config?.command !== "build") return;
      const file = resolve(config.root, config.build.outDir, MANIFEST_FILE);
      if (!existsSync(file)) return;
      writeFileSync(file, brandedManifest(namedManifest(readFileSync(file, "utf8"), productName)));
    },
  };
}
