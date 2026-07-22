import type {
  PortForwardOrigin,
  PortForwardSummary,
} from "../../../lib/portForwardApi";

export type PortForwardScenario =
  | "hostService"
  | "localService"
  | "socksAdvanced";

export type BindAddressMode = "loopback" | "all" | "custom";

export type SocksAdvancedMode = "localDynamic" | "remoteDynamic";

export interface PortForwardScenarioOption {
  description: string;
  flow: string;
  id: PortForwardScenario;
  label: string;
  openssh: string;
}

const LOOPBACK_BIND_HOST = "127.0.0.1";
const ALL_INTERFACES_BIND_HOST = "0.0.0.0";

export const portForwardScenarioOptions: PortForwardScenarioOption[] = [
  {
    description: "本机访问主机服务。",
    flow: "把主机服务映射到本机端口",
    id: "hostService",
    label: "访问主机服务",
    openssh: "-L",
  },
  {
    description: "主机访问本机服务。",
    flow: "把主机端口映射到本机服务",
    id: "localService",
    label: "暴露本机服务",
    openssh: "-R",
  },
  {
    description: "在本机或主机创建 SOCKS 代理。",
    flow: "选择 SOCKS 代理方向",
    id: "socksAdvanced",
    label: "SOCKS / 高级",
    openssh: "-D / remote -R",
  },
];

export function flowForScenario(
  scenario: PortForwardScenario,
  socksMode: SocksAdvancedMode,
): string {
  if (scenario === "hostService") {
    return "本机 -> 主机";
  }
  if (scenario === "localService") {
    return "主机 -> 本机";
  }
  return socksMode === "remoteDynamic" ? "主机 -> 本机网络" : "本机 -> 主机网络";
}

export function opensshForScenario(
  scenario: PortForwardScenario,
  socksMode: SocksAdvancedMode,
): string {
  if (scenario === "hostService") {
    return "-L";
  }
  if (scenario === "localService") {
    return "-R";
  }
  return socksMode === "remoteDynamic" ? "remote -R SOCKS" : "-D";
}

export function parsePort(
  value: string,
  label: string,
): { ok: true; port: number } | { error: string; ok: false } {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { error: `${label}必须是 1-65535 的整数。`, ok: false };
  }
  return { ok: true, port };
}

export function resolveBindHost(
  mode: BindAddressMode,
  customHost: string,
): string {
  if (mode === "all") {
    return ALL_INTERFACES_BIND_HOST;
  }
  if (mode === "custom") {
    return customHost.trim() || LOOPBACK_BIND_HOST;
  }
  return LOOPBACK_BIND_HOST;
}

