// @author kongweiguang

import type { InterfaceDensity } from "../settings/contracts/index";

export function resolveSftpTransferWorkbenchLayout(
  interfaceDensity: InterfaceDensity,
) {
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  return {
    bodyGridClass: compactDensity
      ? "grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
      : spaciousDensity
        ? "grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
        : "grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]",
    headerActionClass: compactDensity
      ? "h-8 w-8 rounded-[var(--radius-control)]"
      : spaciousDensity
        ? "h-10 w-10 rounded-[var(--radius-control)]"
        : "h-9 w-9 rounded-[var(--radius-control)]",
    headerIconClass: compactDensity
      ? "h-8 w-8 rounded-[var(--radius-control)]"
      : spaciousDensity
        ? "h-10 w-10 rounded-[var(--radius-control)]"
        : "h-9 w-9 rounded-[var(--radius-control)]",
    headerPaddingClass: compactDensity
      ? "px-3 py-2"
      : spaciousDensity
        ? "px-5 py-4"
        : "px-4 py-3",
  };
}
