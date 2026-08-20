// @author kongweiguang

import { describe, expect, it } from "vitest";
import appCss from "../../../src/App.css?raw";

const requiredSemanticTokens = [
  "--surface-border",
  "--surface-card",
  "--surface-elevated",
  "--surface-panel",
  "--text-primary",
  "--text-secondary",
] as const;

const requiredLayerTokens = [
  "--layer-chrome",
  "--layer-popover",
  "--layer-palette",
  "--layer-overlay",
  "--layer-dialog",
  "--layer-toast",
  "--layer-drag-preview",
] as const;

describe("App CSS token contract", () => {
  it("defines every semantic token consumed by production UI", () => {
    for (const token of requiredSemanticTokens) {
      expect(appCss).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("defines the semantic portal layer order", () => {
    const values = requiredLayerTokens.map((token) => {
      const match = appCss.match(new RegExp(`${token}\\s*:\\s*(\\d+)`));
      expect(match, `${token} must have a numeric layer`).not.toBeNull();
      return Number(match?.[1]);
    });

    expect(values).toEqual([...values].sort((left, right) => left - right));
    expect(new Set(values).size).toBe(values.length);
  });

  it("applies density variables at document root so body portals inherit them", () => {
    expect(appCss).toContain('html[data-density="compact"]');
    expect(appCss).toContain('html[data-density="spacious"]');
    expect(appCss).toMatch(
      /html\[data-density="compact"\][\s\S]*?--density-control-height:\s*28px/,
    );
    expect(appCss).toMatch(
      /html\[data-density="spacious"\][\s\S]*?--density-control-height:\s*36px/,
    );
  });

  it("keeps dense content surfaces solid and shadowless", () => {
    expect(appCss).toMatch(/--surface-solid:\s*var\(--surface-content\)/);
    expect(appCss).toMatch(
      /\.kerminal-solid-surface\s*\{[\s\S]*?box-shadow:\s*none/,
    );
  });

  it("keeps every desktop tool-panel placement on one wallpaper-aware material", () => {
    expect(appCss).toMatch(
      /\[data-background-image-visible="true"\]\s+\.kerminal-tool-panel-surface\s*\{[\s\S]*?background:\s*color-mix\([\s\S]*?transparent[\s\S]*?backdrop-filter:\s*blur\(18px\)/,
    );
    expect(appCss).toMatch(
      /\.kerminal-tool-panel-host\[data-compositor="surface-parent"\][\s\S]*?>\s*\.kerminal-material-nav\s*\{[\s\S]*?background:\s*transparent[\s\S]*?backdrop-filter:\s*none/,
    );
    expect(appCss).toMatch(
      /\[data-panel-resizing\^="tools-"\]\s+\.kerminal-tool-panel-surface,[\s\S]*?data-floating-tool-panel-dragging="true"[\s\S]*?backdrop-filter:\s*none/,
    );
  });
});
