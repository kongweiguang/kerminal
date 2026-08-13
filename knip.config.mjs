// @author kongweiguang

/** @type {import("knip").KnipConfig} */
const config = {
  entry: [
    "src/main.tsx",
    "src/**/*.test.{ts,tsx}",
    "tests/frontend/setup.ts",
    "tests/frontend/**/*.test.{ts,tsx}",
    "tests/frontend/support/terminal/terminalRendererBrowserSmokeBridge.ts",
    "tests/scripts/*.test.mjs",
    "scripts/*.mjs",
    "eslint.config.mjs",
    "vite.config.ts",
    "vitest.config.ts",
  ],
  project: [
    "src/**/*.{ts,tsx}",
    "tests/frontend/**/*.{ts,tsx}",
    "tests/scripts/*.test.mjs",
    "scripts/*.mjs",
    "eslint.config.mjs",
    "vite.config.ts",
    "vitest.config.ts",
  ],
  include: [
    "files",
    "dependencies",
    "devDependencies",
    "unlisted",
    "binaries",
    "unresolved",
    "exports",
    "types",
    "nsExports",
    "nsTypes",
    "duplicates",
  ],
  includeEntryExports: false,
  ignoreDependencies: [
    // Tailwind v4 is loaded from src/App.css; Knip intentionally does not parse CSS imports.
    "tailwindcss",
    // window-state 由 Rust 注册，但桌面插件契约测试要求保留对应前端包。
    "@tauri-apps/plugin-window-state",
  ],
  // 这些命令由验证脚本通过 spawnSync 真实调用，不属于 npm 依赖。
  ignoreBinaries: [
    "rustc",
    "ssh-keygen.exe",
    "ssh.exe",
    "taskkill",
    "wsl.exe",
  ],
  treatConfigHintsAsErrors: true,
  treatTagHintsAsErrors: true,
};

export default config;
