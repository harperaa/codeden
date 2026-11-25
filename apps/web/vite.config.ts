import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";
import { hardenChannelDefine } from "../../scripts/harden/channel-define.mjs";
import { hardenVersionDefine } from "../../scripts/harden/version-define.mjs";
import { hardenWebIdentity } from "../../scripts/harden/web-identity.mjs";

const serverUrl = process.env.CODEDEN_SERVER_URL ?? "http://127.0.0.1:4318";
const devHome = process.env.CODEDEN_HOME ?? resolve(import.meta.dirname, "../../.codeden-dev");

/** Dev token written by the dev server; read per request so a fresh install just works. */
function devToken(): string {
  try {
    return readFileSync(resolve(devHome, "install-token"), "utf8").trim();
  } catch {
    return "";
  }
}

const withToken: ProxyOptions["configure"] = (proxy) => {
  proxy.on("proxyReq", (req) => req.setHeader("authorization", `Bearer ${devToken()}`));
  proxy.on("proxyReqWs", (req) => req.setHeader("authorization", `Bearer ${devToken()}`));
};

export default defineConfig({
  plugins: [react(), tailwindcss(), hardenWebIdentity()],
  define: { ...hardenVersionDefine(), ...hardenChannelDefine() },
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: serverUrl, changeOrigin: true, configure: withToken },
      "/ws": { target: serverUrl, ws: true, changeOrigin: true, configure: withToken },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Pages and heavy panels load on demand (apps/web/README.md), so every chunk a first load
    // needs is well under Vite's 500 kB. The two that aren't are single syntax grammars (Emacs
    // Lisp, C++, about 790 kB each) fetched only to highlight a code block in that language;
    // they can't be split, so the limit sits just above them instead of warning on every build.
    chunkSizeWarningLimit: 850,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Icons in one chunk: split by page they'd be dozens of tiny requests on a first load,
          // which costs a phone on plain http over the LAN or a VPN more than the bytes.
          groups: [
            {
              name: "icons",
              test: /[\\/]lucide-react[\\/]/,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
});
