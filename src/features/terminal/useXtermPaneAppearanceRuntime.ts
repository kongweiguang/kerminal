// @author kongweiguang

import type { FontWeight, ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import {
  terminalFontWeightValue,
  xtermThemeForTerminalSurface,
  type TerminalRendererType,
} from "../settings/contracts/index";
import { stableJsonDependencyKey } from "./XtermPane.helpers";
import type { XtermPaneProps } from "./XtermPane.types";
import type { TerminalPaneRuntimeLifecycleRuntime } from "./terminalPaneRuntimeLifecycleRuntime";
import { terminalRendererRegistry } from "./terminalRendererRegistry";
import type { TerminalKeywordHighlightController } from "./terminalKeywordHighlightController";
import {
  terminalWebLinkDecorationColorForTheme,
  type TerminalWebLinkDecorationController,
} from "./terminalWebLinkDecorationController";

interface UseXtermPaneAppearanceRuntimeOptions {
  args: XtermPaneProps["args"];
  backgroundImageVisible: boolean;
  env: XtermPaneProps["env"];
  resolvedTheme: XtermPaneProps["resolvedTheme"];
  target: XtermPaneProps["target"];
  terminalAppearance: XtermPaneProps["terminalAppearance"];
  terminalColorSchemeOverride: XtermPaneProps["terminalColorSchemeOverride"];
}

interface UseXtermPaneTerminalOptionsHotUpdateOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  effectiveRendererType: TerminalRendererType;
  inputCompatibilityMode: XtermPaneProps["inputCompatibilityMode"];
  terminalAppearance: XtermPaneProps["terminalAppearance"];
  terminalAppearanceRef: MutableRefObject<XtermPaneProps["terminalAppearance"]>;
  terminalFontWeight: FontWeight;
  terminalRef: MutableRefObject<XtermTerminal | null>;
  terminalRuntimeLifecycleControllerRef: MutableRefObject<TerminalPaneRuntimeLifecycleRuntime | null>;
  terminalSurfaceCoordinatorRef: MutableRefObject<
    ((invalidate?: boolean) => void) | null
  >;
  terminalTheme: ITheme;
  terminalThemeRef: MutableRefObject<ITheme>;
}

/**
 * 汇总 xterm 外观和安装参数的稳定派生值，并持有关键词与 URL 装饰 controller；
 * 抽离这些状态可避免纯外观变化重建 PTY，同时守住主生命周期文件体积门禁。
 */
export function useXtermPaneAppearanceRuntime({
  args,
  backgroundImageVisible,
  env,
  resolvedTheme,
  target,
  terminalAppearance,
  terminalColorSchemeOverride,
}: UseXtermPaneAppearanceRuntimeOptions) {
  const terminalTheme = useMemo(
    () =>
      xtermThemeForTerminalSurface(
        resolvedTheme,
        terminalColorSchemeOverride ??
          (resolvedTheme === "light"
            ? terminalAppearance.lightColorScheme
            : terminalAppearance.darkColorScheme),
        backgroundImageVisible,
      ),
    [
      backgroundImageVisible,
      resolvedTheme,
      terminalColorSchemeOverride,
      terminalAppearance.darkColorScheme,
      terminalAppearance.lightColorScheme,
    ],
  );
  const terminalThemeRef = useRef(terminalTheme);
  const terminalFontWeight = useMemo(
    () => terminalFontWeightValue(terminalAppearance.fontWeight),
    [terminalAppearance.fontWeight],
  );
  const argsDependencyKey = useMemo(
    () => stableJsonDependencyKey(args),
    [args],
  );
  const envDependencyKey = useMemo(() => stableJsonDependencyKey(env), [env]);
  const targetDependencyKey = useMemo(
    () => stableJsonDependencyKey(target),
    [target],
  );
  const terminalKeywordHighlightControllerRef =
    useRef<TerminalKeywordHighlightController | null>(null);
  const terminalWebLinkDecorationControllerRef =
    useRef<TerminalWebLinkDecorationController | null>(null);
  const runtimeInstallParamsRef = useRef({
    args,
    env,
    resolvedTheme,
    target,
    terminalAppearance,
    terminalFontWeight,
    terminalTheme,
  });
  runtimeInstallParamsRef.current = {
    args,
    env,
    resolvedTheme,
    target,
    terminalAppearance,
    terminalFontWeight,
    terminalTheme,
  };

  return {
    argsDependencyKey,
    envDependencyKey,
    runtimeInstallParamsRef,
    targetDependencyKey,
    terminalFontWeight,
    terminalKeywordHighlightControllerRef,
    terminalTheme,
    terminalThemeRef,
    terminalWebLinkDecorationControllerRef,
  };
}

