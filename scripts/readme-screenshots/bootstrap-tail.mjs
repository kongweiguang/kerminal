// @author kongweiguang

export function browserBootstrapScriptTail() {
  return `      function dockerContainers(request = {}) {
        return [
          dockerContainer(request.hostId ?? "prod-api", {
            compose: composeMetadata("kerminal-stack", "api", "1"),
            id: "c0ffee1234567890",
            image: "kerminal/api:latest",
            name: "kerminal-stack-api-1",
            ports: ["0.0.0.0:8080->80/tcp"],
            state: "running",
            status: "running",
            statusText: "Up 12 minutes",
          }),
          dockerContainer(request.hostId ?? "prod-api", {
            compose: composeMetadata("kerminal-stack", "worker", "1"),
            id: "badc0de22222222",
            image: "kerminal/worker:latest",
            name: "kerminal-stack-worker-1",
            ports: [],
            state: "running",
            status: "running",
            statusText: "Up 8 minutes",
          }),
          dockerContainer(request.hostId ?? "prod-api", {
            compose: composeMetadata("kerminal-stack", "postgres", "1"),
            id: "deadbeef98765432",
            image: "postgres:16",
            name: "kerminal-stack-postgres-1",
            ports: ["5432/tcp"],
            state: "exited",
            status: "exited",
            statusText: "Exited (0) 2 hours ago",
          }),
          dockerContainer(request.hostId ?? "prod-api", {
            id: "feedface55555555",
            image: "redis:7",
            name: "cache-dev",
            ports: ["6379/tcp"],
            state: "running",
            status: "running",
            statusText: "Up 3 hours",
          }),
        ];
      }

      function dockerContainer(hostId, input) {
        const target = {
          containerId: input.id,
          containerName: input.name,
          hostId,
          kind: "dockerContainer",
          runtime: "docker",
        };
        return {
          capabilities: { files: true, serverInfo: true, terminal: true },
          compose: input.compose ?? null,
          hostId,
          id: input.id,
          image: input.image,
          labels: input.compose?.labels ?? {},
          name: input.name,
          ports: input.ports,
          runtime: "docker",
          shortId: input.id.slice(0, 12),
          state: input.state,
          status: input.status,
          statusText: input.statusText,
          target,
        };
      }

      function composeMetadata(project, service, containerNumber) {
        const workingDir = "/srv/kerminal";
        const configFile = "compose.yaml";
        return {
          configFiles: [configFile],
          configPaths: [workingDir + "/" + configFile],
          containerNumber,
          labels: {
            "com.docker.compose.container-number": containerNumber,
            "com.docker.compose.project": project,
            "com.docker.compose.project.config_files": configFile,
            "com.docker.compose.project.working_dir": workingDir,
            "com.docker.compose.service": service,
          },
          oneoff: false,
          project,
          runtimeFamily: "dockerCompose",
          service,
          workingDir,
        };
      }

      /** 同时提供 GPU 与 Ascend NPU 数据，让资源截图覆盖当前两类加速卡能力。 */
      function serverInfoSnapshot(request = {}) {
        return {
          architecture: "x86_64",
          capturedAt: "1782197600",
          cpuCount: 16,
          cpuCoreUsagePercents: [18, 22, 12, 31, 16, 14, 19, 27, 12, 18, 21, 13, 10, 15, 17, 24],
          cpuModel: "AMD EPYC 7B13",
          cpuUsagePercent: 18.6,
          diskAvailableBytes: 512 * 1024 * 1024 * 1024,
          diskMount: "/",
          diskTotalBytes: 1024 * 1024 * 1024 * 1024,
          diskUsedBytes: 512 * 1024 * 1024 * 1024,
          disks: [
            { availableBytes: 512 * 1024 * 1024 * 1024, filesystem: "/dev/nvme0n1p2", mount: "/", totalBytes: 1024 * 1024 * 1024 * 1024, usedBytes: 512 * 1024 * 1024 * 1024 },
            { availableBytes: 1800 * 1024 * 1024 * 1024, filesystem: "/dev/nvme1n1", mount: "/data", totalBytes: 2048 * 1024 * 1024 * 1024, usedBytes: 248 * 1024 * 1024 * 1024 },
          ],
          gpuProbeStatus: "nvidia_smi",
          gpus: [
            { driverVersion: "555.42", memoryTotalBytes: 24 * 1024 * 1024 * 1024, memoryUsedBytes: 8 * 1024 * 1024 * 1024, name: "NVIDIA RTX 4090", temperatureCelsius: 54, utilizationPercent: 36.5, vendor: "NVIDIA" },
            { driverVersion: "555.42", memoryTotalBytes: 24 * 1024 * 1024 * 1024, memoryUsedBytes: 5 * 1024 * 1024 * 1024, name: "NVIDIA RTX 4090", temperatureCelsius: 49, utilizationPercent: 22.1, vendor: "NVIDIA" },
          ],
          npuProbeStatus: "npu_smi",
          npus: [
            {
              busId: "0000:06:00.0",
              chipId: 0,
              hbmTotalBytes: 32 * 1024 * 1024 * 1024,
              hbmUsedBytes: 2659 * 1024 * 1024,
              health: "OK",
              id: 2,
              name: "Ascend 910B4",
              powerWatts: 84,
              temperatureCelsius: 44,
              utilizationPercent: 12.4,
            },
          ],
          host: "10.23.42.18",
          hostId: request.hostId ?? "prod-api",
          hostName: "prod-api",
          hostname: "prod-api",
          kernel: "6.8.0-63-generic",
          loadAverage: [0.88, 1.12, 1.24],
          memoryAvailableBytes: 46 * 1024 * 1024 * 1024,
          memoryBuffersBytes: 2 * 1024 * 1024 * 1024,
          memoryCachedBytes: 18 * 1024 * 1024 * 1024,
          memoryTotalBytes: 64 * 1024 * 1024 * 1024,
          memoryUsedBytes: 28 * 1024 * 1024 * 1024,
          networkInterfaces: [
            { name: "eth0", rxBytes: 4312345678, txBytes: 2198765432 },
            { name: "tailscale0", rxBytes: 612345678, txBytes: 512345678 },
          ],
          networkRxBytes: 4924691356,
          networkTxBytes: 2711111110,
          os: "Ubuntu 24.04 LTS",
          port: 22,
          processCount: 248,
          runningProcessCount: 6,
          swapTotalBytes: 8 * 1024 * 1024 * 1024,
          swapUsedBytes: 512 * 1024 * 1024,
          topProcesses: [
            { cpuUsagePercent: 16.2, memoryBytes: 1800 * 1024 * 1024, memoryPercent: 2.8, name: "python", pid: 4210 },
            { cpuUsagePercent: 8.4, memoryBytes: 680 * 1024 * 1024, memoryPercent: 1.1, name: "node", pid: 1882 },
            { cpuUsagePercent: 6.1, memoryBytes: 240 * 1024 * 1024, memoryPercent: 0.4, name: "dockerd", pid: 812 },
          ],
          uptimeSeconds: 827_440,
          username: "deploy",
        };
      }

      function sftpListing(request = {}) {
        const path = request.path || "/srv/kerminal";
        return {
          entries: [
            { kind: "directory", modified: "1782193800", name: "config", path: path + "/config", permissions: "drwxr-xr-x", raw: "drwxr-xr-x config", size: 4096 },
            { kind: "directory", modified: "1782194100", name: "logs", path: path + "/logs", permissions: "drwxr-xr-x", raw: "drwxr-xr-x logs", size: 4096 },
            { kind: "directory", modified: "1782194300", name: "releases", path: path + "/releases", permissions: "drwxr-xr-x", raw: "drwxr-xr-x releases", size: 4096 },
            { kind: "file", modified: "1782195200", name: ".env", path: path + "/.env", permissions: "-rw-------", raw: "-rw------- .env", size: 128 },
            { kind: "file", modified: "1782196500", name: "deploy.log", path: path + "/deploy.log", permissions: "-rw-r--r--", raw: "-rw-r--r-- deploy.log", size: 73421 },
            { kind: "file", modified: "1782197000", name: "release-2026-06-23.tar.gz", path: path + "/release-2026-06-23.tar.gz", permissions: "-rw-r--r--", raw: "-rw-r--r-- release", size: 14821376 },
          ],
          hostId: request.hostId ?? "prod-api",
          parentPath: "/srv",
          path,
        };
      }

      /** 固定书签既展示当前能力，也避免读取拍摄用户自己的远程路径收藏。 */
      function sftpBookmarks() {
        return [
          { createdAtUnixMs: 1782197000000, path: "/srv/kerminal" },
          { createdAtUnixMs: 1782196800000, path: "/var/log" },
        ];
      }

      function localListing(path) {
        const normalizedPath =
          typeof path === "string" && path.trim()
            ? path.trim()
            : "C:/Users/kong/Downloads";
        return {
          entries: [
            { hidden: false, kind: "directory", modified: "1782193000", name: "deploy-artifacts", path: normalizedPath + "/deploy-artifacts", raw: "directory deploy-artifacts", size: null },
            { hidden: false, kind: "file", modified: "1782193600", name: "kerminal-config.toml", path: normalizedPath + "/kerminal-config.toml", raw: "file kerminal-config.toml", size: 8420 },
            { hidden: false, kind: "file", modified: "1782193700", name: "release-notes.md", path: normalizedPath + "/release-notes.md", raw: "file release-notes.md", size: 19124 },
          ],
          parentPath: "C:/Users/kong",
          path: normalizedPath,
        };
      }

      function sftpTransfers(request = {}) {
        const now = Date.now();
        const viewScope = request?.viewScope ?? "sidebar:prod-api:tab-prod-api";
        const releaseRemotePath = "/srv/kerminal/release-2026-06-23.tar.gz";
        const releaseLocalPath = "C:/Users/kong/Downloads/release-2026-06-23.tar.gz";
        const deployLogRemotePath = "/srv/kerminal/deploy.log";
        const deployLogLocalPath = "C:/Users/kong/Downloads/deploy.log";
        return [
          {
            bytesTransferred: 9581363,
            cancelRequested: false,
            conflictPolicy: "rename",
            createdAt: now - 120000,
            direction: "download",
            hostId: "prod-api",
            id: "transfer-running",
            kind: "file",
            localPath: releaseLocalPath,
            operation: "download",
            phase: "streaming",
            remotePath: releaseRemotePath,
            source: { kind: "remote", hostId: "prod-api", hostLabel: "prod-api", path: releaseRemotePath },
            status: "running",
            target: { kind: "local", path: releaseLocalPath },
            totalBytes: 14821376,
            transportMode: "singleHostSftp",
            updatedAt: now - 1000,
            viewScope,
          },
          {
            bytesTransferred: 73421,
            cancelRequested: false,
            conflictPolicy: "rename",
            createdAt: now - 240000,
            direction: "download",
            hostId: "prod-api",
            id: "transfer-done",
            kind: "file",
            localPath: deployLogLocalPath,
            operation: "download",
            phase: "complete",
            remotePath: deployLogRemotePath,
            source: { kind: "remote", hostId: "prod-api", hostLabel: "prod-api", path: deployLogRemotePath },
            status: "succeeded",
            target: { kind: "local", path: deployLogLocalPath },
            totalBytes: 73421,
            transportMode: "singleHostSftp",
            updatedAt: now - 120000,
            viewScope,
          },
        ];
      }

      function commandHistory() {
        return [
          { command: "docker ps", createdAt: "1782197000", id: "history-1", source: "user", target: "ssh" },
          { command: "journalctl -u kerminal -n 80", createdAt: "1782196900", id: "history-2", source: "user", target: "ssh" },
        ];
      }

      function snippets() {
        return [
          { command: "journalctl -u kerminal -n 80", createdAt: "readme-capture", description: "读取服务最近日志", id: "snippet-logs", name: "最近日志", tags: ["ops"], updatedAt: "readme-capture" },
        ];
      }

      function workflows() {
        return [
          { createdAt: "readme-capture", description: "发布前检查", id: "workflow-release", name: "发布检查", steps: [], tags: ["release"], updatedAt: "readme-capture" },
        ];
      }

      function portForwards() {
        return [
          {
            bindHost: "127.0.0.1",
            createdAt: "1782197600",
            hostId: "prod-api",
            hostName: "prod-api",
            id: "port-api",
            kind: "local",
            localEndpoint: { host: "127.0.0.1", port: 18080, protocol: "tcp", side: "local" },
            name: "API tunnel",
            origin: "user",
            sourcePort: 18080,
            status: "running",
            targetHost: "127.0.0.1",
            targetPort: 8080,
          },
        ];
      }

      /**
       * README 场景必须覆盖当前全部内置 Agent，并返回完整探测字段；缺项会让新版
       * 选择器进入错误边界，也会把截图误导成旧的双按钮启动界面。
       */
      function externalAgentWorkspaceStatus() {
        const workspaceDir = "C:/Users/kong/.kerminal";
        const mcpEndpoint = "http://127.0.0.1:37657/mcp";
        return {
          agents: {
            claude: {
              adapterAvailable: true,
              cliCommand: "claude",
              configPath: workspaceDir + "/.mcp.json",
              configReady: true,
              id: "claude",
              installed: true,
              statusDetail: "Claude CLI ready. Session config is generated per launch.",
              title: "Claude",
            },
            codex: {
              adapterAvailable: true,
              cliCommand: "codex",
              configPath: workspaceDir + "/.codex/config.toml",
              configReady: true,
              id: "codex",
              installed: true,
              statusDetail: "Codex CLI ready. Kerminal MCP is session-scoped.",
              title: "Codex",
            },
            custom: {
              adapterAvailable: true,
              cliCommand: "custom",
              configPath: "",
              configReady: true,
              id: "custom",
              installed: true,
              statusDetail: "Run a custom CLI command in a Kerminal agent session.",
              title: "Custom",
            },
            pi: {
              adapterAvailable: true,
              cliCommand: "pi --approve --mcp-config .mcp.json",
              configPath: workspaceDir + "/.mcp.json",
              configReady: true,
              id: "pi",
              installed: true,
              statusDetail: "PI Agent and pi-mcp-adapter are ready for the session MCP endpoint.",
              title: "PI Agent",
            },
          },
          mcpEndpoint,
          mcpServerRunning: true,
          validator: {
            available: true,
            command: "kerminal.config.validate",
            detail: "Configuration validator is available through Kerminal MCP.",
            status: "ready",
          },
          workspaceDir,
        };
      }

      function agentSessions() {
        return {
          diagnostics: [],
          sessions: [
            createAgentSessionRecord({
              agentId: "codex",
              agentSessionId: "agent-codex-prod-api",
              target: agentSessionTarget(),
              title: "部署回归检查",
              updatedAt: "2026-07-12T08:20:00.000Z",
            }),
            createAgentSessionRecord({
              agentId: "claude",
              agentSessionId: "agent-claude-release-notes",
              target: { liveStatus: "unbound" },
              title: "发布说明整理",
              updatedAt: "2026-07-12T07:20:00.000Z",
            }),
          ],
        };
      }

      /**
       * 会话恢复会把最终启动快照写回 session；fixture 合并该快照，避免以 null 响应
       * 掩盖新版 session update 契约，并保留原始 scope/target。
       */
      function updatedAgentSessionRecord(agentSessionId, request = {}) {
        const current = agentSessions().sessions.find(
          (record) => record.session.agentSessionId === agentSessionId,
        ) ?? createAgentSessionRecord({ agentSessionId });
        const launch = request.launch
          ? {
              ...current.session.launch,
              ...request.launch,
              commandLabel:
                request.launch.commandLabel ??
                request.launch.command_label ??
                current.session.launch.commandLabel,
            }
          : current.session.launch;
        return {
          session: {
            ...current.session,
            launch,
            updatedAt: "2026-08-24T06:20:00.000Z",
          },
        };
      }

      function createAgentSessionRecord(request = {}) {
        const agentId = request.agentId ?? "codex";
        const sessionId =
          request.agentSessionId ?? "agent-" + agentId + "-readme";
        const workspaceRoot = "C:/Users/kong/.kerminal";
        const sessionRoot = workspaceRoot + "/agents/sessions/" + sessionId;
        const title =
          request.title ?? (agentId === "claude" ? "Claude" : agentId === "custom" ? "Custom" : "Codex");
        return {
          session: {
            agentId,
            agentSessionId: sessionId,
            createdAt:
              request.createdAt ??
              request.updatedAt ??
              "2026-07-12T06:20:00.000Z",
            launch: {
              args: ["-NoExit", "-Command", agentId === "custom" ? "qwen --model code" : agentId],
              commandLabel: agentId,
              cwd: sessionRoot,
              shell: "pwsh.exe",
            },
            sessionRoot,
            target: request.target ?? agentSessionTarget(),
            title,
            updatedAt: request.updatedAt ?? "2026-07-12T08:20:00.000Z",
            workspaceRoot,
          },
        };
      }

      function agentSessionTarget() {
        return {
          bindingGeneration: 1,
          bindingId: "binding-prod-api",
          cwd: "/srv/kerminal",
          lastSeenAt: "1782197600",
          liveStatus: "ready",
          paneId: "pane-prod-api",
          shell: "ssh",
          tabId: "tab-prod-api",
          targetKind: "ssh",
          targetRef: "ssh:prod-api",
          targetTerminalSessionId: "readme-session-prod-api",
        };
      }

      function prepareExternalAgentWorkspace(request = {}) {
        const status = externalAgentWorkspaceStatus();
        const agentId = request.agentId ?? "codex";
        const sessionId = request.agentSessionId ?? "agent-" + agentId + "-readme";
        const sessionRoot = status.workspaceDir + "/agents/sessions/" + sessionId;
        const command =
          agentId === "custom"
            ? request.customCommand ?? "qwen"
            : agentId === "codex" && request.resumeProviderSession
              ? "codex resume --last"
              : agentId;
        return {
          agentId,
          agentSessionId: sessionId,
          args: ["-NoExit", "-Command", command],
          commandLabel: command,
          cwd: sessionRoot,
          env: {
            KERMINAL_AGENT_SESSION_ID: sessionId,
            KERMINAL_AGENT_SESSION_ROOT: sessionRoot,
            KERMINAL_MCP_ENDPOINT: status.mcpEndpoint + "/agents/" + sessionId,
            KERMINAL_WORKSPACE_ROOT: status.workspaceDir,
          },
          message: "Agent workspace prepared.",
          operations: [],
          shell: "pwsh.exe",
          status: "running",
          title: agentId === "claude" ? "Claude" : agentId === "custom" ? "Custom" : "Codex",
          validator: status.validator,
        };
      }

      /** Windows README 场景显式展示系统协议可注册，但不修改拍摄机器的真实关联。 */
      function externalLaunchDeepLinkStatus(registered = false) {
        return {
          registered,
          scheme: "kerminal",
          supported: true,
        };
      }

      function tmuxCapability(request = {}) {
        return {
          available: true,
          target: request.target?.target ?? { hostId: "prod-api", kind: "ssh" },
          targetRef: "ssh:prod-api",
          version: "tmux 3.5a",
        };
      }

      function tmuxSessions() {
        return [
          {
            activityAt: 1782197600,
            attached: true,
            clients: 1,
            createdAt: 1782191200,
            currentPath: "/srv/kerminal",
            id: "$0",
            name: "release-watch",
            status: "running",
            targetRef: "ssh:prod-api",
            windows: 3,
          },
          {
            activityAt: 1782197000,
            attached: false,
            clients: 0,
            createdAt: 1782188800,
            currentPath: "/srv/kerminal/services",
            id: "$1",
            name: "worker-debug",
            status: "running",
            targetRef: "ssh:prod-api",
            windows: 2,
          },
          {
            activityAt: 1782194800,
            attached: false,
            clients: 0,
            createdAt: 1782181200,
            currentPath: "/data/experiments",
            id: "$2",
            name: "gpu-train",
            status: "running",
            targetRef: "ssh:prod-api",
            windows: 4,
          },
        ];
      }

      /**
       * 固定选择器的持久状态，使截图既呈现三个内置 Agent，也呈现用户可保存的
       * 自定义启动器，同时不依赖拍摄机器上的真实 settings.toml。
       */
      function readmeSettings() {
        const themeMode =
          localStorage.getItem("kerminal.readme.capture.themeMode") ?? "dark";
        return {
          agentLauncher: {
            customAgents: [
              {
                command: "qwen --model code",
                id: "9db1ef37-a6e8-4a4e-87fa-f1f849a71831",
                name: "Qwen Code",
              },
            ],
            selectedAgentKey: "builtin:codex",
          },
          appearance: {
            backgroundEnabled: false,
            backgroundFit: "cover",
            backgroundImagePath: "",
            backgroundOpacity: 40,
            interfaceLanguage: "zhCN",
            windowOpacity: 96,
          },
          interfaceDensity: "comfortable",
          sftp: {
            globalTransfers: 6,
            hostTransfers: 3,
            packetBytes: 262144,
            pipelineDepth: 16,
            timeoutSeconds: 30,
          },
          terminal: {
            autoReconnect: true,
            colorScheme: "kerminal",
            confirmCloseTab: false,
            cursorBlink: true,
            cursorStyle: "block",
            darkColorScheme: "kerminal",
            fontFamily: '"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, monospace',
            fontSize: 13,
            fontWeight: "normal",
            inlineSuggestion: {
              acceptKey: "rightArrow",
              auditRetentionDays: 30,
              enabled: true,
              feedbackRetentionDays: 365,
              productionHostPolicy: "restricted",
              providers: { git: true, history: true, remoteCommand: true, remotePath: true, spec: true },
              remoteProbeEnabled: true,
            },
            lightColorScheme: "kerminal",
            lineHeight: 1.35,
            macOptionIsMeta: false,
            rightClickBehavior: "menu",
            scrollback: 5000,
            selectionCopy: false,
            showTabNumbers: false,
          },
          themeMode,
        };
      }

      function terminalPtyOutputPumpStats(sessionId) {
        return {
          bufferedChunks: 0,
          closedEvents: 0,
          coalescedChunks: 0,
          dataEvents: 0,
          droppedBytes: 0,
          errorEvents: 0,
          finalTailFlushCount: 0,
          finished: false,
          flushCount: 0,
          inputBytes: 0,
          inputChunks: 0,
          maxPendingBytes: 0,
          maxPendingHitCount: 0,
          outputBytes: 0,
          overflowCount: 0,
          pendingBytes: 0,
          sessionId: sessionId ?? "readme-session",
        };
      }

      function sanitizeArgs(value) {
        return JSON.parse(
          JSON.stringify(value, (_key, item) => {
            if (item && typeof item === "object" && "id" in item) {
              return { id: item.id };
            }
            return item;
          }),
        );
      }
    })();`;
}
