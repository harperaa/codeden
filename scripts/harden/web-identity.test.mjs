import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HARDEN_WEB_ICONS } from "../../packages/contracts/src/harden-brand.ts";
import {
  brandedHtml,
  brandedManifest,
  HARDEN_ICONS,
  hardenWebIdentity,
  namedManifest,
  titledHtml,
} from "./web-identity.mjs";

const read = (file) =>
  readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");
const html = read("apps/web/index.html");
const manifest = read("apps/web/public/manifest.webmanifest");

describe("the web app's name in its static files", () => {
  it("the files as written carry CodeHarden's own name", () => {
    expect(html).toContain("<title>CodeHarden</title>");
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="CodeHarden" />');
    expect(JSON.parse(manifest)).toMatchObject({ name: "CodeHarden", short_name: "CodeHarden" });
  });

  it("puts a fork's product name in the page and leaves the rest of it alone", () => {
    const named = titledHtml(html, "Acme Den");
    expect(named).toContain("<title>Acme Den</title>");
    expect(named).toContain('<meta name="apple-mobile-web-app-title" content="Acme Den" />');
    expect(named.replaceAll("Acme Den", "CodeHarden")).toBe(html);
  });

  it("puts it in the manifest and keeps every other field", () => {
    const named = JSON.parse(namedManifest(manifest, "Acme Den"));
    expect(named).toEqual({ ...JSON.parse(manifest), name: "Acme Den", short_name: "Acme Den" });
  });

  it("fails the build when a file lost the place for the name", () => {
    expect(() => titledHtml("<html><head></head></html>", "X")).toThrow(/no <title>/);
    expect(() => titledHtml("<title>x</title>", "X")).toThrow(/apple-mobile-web-app-title/);
    expect(() => namedManifest('{"display":"standalone"}', "X")).toThrow(/no name and short_name/);
  });

  it("the plugin takes the name from the build's channel", () => {
    const origin = "harperaa/codeharden";
    const own = hardenWebIdentity({}, { origin });
    expect(own.transformIndexHtml(html)).toBe(brandedHtml(html));
    const fork = hardenWebIdentity({ PACKAGE_NAME: "acme", PRODUCT_NAME: "Acme Den" }, { origin });
    expect(fork.transformIndexHtml(html)).toContain("<title>Acme Den</title>");
  });
});

describe("the web app's icons in its static files", () => {
  const file = (path) => fileURLToPath(new URL(`../../apps/web/public${path}`, import.meta.url));

  it("points the page at the product's own tab and home-screen icons", () => {
    const branded = brandedHtml(html);
    expect(branded).toContain(
      '<link rel="icon" type="image/svg+xml" href="/harden/favicon.svg" />',
    );
    expect(branded).toContain(
      '<link rel="apple-touch-icon" href="/harden/apple-touch-icon.png" />',
    );
    expect(branded).not.toMatch(/href="\/(?:favicon\.svg|apple-touch-icon\.png)"/);
    // Running it again changes nothing.
    expect(brandedHtml(branded)).toBe(branded);
  });

  it("replaces every icon of the manifest and keeps every other field", () => {
    const source = JSON.parse(manifest);
    const branded = JSON.parse(brandedManifest(manifest));
    expect({ ...branded, icons: source.icons }).toEqual(source);
    expect(branded.icons.map((icon) => icon.src)).toEqual([
      "/harden/icon-192.png",
      "/harden/icon-512.png",
      "/harden/maskable-192.png",
      "/harden/maskable-512.png",
    ]);
    expect(branded.icons.map(({ src: _src, ...rest }) => rest)).toEqual(
      source.icons.map(({ src: _src, ...rest }) => rest),
    );
  });

  it("every icon it points at is a committed file, and upstream's originals are still there", () => {
    for (const [upstream, own] of Object.entries(HARDEN_ICONS)) {
      expect(existsSync(file(own)), own).toBe(true);
      expect(existsSync(file(upstream)), upstream).toBe(true);
    }
  });

  it("is the same list the server and the UI use", () => {
    expect(HARDEN_ICONS).toEqual(HARDEN_WEB_ICONS);
  });

  it("fails the build when upstream adds or drops an icon the product has none for", () => {
    expect(() => brandedHtml(html.replace("/favicon.svg", "/favicon-v2.svg"))).toThrow(
      /favicon-v2\.svg, which has no CodeHarden icon/,
    );
    expect(() => brandedHtml("<title>x</title>")).toThrow(/no <link rel="icon">/);
    expect(() =>
      brandedManifest(manifest.replace("/icons/icon-512.png", "/icons/icon-1024.png")),
    ).toThrow(/icon-1024\.png, which has no CodeHarden icon/);
    expect(() => brandedManifest('{"name":"x"}')).toThrow(/no icons/);
  });
});
