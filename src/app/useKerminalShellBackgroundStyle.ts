// @author kongweiguang

import { useMemo, type CSSProperties } from "react";
import type { AppSettings, ResolvedTheme } from "../features/settings/settingsModel";
import {
  workspaceBackgroundColor,
  workspaceBackgroundImage,
} from "./KerminalShell.helpers";

function formatCssAlpha(value: number) {
  return String(Number(value.toFixed(4)));
}

function clampCssAlpha(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 将外观设置收敛成 Shell 级 CSS 变量。壁纸可见时，导航保留较深玻璃材质，
 * 工作区与终端主体则只留轻微染色，避免连续三层半透明表面重新叠成实色。
 */
export function useKerminalShellBackgroundStyle({
  resolvedTheme,
  settings,
}: {
  resolvedTheme: ResolvedTheme;
  settings: AppSettings;
}) {
  return useMemo<CSSProperties>(() => {
    const windowOpacity =
      Math.min(Math.max(settings.appearance.windowOpacity, 35), 100) / 100;
    const hasBackgroundImage =
      settings.appearance.backgroundEnabled &&
      Boolean(settings.appearance.backgroundImagePath.trim());
    const imageVisibility = hasBackgroundImage
      ? Math.min(Math.max(settings.appearance.backgroundOpacity, 0), 100) / 100
      : 0;
    const backgroundImageVisible = imageVisibility > 0;
    const transparencyDepth = 1 - windowOpacity;
    const chromeSurfaceOpacity = clampCssAlpha(
      backgroundImageVisible
        ? (resolvedTheme === "dark" ? 0.62 : 0.66) -
            transparencyDepth * 0.06 -
            imageVisibility * 0.26
        : (resolvedTheme === "dark" ? 0.72 : 0.76) -
            transparencyDepth * 0.08,
      resolvedTheme === "dark" ? 0.36 : 0.4,
      0.82,
    );
    const workspaceSurfaceOpacity = backgroundImageVisible
      ? clampCssAlpha(0.12 - imageVisibility * 0.1, 0.035, 0.12)
      : chromeSurfaceOpacity;
    const terminalSurfaceOpacity = clampCssAlpha(
      backgroundImageVisible
        ? 0.14 - imageVisibility * 0.12
        : (resolvedTheme === "dark" ? 0.72 : 0.76) -
            transparencyDepth * 0.08,
      backgroundImageVisible ? 0.04 : resolvedTheme === "dark" ? 0.62 : 0.66,
      0.84,
    );
    const terminalHeaderOpacity = backgroundImageVisible
      ? clampCssAlpha(0.28 - imageVisibility * 0.08, 0.2, 0.28)
      : clampCssAlpha(
          terminalSurfaceOpacity + 0.05,
          resolvedTheme === "dark" ? 0.68 : 0.7,
          0.88,
        );
    const backgroundVeilOpacity =
      hasBackgroundImage
        ? clampCssAlpha(
            1 -
              imageVisibility *
                (1 - (resolvedTheme === "dark" ? 0.3 : 0.42)),
            resolvedTheme === "dark" ? 0.3 : 0.42,
            1,
          )
        : 0;
    return {
      "--app-background-veil-opacity": formatCssAlpha(backgroundVeilOpacity),
      "--app-window-opacity": formatCssAlpha(windowOpacity),
      "--app-nav-surface-opacity": formatCssAlpha(chromeSurfaceOpacity),
      "--app-workspace-surface-opacity": formatCssAlpha(workspaceSurfaceOpacity),
      "--app-terminal-header-opacity": formatCssAlpha(terminalHeaderOpacity),
      "--app-terminal-surface-opacity": formatCssAlpha(terminalSurfaceOpacity),
      backgroundColor: workspaceBackgroundColor(
        settings.appearance.windowOpacity,
        resolvedTheme,
      ),
      backgroundImage: workspaceBackgroundImage(
        settings.appearance.backgroundEnabled,
        settings.appearance.backgroundImagePath,
        resolvedTheme,
      ),
      backgroundPosition: "center",
      backgroundRepeat:
        settings.appearance.backgroundFit === "tile" ? "repeat" : "no-repeat",
      backgroundSize:
        settings.appearance.backgroundFit === "tile"
          ? "auto"
          : settings.appearance.backgroundFit,
    } as CSSProperties;
  }, [
    resolvedTheme,
    settings.appearance.backgroundEnabled,
    settings.appearance.backgroundFit,
    settings.appearance.backgroundImagePath,
    settings.appearance.backgroundOpacity,
    settings.appearance.windowOpacity,
  ]);
}