/**
 * 在窗格可见性恢复和 xterm 外观更新之后再刷新装饰，避免高亮扫描抢在 fit 前执行；
 * 独立 hook 保持 React effect 的原有声明顺序，同时让 controller ref 继续由运行时持有。
 */
export function useTerminalKeywordHighlightHotUpdate(
  controllerRef: RefObject<TerminalKeywordHighlightController | null>,
  resolvedTheme: XtermPaneProps["resolvedTheme"],
  terminalAppearance: XtermPaneProps["terminalAppearance"],
  visible: boolean,
): void {
  useEffect(() => {
    controllerRef.current?.update({
      resolvedTheme,
      settings: terminalAppearance.keywordHighlights,
      visible,
    });
  }, [controllerRef, resolvedTheme, terminalAppearance.keywordHighlights, visible]);
}

/**
 * 将纯外观选项热写入现有 xterm，并只在真实表面变化时请求 renderer 全量刷新；
 * 这条路径不能重建终端，否则字体、配色或输入模式切换会断开正在运行的 PTY。
 */
export function useXtermPaneTerminalOptionsHotUpdate({
  containerRef,
  effectiveRendererType,
  inputCompatibilityMode,
  terminalAppearance,
  terminalAppearanceRef,
  terminalFontWeight,
  terminalRef,
  terminalRuntimeLifecycleControllerRef,
  terminalSurfaceCoordinatorRef,
  terminalTheme,
  terminalThemeRef,
}: UseXtermPaneTerminalOptionsHotUpdateOptions): void {
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const previousAppearance = terminalAppearanceRef.current;
    const previousTerminalTheme = terminalThemeRef.current;
    terminalAppearanceRef.current = terminalAppearance;
    terminalThemeRef.current = terminalTheme;
    terminal.options.cursorBlink = terminalAppearance.cursorBlink;
    terminal.options.cursorStyle = terminalAppearance.cursorStyle;
    terminal.options.fontFamily = terminalAppearance.fontFamily;
    terminal.options.fontSize = terminalAppearance.fontSize;
    terminal.options.fontWeight = terminalFontWeight;
    terminal.options.fontWeightBold = 700;
    terminal.options.lineHeight = terminalAppearance.lineHeight;
    terminal.options.macOptionIsMeta = terminalAppearance.macOptionIsMeta;
    terminal.options.scrollback = terminalAppearance.scrollback;
    terminal.options.theme = terminalTheme;
    terminalRuntimeLifecycleControllerRef.current?.markRendererType(
      effectiveRendererType,
    );
    terminalRendererRegistry.updateMode(effectiveRendererType);
    (terminal.options as { modifyOtherKeys?: number }).modifyOtherKeys =
      inputCompatibilityMode === "agentTui" ? 2 : 0;
    if (containerRef.current) {
      containerRef.current.style.fontFamily = terminalAppearance.fontFamily;
    }
    if (
      previousAppearance !== terminalAppearance ||
      previousTerminalTheme !== terminalTheme
    ) {
      terminalSurfaceCoordinatorRef.current?.(true);
    }
  }, [
    containerRef,
    effectiveRendererType,
    inputCompatibilityMode,
    terminalAppearance,
    terminalAppearanceRef,
    terminalFontWeight,
    terminalRef,
    terminalRuntimeLifecycleControllerRef,
    terminalSurfaceCoordinatorRef,
    terminalTheme,
    terminalThemeRef,
  ]);
}

/**
 * 主题切换后用终端配色方案的 blue token 重画 URL，窗格隐藏时则立即释放装饰；
 * 独立热更新保证跟随系统主题不会重连 PTY，也不改变 URL provider 的点击状态。
 */
export function useTerminalWebLinkDecorationHotUpdate(
  controllerRef: RefObject<TerminalWebLinkDecorationController | null>,
  resolvedTheme: XtermPaneProps["resolvedTheme"],
  terminalTheme: ReturnType<typeof xtermThemeForTerminalSurface>,
  visible: boolean,
): void {
  useEffect(() => {
    controllerRef.current?.update({
      foregroundColor: terminalWebLinkDecorationColorForTheme(
        terminalTheme,
        resolvedTheme,
      ),
      visible,
    });
  }, [controllerRef, resolvedTheme, terminalTheme, visible]);
}
