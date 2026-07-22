// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  normalizeAppSettings,
  resolveThemeMode,
  terminalColorSchemeForTheme,
  terminalFontOptions,
  terminalFontWeightValue,
} from "../../../../src/features/settings/settingsModel";

describe("settingsModel", () => {
  it("defaults terminal rendering to CPU without rewriting explicit modes", () => {
    expect(defaultAppSettings.interfaceDensity).toBe("compact");
    expect(normalizeAppSettings().interfaceDensity).toBe("compact");
    expect(defaultAppSettings.terminal.rendererType).toBe("cpu");
    expect(normalizeAppSettings().terminal.rendererType).toBe("cpu");

    for (const rendererType of ["auto", "cpu", "gpu"] as const) {
      const settings = normalizeAppSettings({
        terminal: {
          ...defaultAppSettings.terminal,
          rendererType,
        },
      });

      expect(settings.terminal.rendererType).toBe(rendererType);
    }
  });

  it("normalizes invalid appearance values to safe defaults", () => {
    const settings = normalizeAppSettings({
      appearance: {
        backgroundEnabled: true,
        backgroundFit: "poster",
        backgroundImagePath: " C:/Pictures/bg.png ",
        backgroundOpacity: 999,
        interfaceLanguage: "fr",
        windowOpacity: 12,
      },
      desktopNotifications: {
        backgroundOnly: "yes",
        enabled: "yes",
        importantOnly: true,
        minDurationMs: -1,
        throttleMs: 999_999,
      },
      externalLaunch: {
        acceptVendorArgs: false,
        autoOpenSftp: true,
        disabledTools: ["putty", "unknown", "putty", "kerminal-native"],
        enabled: false,
      },
      interfaceDensity: "tiny",
      terminal: {
        autoReconnect: false,
        colorScheme: "unknown",
        confirmCloseTab: false,
        cursorBlink: true,
        cursorStyle: "beam",
        darkColorScheme: "unknown",
        fontFamily: "",
        fontSize: 99,
        fontWeight: "heavy",
        inlineSuggestion: {
          acceptKey: "tab",
          enabled: "yes",
          productionHostPolicy: "open",
          providers: {
            git: false,
            history: 1,
            remoteCommand: false,
            remotePath: false,
            spec: "no",
          },
          remoteProbeEnabled: "no",
          auditRetentionDays: -1,
          feedbackRetentionDays: 99999,
        },
        lightColorScheme: "solarized",
        lineHeight: 9,
        macOptionIsMeta: true,
        rendererType: "metal",
        rightClickBehavior: "context",
        scrollback: 100,
        selectionCopy: true,
        showTabNumbers: true,
      },
      sftp: {
        globalTransfers: 999,
        hostTransfers: 999,
        packetBytes: 1,
        pipelineDepth: 0,
        timeoutSeconds: 999,
      },
      themeMode: "auto",
    } as unknown as Partial<typeof defaultAppSettings>);

    expect(settings.appearance).toMatchObject({
      backgroundEnabled: true,
      backgroundFit: defaultAppSettings.appearance.backgroundFit,
      backgroundImagePath: "C:/Pictures/bg.png",
      backgroundOpacity: 100,
      interfaceLanguage: defaultAppSettings.appearance.interfaceLanguage,
      windowOpacity: 35,
    });
    expect(settings.interfaceDensity).toBe(defaultAppSettings.interfaceDensity);
    expect(settings.themeMode).toBe(defaultAppSettings.themeMode);
    expect(settings.desktopNotifications).toMatchObject({
      backgroundOnly: defaultAppSettings.desktopNotifications.backgroundOnly,
      enabled: defaultAppSettings.desktopNotifications.enabled,
      importantOnly: true,
      minDurationMs: 1_000,
      throttleMs: 600_000,
    });
    expect(settings.externalLaunch).toEqual({
      acceptVendorArgs: false,
      autoOpenSftp: true,
      disabledTools: ["putty", "kerminal-native"],
      enabled: false,
    });
    expect(settings.terminal).toMatchObject({
      autoReconnect: false,
      colorScheme: defaultAppSettings.terminal.colorScheme,
      confirmCloseTab: false,
      cursorStyle: defaultAppSettings.terminal.cursorStyle,
      darkColorScheme: defaultAppSettings.terminal.darkColorScheme,
      fontFamily: defaultAppSettings.terminal.fontFamily,
      fontSize: 24,
      fontWeight: defaultAppSettings.terminal.fontWeight,
      inlineSuggestion: {
        acceptKey: defaultAppSettings.terminal.inlineSuggestion.acceptKey,
        enabled: defaultAppSettings.terminal.inlineSuggestion.enabled,
        productionHostPolicy:
          defaultAppSettings.terminal.inlineSuggestion.productionHostPolicy,
        providers: {
          git: false,
          history:
            defaultAppSettings.terminal.inlineSuggestion.providers.history,
          remoteCommand: false,
          remotePath: false,
          spec: defaultAppSettings.terminal.inlineSuggestion.providers.spec,
        },
        remoteProbeEnabled:
          defaultAppSettings.terminal.inlineSuggestion.remoteProbeEnabled,
        auditRetentionDays: 1,
        feedbackRetentionDays: 3650,
      },
      lightColorScheme: "solarized",
      lineHeight: 1.8,
      macOptionIsMeta: true,
      rendererType: defaultAppSettings.terminal.rendererType,
      rightClickBehavior: defaultAppSettings.terminal.rightClickBehavior,
      scrollback: 1000,
      selectionCopy: true,
      showTabNumbers: true,
    });
    expect(settings.sftp).toMatchObject({
      globalTransfers: 16,
      hostTransfers: 8,
      packetBytes: 32 * 1024,
      pipelineDepth: 1,
      timeoutSeconds: 300,
    });
  });

  it("keeps per-host SFTP concurrency at or below the global limit", () => {
    const settings = normalizeAppSettings({
      sftp: {
        ...defaultAppSettings.sftp,
        globalTransfers: 2,
        hostTransfers: 8,
      },
    });

    expect(settings.sftp.globalTransfers).toBe(2);
    expect(settings.sftp.hostTransfers).toBe(2);
  });

  it("migrates legacy command suggestion switches to the governed settings", () => {
    const disabled = normalizeAppSettings({
      terminal: {
        inlineSuggestion: {
          enabled: false,
          remoteProbeEnabled: false,
        },
      },
    } as Partial<typeof defaultAppSettings>);

    expect(disabled.terminal.inlineSuggestion).toMatchObject({
      enabled: false,
      presentation: "off",
      menuShortcut: "ctrlSpace",
      tabOpensMenu: false,
      partialAccept: true,
      remoteProbeEnabled: false,
      remoteRefresh: "off",
    });

    const legacyDefaults = normalizeAppSettings({
      terminal: {
        inlineSuggestion: {
          enabled: true,
          remoteProbeEnabled: true,
        },
      },
    } as Partial<typeof defaultAppSettings>);

    expect(legacyDefaults.terminal.inlineSuggestion).toMatchObject({
      enabled: true,
      presentation: "inlineAndMenu",
      remoteProbeEnabled: true,
      remoteRefresh: "safe",
    });
  });

  it("maps terminal font weight choices to xterm values", () => {
    expect(terminalFontWeightValue("normal")).toBe(400);
    expect(terminalFontWeightValue("medium")).toBe(500);
    expect(terminalFontWeightValue("bold")).toBe(600);
  });

  it("offers visually distinct terminal font choices with stable fallbacks", () => {
    expect(terminalFontOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "JetBrains Mono",
          value: expect.stringContaining("JetBrains Mono"),
        }),
        expect.objectContaining({
          label: "JetBrainsMono Nerd Font",
          value: expect.stringContaining("JetBrainsMono Nerd Font"),
        }),
        expect.objectContaining({
          label: "Fira Code",
          value: expect.stringContaining("Fira Code"),
        }),
        expect.objectContaining({
          label: "Hack",
          value: expect.stringContaining("Hack"),
        }),
        expect.objectContaining({
          label: "Source Code Pro",
          value: expect.stringContaining("Source Code Pro"),
        }),
        expect.objectContaining({
          label: "Iosevka Term",
          value: expect.stringContaining("Iosevka Term"),
        }),
        expect.objectContaining({
          label: "Consolas",
          value: expect.stringContaining("Consolas"),
        }),
        expect.objectContaining({
          label: "Lucida Console",
          value: expect.stringContaining("Lucida Console"),
        }),
        expect.objectContaining({
          label: "Courier New",
          value: expect.stringContaining("Courier New"),
        }),
      ]),
    );
    expect(terminalFontOptions.map((option) => option.value)).toContain(
      defaultAppSettings.terminal.fontFamily,
    );
  });

  it("ignores incomplete keybinding payloads and keeps current defaults", () => {
    const settings = normalizeAppSettings({
      keybindings: [
        {
          action: "terminal.newTab",
          binding: "Ctrl+Shift+T",
          editable: false,
          label: "新建终端 tab",
          scope: "workspace",
        },
      ] as typeof defaultAppSettings.keybindings,
    });

    expect(settings.keybindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "terminal.newTab",
          label: "新建本地终端",
          macBinding: "Cmd+Shift+T",
          windowsBinding: "Ctrl+Shift+T",
        }),
        expect.objectContaining({
          action: "terminal.closeTab",
        }),
      ]),
    );
  });

  it("selects separate terminal color schemes for light and dark themes", () => {
    const terminal = {
      ...defaultAppSettings.terminal,
      darkColorScheme: "tokyoNight" as const,
      lightColorScheme: "github" as const,
    };

    expect(terminalColorSchemeForTheme(terminal, "dark")).toBe("tokyoNight");
    expect(terminalColorSchemeForTheme(terminal, "light")).toBe("github");
  });

  it("resolves system theme mode from the operating system preference", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
  });
});
