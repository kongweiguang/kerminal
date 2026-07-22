import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { patchXtermWebviewNamespace } from "./src/lib/xtermWebviewCompatibility";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function isXtermBrowserBundle(id: string) {
  return id.replaceAll("\\", "/").endsWith("/@xterm/xterm/lib/xterm.mjs");
}

function xtermWebviewCompatibilityPlugin(): Plugin {
  return {
    name: "kerminal-xterm-webview-compatibility",
    enforce: "pre",
    transform(code, id) {
      if (!isXtermBrowserBundle(id)) {
        return null;
      }

      const patchedCode = patchXtermWebviewNamespace(code);
      return patchedCode === code ? null : { code: patchedCode, map: null };
    },
  };
}

function xtermWebviewOptimizeDepsPlugin() {
  return {
    name: "kerminal-xterm-webview-compatibility",
    setup(build: {
      onLoad: (
        options: { filter: RegExp },
        callback: (args: { path: string }) => { contents: string; loader: "js" },
      ) => void;
    }) {
      build.onLoad(
        {
          filter: /[\\/]@xterm[\\/]xterm[\\/]lib[\\/]xterm\.mjs$/,
        },
        (args) => ({
          contents: patchXtermWebviewNamespace(
            readFileSync(args.path, "utf8"),
          ),
          loader: "js",
        }),
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [xtermWebviewCompatibilityPlugin(), react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1425,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: [
        "**/src-tauri/**",
        "**/.codex/**",
        "**/.updeng/**",
        "**/dist/**",
        "**/target/**",
        "**/target*/**",
        "**/src-tauri/target*/**",
      ],
    },
  },
  optimizeDeps: {
    include: [
      "@radix-ui/react-slot",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/window",
      "@xterm/addon-fit",
      "@xterm/addon-search",
      "@xterm/xterm",
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "tailwind-merge",
      "zustand",
    ],
    noDiscovery: true,
    esbuildOptions: {
      plugins: [xtermWebviewOptimizeDepsPlugin()],
    },
  },
}));
