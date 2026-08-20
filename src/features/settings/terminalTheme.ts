// @author kongweiguang

import type { ITheme } from "@xterm/xterm";
import type { ResolvedTheme, TerminalColorScheme } from "./settingsModel";

/** 返回配色方案的原始不透明主题，供设置预览和普通终端表面复用。 */
export function xtermThemeFor(
  theme: ResolvedTheme,
  colorScheme: TerminalColorScheme = "kerminal",
): ITheme {
  if (colorScheme === "tokyoNight") {
    return theme === "light" ? tokyoDayTheme : tokyoNightTheme;
  }
  if (colorScheme === "solarized") {
    return theme === "light" ? solarizedLightTheme : solarizedDarkTheme;
  }
  if (colorScheme === "github") {
    return theme === "light" ? githubLightTheme : githubDarkTheme;
  }

  return theme === "light" ? kerminalLightTheme : kerminalDarkTheme;
}

/**
 * 背景图启用时只移除 xterm 自身 canvas 的实色底，不改变文字和 ANSI 色；
 * 可见性仍由终端卡片表面控制，避免把文字也一起做 CSS opacity 淡化。
 */
export function xtermThemeForTerminalSurface(
  theme: ResolvedTheme,
  colorScheme: TerminalColorScheme,
  backgroundImageVisible: boolean,
): ITheme {
  const terminalTheme = xtermThemeFor(theme, colorScheme);
  return backgroundImageVisible
    ? { ...terminalTheme, background: "rgba(0, 0, 0, 0)" }
    : terminalTheme;
}

const kerminalLightTheme: ITheme = {
  background: "#f7f7fa",
  black: "#1d1d1f",
  blue: "#0a84ff",
  brightBlack: "#8e8e93",
  brightBlue: "#409cff",
  brightCyan: "#32ade6",
  brightGreen: "#34c759",
  brightMagenta: "#bf5af2",
  brightRed: "#ff453a",
  brightWhite: "#ffffff",
  brightYellow: "#ff9f0a",
  cursor: "#1d1d1f",
  cyan: "#007aff",
  foreground: "#1d1d1f",
  green: "#248a3d",
  magenta: "#af52de",
  red: "#d70015",
  selectionBackground: "#0a84ff33",
  white: "#f2f2f7",
  yellow: "#b25000",
};

const kerminalDarkTheme: ITheme = {
  background: "#1f1f21",
  black: "#18181b",
  blue: "#60a5fa",
  brightBlack: "#71717a",
  brightBlue: "#93c5fd",
  brightCyan: "#67e8f9",
  brightGreen: "#86efac",
  brightMagenta: "#d8b4fe",
  brightRed: "#fca5a5",
  brightWhite: "#fafafa",
  brightYellow: "#fde68a",
  cursor: "#f8fafc",
  cyan: "#22d3ee",
  foreground: "#e4e4e7",
  green: "#4ade80",
  magenta: "#c084fc",
  red: "#f87171",
  selectionBackground: "#38bdf866",
  white: "#e4e4e7",
  yellow: "#facc15",
};

const tokyoNightTheme: ITheme = {
  background: "#1a1b26",
  black: "#15161e",
  blue: "#7aa2f7",
  brightBlack: "#565f89",
  brightBlue: "#7dcfff",
  brightCyan: "#7dcfff",
  brightGreen: "#9ece6a",
  brightMagenta: "#bb9af7",
  brightRed: "#f7768e",
  brightWhite: "#c0caf5",
  brightYellow: "#e0af68",
  cursor: "#c0caf5",
  cyan: "#2ac3de",
  foreground: "#c0caf5",
  green: "#9ece6a",
  magenta: "#bb9af7",
  red: "#f7768e",
  selectionBackground: "#33467c99",
  white: "#a9b1d6",
  yellow: "#e0af68",
};

const tokyoDayTheme: ITheme = {
  background: "#e1e2e7",
  black: "#343b58",
  blue: "#34548a",
  brightBlack: "#9699a3",
  brightBlue: "#166775",
  brightCyan: "#0f4b6e",
  brightGreen: "#485e30",
  brightMagenta: "#5a4a78",
  brightRed: "#8c4351",
  brightWhite: "#ffffff",
  brightYellow: "#8f5e15",
  cursor: "#343b58",
  cyan: "#166775",
  foreground: "#343b58",
  green: "#485e30",
  magenta: "#5a4a78",
  red: "#8c4351",
  selectionBackground: "#7aa2f733",
  white: "#d5d6db",
  yellow: "#8f5e15",
};

const solarizedDarkTheme: ITheme = {
  background: "#002b36",
  black: "#073642",
  blue: "#268bd2",
  brightBlack: "#586e75",
  brightBlue: "#839496",
  brightCyan: "#93a1a1",
  brightGreen: "#586e75",
  brightMagenta: "#6c71c4",
  brightRed: "#cb4b16",
  brightWhite: "#fdf6e3",
  brightYellow: "#657b83",
  cursor: "#93a1a1",
  cyan: "#2aa198",
  foreground: "#839496",
  green: "#859900",
  magenta: "#d33682",
  red: "#dc322f",
  selectionBackground: "#073642",
  white: "#eee8d5",
  yellow: "#b58900",
};

const solarizedLightTheme: ITheme = {
  background: "#fdf6e3",
  black: "#073642",
  blue: "#268bd2",
  brightBlack: "#839496",
  brightBlue: "#839496",
  brightCyan: "#93a1a1",
  brightGreen: "#586e75",
  brightMagenta: "#6c71c4",
  brightRed: "#cb4b16",
  brightWhite: "#fdf6e3",
  brightYellow: "#657b83",
  cursor: "#586e75",
  cyan: "#2aa198",
  foreground: "#657b83",
  green: "#859900",
  magenta: "#d33682",
  red: "#dc322f",
  selectionBackground: "#eee8d5",
  white: "#eee8d5",
  yellow: "#b58900",
};

const githubDarkTheme: ITheme = {
  background: "#0d1117",
  black: "#484f58",
  blue: "#58a6ff",
  brightBlack: "#6e7681",
  brightBlue: "#79c0ff",
  brightCyan: "#56d4dd",
  brightGreen: "#7ee787",
  brightMagenta: "#d2a8ff",
  brightRed: "#ffa198",
  brightWhite: "#f0f6fc",
  brightYellow: "#d29922",
  cursor: "#f0f6fc",
  cyan: "#39c5cf",
  foreground: "#c9d1d9",
  green: "#3fb950",
  magenta: "#bc8cff",
  red: "#ff7b72",
  selectionBackground: "#1f6feb55",
  white: "#b1bac4",
  yellow: "#d29922",
};

const githubLightTheme: ITheme = {
  background: "#ffffff",
  black: "#24292f",
  blue: "#0969da",
  brightBlack: "#6e7781",
  brightBlue: "#218bff",
  brightCyan: "#1b7c83",
  brightGreen: "#1a7f37",
  brightMagenta: "#a475f9",
  brightRed: "#cf222e",
  brightWhite: "#ffffff",
  brightYellow: "#9a6700",
  cursor: "#24292f",
  cyan: "#1b7c83",
  foreground: "#24292f",
  green: "#1a7f37",
  magenta: "#8250df",
  red: "#cf222e",
  selectionBackground: "#0969da26",
  white: "#f6f8fa",
  yellow: "#9a6700",
};