function isLoopbackBindHost(host: string | undefined): boolean {
  const normalized = (host ?? "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "localhost" ||
    normalized === LOOPBACK_BIND_HOST ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function isNonLoopbackBindHost(host: string | undefined): boolean {
  return !isLoopbackBindHost(host);
}

function proxyHostForRemoteUse(bindHost: string): string {
  const normalized = bindHost.trim();
  if (!normalized || normalized === ALL_INTERFACES_BIND_HOST) {
    return LOOPBACK_BIND_HOST;
  }
  if (normalized === "::") {
    return "::1";
  }
  return normalized;
}

export function buildProxyUrl({
  bindHost,
  port,
}: {
  bindHost: string;
  port: number;
}): string {
  return `socks5h://${formatProxyHost(proxyHostForRemoteUse(bindHost))}:${port}`;
}

export function buildRemoteSocksCommand({
  noProxy = "localhost,127.0.0.1",
  proxyUrl,
}: {
  noProxy?: string;
  proxyUrl: string;
}): string {
  const quotedProxy = shellQuote(proxyUrl);
  const quotedNoProxy = shellQuote(noProxy);
  return [
    `export ALL_PROXY=${quotedProxy}`,
    `export all_proxy=${quotedProxy}`,
    `export NO_PROXY=${quotedNoProxy}`,
    `export no_proxy=${quotedNoProxy}`,
  ].join("\n");
}

export function buildUserProxySetupScript(
  session: PortForwardSummary,
  noProxy = "localhost,127.0.0.1",
): string | undefined {
  const proxyUrl = proxyUrlForSession(session);
  if (!proxyUrl) {
    return undefined;
  }

  const sessionSlug = shellSafeSlug(session.id);
  const quotedProxy = shellQuote(proxyUrl);
  const quotedNoProxy = shellQuote(noProxy);
  const envExports = buildUserProxyEnvExports({ noProxy, proxyUrl });

  return [
    "#!/bin/sh",
    "set -eu",
    "",
    "# Kerminal remote SOCKS user-level setup.",
    "# Writes only under the current remote user's $HOME. No root required.",
    "# Review this script before running it on the remote host.",
    `KERM_PROXY_URL=${quotedProxy}`,
    `KERM_NO_PROXY=${quotedNoProxy}`,
    'KERM_HOME="${HOME:?HOME is required}"',
    `KERM_ID=${shellQuote(sessionSlug)}`,
    'KERM_DIR="$KERM_HOME/.kerminal/network-assist"',
    'KERM_ENV="$KERM_DIR/$KERM_ID.env"',
    'KERM_STATE="$KERM_DIR/$KERM_ID.state"',
    'KERM_PROFILE="$KERM_HOME/.profile"',
    'KERM_BEGIN="# >>> kerminal network assist $KERM_ID >>>"',
    'KERM_END="# <<< kerminal network assist $KERM_ID <<<"',
    "",
    'mkdir -p "$KERM_DIR"',
    "umask 077",
    "",
    "save_git_config() {",
    '  key="$1"',
    '  if value="$(git config --global --get "$key" 2>/dev/null)"; then',
    '    printf "git %s %s\\n" "$key" "$value" >> "$KERM_STATE"',
    "  else",
    '    printf "git %s __KERM_UNSET__\\n" "$key" >> "$KERM_STATE"',
    "  fi",
    "}",
    "",
    "save_npm_config() {",
    '  key="$1"',
    '  value="$(npm config get "$key" --location=user 2>/dev/null || true)"',
    '  if [ -n "$value" ] && [ "$value" != "null" ] && [ "$value" != "undefined" ]; then',
    '    printf "npm %s %s\\n" "$key" "$value" >> "$KERM_STATE"',
    "  else",
    '    printf "npm %s __KERM_UNSET__\\n" "$key" >> "$KERM_STATE"',
    "  fi",
    "}",
    "",
    "save_pip_config() {",
    '  pip_cmd="$1"',
    '  if value="$($pip_cmd config --user get global.proxy 2>/dev/null)"; then',
    '    printf "pip global.proxy %s\\n" "$value" >> "$KERM_STATE"',
    "  else",
    '    printf "pip global.proxy __KERM_UNSET__\\n" >> "$KERM_STATE"',
    "  fi",
    "}",
    "",
    'if [ ! -f "$KERM_STATE" ]; then',
    '  : > "$KERM_STATE"',
    '  if command -v git >/dev/null 2>&1; then',
    '    save_git_config http.proxy',
    '    save_git_config https.proxy',
    "  fi",
    '  if command -v npm >/dev/null 2>&1; then',
    '    save_npm_config proxy',
    '    save_npm_config https-proxy',
    "  fi",
    '  if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then',
    '    save_pip_config "python3 -m pip"',
    '  elif command -v pip3 >/dev/null 2>&1; then',
    '    save_pip_config pip3',
    '  elif command -v pip >/dev/null 2>&1; then',
    '    save_pip_config pip',
    "  fi",
    "fi",
    "",
    'cat > "$KERM_ENV" <<\'KERM_ENV_EOF\'',
    envExports,
    "KERM_ENV_EOF",
    "",
    'touch "$KERM_PROFILE"',
    'cp "$KERM_PROFILE" "$KERM_PROFILE.kerminal-backup.$(date +%Y%m%d%H%M%S)"',
    'if ! grep -F "$KERM_BEGIN" "$KERM_PROFILE" >/dev/null 2>&1; then',
    "  {",
    '    printf "\\n%s\\n" "$KERM_BEGIN"',
    '    printf "[ -f %s ] && . %s\\n" "$KERM_ENV" "$KERM_ENV"',
    '    printf "%s\\n" "$KERM_END"',
    '  } >> "$KERM_PROFILE"',
    "fi",
    "",
    'if command -v git >/dev/null 2>&1; then',
    '  git config --global http.proxy "$KERM_PROXY_URL"',
    '  git config --global https.proxy "$KERM_PROXY_URL"',
    "fi",
    'if command -v npm >/dev/null 2>&1; then',
    '  npm config set proxy "$KERM_PROXY_URL" --location=user',
    '  npm config set https-proxy "$KERM_PROXY_URL" --location=user',
    "fi",
    'if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then',
    '  python3 -m pip config --user set global.proxy "$KERM_PROXY_URL"',
    'elif command -v pip3 >/dev/null 2>&1; then',
    '  pip3 config --user set global.proxy "$KERM_PROXY_URL"',
    'elif command -v pip >/dev/null 2>&1; then',
    '  pip config --user set global.proxy "$KERM_PROXY_URL"',
    "fi",
    "",
    'printf "Kerminal user proxy config installed. Restart the shell or run: . %s\\n" "$KERM_ENV"',
  ].join("\n");
}

export function buildUserProxyUndoScript(
  session: PortForwardSummary,
): string | undefined {
  if (!proxyUrlForSession(session)) {
    return undefined;
  }

  const sessionSlug = shellSafeSlug(session.id);
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    "# Kerminal remote SOCKS user-level undo.",
    "# Writes only under the current remote user's $HOME. No root required.",
    `KERM_ID=${shellQuote(sessionSlug)}`,
    'KERM_HOME="${HOME:?HOME is required}"',
    'KERM_DIR="$KERM_HOME/.kerminal/network-assist"',
    'KERM_ENV="$KERM_DIR/$KERM_ID.env"',
    'KERM_STATE="$KERM_DIR/$KERM_ID.state"',
    'KERM_PROFILE="$KERM_HOME/.profile"',
    'KERM_BEGIN="# >>> kerminal network assist $KERM_ID >>>"',
    'KERM_END="# <<< kerminal network assist $KERM_ID <<<"',
    "",
    "state_value() {",
    '  tool="$1"',
    '  key="$2"',
    '  grep -F "$tool $key " "$KERM_STATE" 2>/dev/null | tail -n 1 | sed "s/^$tool $key //"',
    "}",
    "",
    "restore_git_config() {",
    '  key="$1"',
    '  command -v git >/dev/null 2>&1 || return 0',
    '  value="$(state_value git "$key")"',
    '  if [ "$value" = "__KERM_UNSET__" ] || [ -z "$value" ]; then',
    '    git config --global --unset "$key" >/dev/null 2>&1 || true',
    "  else",
    '    git config --global "$key" "$value"',
    "  fi",
    "}",
    "",
    "restore_npm_config() {",
    '  key="$1"',
    '  command -v npm >/dev/null 2>&1 || return 0',
    '  value="$(state_value npm "$key")"',
    '  if [ "$value" = "__KERM_UNSET__" ] || [ -z "$value" ]; then',
    '    npm config delete "$key" --location=user >/dev/null 2>&1 || true',
    "  else",
    '    npm config set "$key" "$value" --location=user',
    "  fi",
    "}",
    "",
    "restore_pip_config() {",
    '  value="$(state_value pip global.proxy)"',
    '  if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then',
    '    pip_cmd="python3 -m pip"',
    '  elif command -v pip3 >/dev/null 2>&1; then',
    '    pip_cmd="pip3"',
    '  elif command -v pip >/dev/null 2>&1; then',
    '    pip_cmd="pip"',
    "  else",
    "    return 0",
    "  fi",
    '  if [ "$value" = "__KERM_UNSET__" ] || [ -z "$value" ]; then',
    '    $pip_cmd config --user unset global.proxy >/dev/null 2>&1 || true',
    "  else",
    '    $pip_cmd config --user set global.proxy "$value"',
    "  fi",
    "}",
    "",
    'if [ -f "$KERM_PROFILE" ]; then',
    '  cp "$KERM_PROFILE" "$KERM_PROFILE.kerminal-undo-backup.$(date +%Y%m%d%H%M%S)"',
    '  tmp="$KERM_PROFILE.kerminal-tmp.$$"',
    '  awk -v begin="$KERM_BEGIN" -v end="$KERM_END" \'$0 == begin {skip=1; next} $0 == end {skip=0; next} !skip {print}\' "$KERM_PROFILE" > "$tmp"',
    '  mv "$tmp" "$KERM_PROFILE"',
    "fi",
    "",
    'if [ -f "$KERM_STATE" ]; then',
    "  restore_git_config http.proxy",
    "  restore_git_config https.proxy",
    "  restore_npm_config proxy",
    "  restore_npm_config https-proxy",
    "  restore_pip_config",
    "else",
    '  command -v git >/dev/null 2>&1 && git config --global --unset http.proxy >/dev/null 2>&1 || true',
    '  command -v git >/dev/null 2>&1 && git config --global --unset https.proxy >/dev/null 2>&1 || true',
    '  command -v npm >/dev/null 2>&1 && npm config delete proxy --location=user >/dev/null 2>&1 || true',
    '  command -v npm >/dev/null 2>&1 && npm config delete https-proxy --location=user >/dev/null 2>&1 || true',
    "fi",
    "",
    'rm -f "$KERM_ENV" "$KERM_STATE"',
    'rmdir "$KERM_DIR" 2>/dev/null || true',
    'printf "Kerminal user proxy config removed. Restart the shell to clear sourced env.\\n"',
  ].join("\n");
}

export function isRemoteDynamicSocks(session: PortForwardSummary): boolean {
  return (
    session.kind === "remoteDynamic" ||
    (session.kind === "remote" &&
      session.proxyProtocol === "socks5" &&
      !session.targetHost &&
      !session.targetPort)
  );
}

export function isLegacyHttpNetworkAssist(
  session: PortForwardSummary,
): boolean {
  return (
    session.kind === "remote" &&
    session.proxyProtocol === "http" &&
    session.origin === "networkAssist"
  );
}

export function sessionOrigin(session: PortForwardSummary): PortForwardOrigin {
  return session.origin ?? "user";
}

export function proxyUrlForSession(
  session: PortForwardSummary,
): string | undefined {
  if (!isRemoteDynamicSocks(session)) {
    return undefined;
  }
  if (session.proxyUrl?.startsWith("socks5h://")) {
    return session.proxyUrl;
  }
  return buildProxyUrl({
    bindHost: session.remoteBindHost ?? session.bindHost,
    port: session.sourcePort,
  });
}

export function sessionDirectionLabel(session: PortForwardSummary): string {
  if (isRemoteDynamicSocks(session)) {
    return "主机 -> 本机网络";
  }
  if (session.kind === "remote") {
    return "主机 -> 本机";
  }
  if (session.kind === "dynamic") {
    return "本机 -> 主机网络";
  }
  return "本机 -> 主机";
}

export function sessionHostEndpoint(session: PortForwardSummary): string {
  if (session.remoteEndpoint?.host) {
    return endpointToString(
      session.remoteEndpoint.host,
      session.remoteEndpoint.port,
    );
  }
  if (isRemoteDynamicSocks(session)) {
    return endpointToString(session.remoteBindHost ?? session.bindHost, session.sourcePort);
  }
  if (session.kind === "local") {
    return endpointToString(session.targetHost ?? "127.0.0.1", session.targetPort);
  }
  if (session.kind === "dynamic") {
    return "主机网络出口";
  }
  return endpointToString(session.bindHost, session.sourcePort);
}

export function sessionLocalEndpoint(session: PortForwardSummary): string {
  if (session.localEndpoint?.host) {
    return endpointToString(session.localEndpoint.host, session.localEndpoint.port);
  }
  if (isRemoteDynamicSocks(session)) {
    return "Kerminal 本机网络出口";
  }
  if (session.kind === "remote") {
    return endpointToString(session.targetHost ?? "127.0.0.1", session.targetPort);
  }
  return endpointToString(session.bindHost, session.sourcePort);
}

export function copyAddressForSession(session: PortForwardSummary): string {
  const proxyUrl = proxyUrlForSession(session);
  if (proxyUrl) {
    return proxyUrl;
  }
  return session.kind === "remote"
    ? sessionHostEndpoint(session)
    : sessionLocalEndpoint(session);
}

function endpointToString(host: string, port: number | undefined): string {
  return port ? `${host}:${port}` : host;
}

function formatProxyHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellSafeSlug(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "session";
}

function buildUserProxyEnvExports({
  noProxy,
  proxyUrl,
}: {
  noProxy: string;
  proxyUrl: string;
}): string {
  const quotedProxy = shellQuote(proxyUrl);
  const quotedNoProxy = shellQuote(noProxy);
  return [
    `export ALL_PROXY=${quotedProxy}`,
    `export all_proxy=${quotedProxy}`,
    `export NO_PROXY=${quotedNoProxy}`,
    `export no_proxy=${quotedNoProxy}`,
  ].join("\n");
}
