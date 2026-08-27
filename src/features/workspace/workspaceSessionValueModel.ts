// @author kongweiguang

import type { MachineStatus, TerminalPane } from "./types";

/** 读取单调 ID 的数字后缀；不匹配时归零，避免损坏值推进计数器。 */
export function numericSuffix(value: string) {
  const match = /-(\d+)$/.exec(value);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** 文件访问级别只接受可持久化枚举，未知值保持缺省而不是扩大写权限。 */
export function normalizeWorkspaceFileAccess(value: unknown) {
  return value === "readonly" || value === "editable" ? value : undefined;
}

/** 文件来源必须落在 v3 schema 的已知集合，未来值不会被错误恢复。 */
export function normalizeWorkspaceFileSource(value: unknown) {
  return value === "sftp" ||
    value === "container" ||
    value === "composeYaml" ||
    value === "workspace" ||
    value === "local"
    ? value
    : undefined;
}

/** Pane 模式采用白名单恢复，避免损坏 Session 进入终端启动分支。 */
export function normalizePaneMode(
  value: unknown,
): TerminalPane["mode"] | undefined {
  return value === "local" ||
    value === "ssh" ||
    value === "telnet" ||
    value === "serial" ||
    value === "container" ||
    value === "preview"
    ? value
    : undefined;
}

/** 未知机器状态按离线恢复，避免界面把损坏数据显示为可用连接。 */
export function normalizeMachineStatus(value: unknown): MachineStatus {
  return value === "online" || value === "offline" || value === "warning"
    ? value
    : "offline";
}

/** 只接受纯字符串数组，防止部分合法的脏数组混入恢复状态。 */
export function normalizeStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

/** 去除空值和重复项，同时保持 Session 中首次出现的顺序。 */
export function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

/** 只保留字符串值的记录，避免未知字段污染终端环境变量等强类型数据。 */
export function normalizeStringRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** 必填字符串字段用空串表示无效值，由上层统一决定是否拒绝实体。 */
export function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** 可选字符串字段把空串归一为缺省，避免恢复出无意义标识。 */
export function readOptionalString(value: unknown) {
  return readString(value) || undefined;
}

/** 仅恢复有限数值，拒绝 NaN 和 Infinity 进入布局计算。 */
export function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Session 解码只把非空对象视为记录，数组会由具体字段解析器进一步拒绝。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
