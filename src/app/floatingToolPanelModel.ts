// @author kongweiguang

export interface FloatingToolPanelPoint {
  x: number;
  y: number;
}

export interface FloatingToolPanelSize {
  height: number;
  width: number;
}

export interface FloatingToolPanelInsets {
  margin: number;
  top: number;
}

const defaultFloatingToolPanelInsets: FloatingToolPanelInsets = {
  margin: 8,
  top: 44,
};

/**
 * 将浮窗约束在 Shell 内，并始终把完整标题栏留在可操作区域；当极窄窗口无法
 * 容纳面板时优先保住左上角关闭与拖动入口，而不是允许窗口彻底移出视口。
 */
export function clampFloatingToolPanelPoint(
  point: FloatingToolPanelPoint,
  host: FloatingToolPanelSize,
  panel: FloatingToolPanelSize,
  insets: FloatingToolPanelInsets = defaultFloatingToolPanelInsets,
): FloatingToolPanelPoint {
  const minimumX = insets.margin;
  const minimumY = insets.top;
  const maximumX = Math.max(minimumX, host.width - panel.width - insets.margin);
  const maximumY = Math.max(minimumY, host.height - panel.height - insets.margin);
  return {
    x: Math.min(maximumX, Math.max(minimumX, point.x)),
    y: Math.min(maximumY, Math.max(minimumY, point.y)),
  };
}

/**
 * 第一次打开仍从工作区中心出现以保持可发现性，随后拖动位置由运行时宿主按工具
 * 分别记忆；中心点同样经过边界约束，兼容小窗口和三种界面密度。
 */
export function resolveInitialFloatingToolPanelPoint(
  host: FloatingToolPanelSize,
  panel: FloatingToolPanelSize,
  insets: FloatingToolPanelInsets = defaultFloatingToolPanelInsets,
): FloatingToolPanelPoint {
  return clampFloatingToolPanelPoint(
    {
      x: (host.width - panel.width) / 2,
      y: (host.height - panel.height + insets.top) / 2,
    },
    host,
    panel,
    insets,
  );
}
