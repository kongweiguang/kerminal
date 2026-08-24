// @author kongweiguang

import { defaultWorkspaceSession } from "./workspace-session.mjs";
import { browserBootstrapScriptTail } from "./bootstrap-tail.mjs";

/**
 * 为 README 场景提供与当前 Tauri IPC 契约一致的确定性浏览器运行时，避免截图读取
 * 拍摄机器上的主机、凭据或会话数据。
 */
export function browserBootstrapScript() {
  return `
    (() => {
      const workspaceSessionOverride = localStorage.getItem(
        "kerminal.readme.capture.session.override",
      );
      localStorage.setItem(
        "kerminal.workspace.session.v1",
        workspaceSessionOverride ?? ${JSON.stringify(JSON.stringify(defaultWorkspaceSession))},
      );
      localStorage.setItem(
        "kerminal.remote-host-dialog.last-docker-host-id",
        "prod-api",
      );
      const callbacks = new Map();
      const channelIndexes = new Map();
      const sessions = new Map();
      let nextCallbackId = 1;
      let nextSessionId = 1;
      window.isTauri = true;
      window.matchMedia = (query) => ({
        addEventListener() {},
        addListener() {},
        dispatchEvent() { return false; },
        matches: query.includes("prefers-color-scheme: dark"),
        media: query,
        onchange: null,
        removeEventListener() {},
        removeListener() {},
      });
      window.__kerminalReadmeCaptureState = {
        errors: [],
        invocations: [],
        unknownInvocations: [],
      };
      const recordError = (kind, value) => {
        window.__kerminalReadmeCaptureState.errors.push({
          kind,
          message:
            value?.reason?.stack ??
            value?.reason?.message ??
            value?.error?.stack ??
            value?.error?.message ??
            value?.message ??
            String(value),
        });
      };
      window.addEventListener("error", (event) => recordError("error", event));
      window.addEventListener("unhandledrejection", (event) =>
        recordError("unhandledrejection", event),
      );
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        callbacks,
        convertFileSrc(filePath) {
          return String(filePath);
        },
        metadata: {
          currentWebview: { label: "main" },
          currentWindow: { label: "main" },
        },
        runCallback(id, payload) {
          callbacks.get(id)?.(payload);
        },
        transformCallback(callback, once = false) {
          const id = nextCallbackId++;
          callbacks.set(id, (payload) => {
            callback(payload);
            if (once) callbacks.delete(id);
          });
          return id;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        async invoke(cmd, args = {}) {
          window.__kerminalReadmeCaptureState.invocations.push({
            cmd,
            args: sanitizeArgs(args),
          });
          switch (cmd) {
            case "plugin:event|listen":
              return "readme-capture-listener";
            case "plugin:event|unlisten":
              return null;
            case "plugin:window|is_fullscreen":
            case "plugin:window|is_maximized":
              return false;
            case "plugin:window|start_dragging":
            case "plugin:window|minimize":
            case "plugin:window|toggle_maximize":
            case "plugin:window|close":
              return null;
            case "workspace_session_load":
              return readWorkspaceSession();
            case "workspace_session_save":
              return null;
            case "settings_get":
              return readmeSettings();
            case "settings_update":
              return args.settings;
            case "profile_list":
              return profiles();
            case "profile_detect_shells":
              return shellCandidates();
            case "remote_host_tree":
              return remoteHostTree();
            case "remote_host_group_list":
              return remoteHostTree().map(({ hosts, ...group }) => group);
            case "remote_host_create":
              return createdRemoteHost(args.request);
            case "remote_host_update":
              return createdRemoteHost(args.request);
            case "remote_host_group_create":
              return {
                createdAt: "readme-capture",
                id: "group-new",
                name: args.request?.name ?? "New Group",
                sortOrder: 40,
                updatedAt: "readme-capture",
              };
            case "remote_host_group_update":
              return {
                createdAt: "readme-capture",
                id: args.request?.id ?? "group-new",
                name: args.request?.name ?? "New Group",
                sortOrder: args.request?.sortOrder ?? 40,
                updatedAt: "readme-capture",
              };
            case "remote_host_delete":
            case "remote_host_group_delete":
            case "profile_delete":
              return true;
            case "profile_create":
            case "profile_update":
              return {
                args: args.request?.args ?? [],
                createdAt: "readme-capture",
                env: args.request?.env ?? {},
                id: args.request?.id ?? "profile-custom",
                isDefault: false,
                name: args.request?.name ?? "Custom shell",
                shell: args.request?.shell ?? "pwsh.exe",
                sortOrder: args.request?.sortOrder ?? 20,
                updatedAt: "readme-capture",
              };
            case "connection_test":
              return { message: "连接参数校验通过。", ok: true };
            case "docker_list_containers":
              return dockerContainers(args.request);
            case "server_info_snapshot":
              return serverInfoSnapshot(args.request);
            case "sftp_list_directory":
              return sftpListing(args.request);
            case "sftp_bookmark_list":
              return sftpBookmarks();
            case "file_dialog_list_local_directory":
              return localListing(args.path);
            case "sftp_list_transfers":
              return sftpTransfers(args.request);
            case "sftp_clear_completed_transfers":
              return sftpTransfers().filter((item) => item.status !== "succeeded");
            case "sftp_cancel_transfer":
              return { ...sftpTransfers()[0], cancelRequested: true };
            case "sftp_preview_file":
              return {
                bytesRead: 128,
                content: "PORT=1425\\nRUST_LOG=info\\n",
                encoding: "utf-8",
                hostId: args.request?.hostId ?? "prod-api",
                maxBytes: args.request?.maxBytes ?? 4096,
                path: args.request?.path ?? "/srv/kerminal/.env",
                truncated: false,
              };
            case "sftp_read_text_file": {
              const content =
                args.request?.path?.endsWith("compose.yaml")
                  ? "services:\\n  api:\\n    image: kerminal/api:latest\\n    ports:\\n      - \\"8080:80\\"\\n  worker:\\n    image: kerminal/worker:latest\\n"
                  : "PORT=1425\\nRUST_LOG=info\\nKERMINAL_MODE=production\\n";
              return {
                binary: false,
                bytesRead: content.length,
                content,
                encoding: "utf-8",
                hostId: args.request?.hostId ?? "prod-api",
                lineEnding: "\\n",
                maxBytes: args.request?.maxBytes ?? 10485760,
                path: args.request?.path ?? "/srv/kerminal/.env",
                readonly: false,
                revision: {
                  contentSha256: "readme-capture",
                  modified: "1782197600",
                  permissions: "-rw-r--r--",
                  permissionsMode: 0o644,
                  size: content.length,
                },
                truncated: false,
              };
            }
            case "sftp_write_text_file":
              return {
                bytesWritten: args.request?.content?.length ?? 0,
                encoding: args.request?.encoding ?? "utf-8",
                hostId: args.request?.hostId ?? "prod-api",
                lineEnding: "\\n",
                path: args.request?.path ?? "/srv/kerminal/.env",
                revision: {
                  contentSha256: "readme-capture-updated",
                  modified: String(Math.floor(Date.now() / 1000)),
                  permissions: "-rw-r--r--",
                  permissionsMode: 0o644,
                  size: args.request?.content?.length ?? 0,
                },
              };
            case "sftp_stat_path":
              return {
                hostId: args.request?.hostId ?? "prod-api",
                kind: "file",
                path: args.request?.path ?? "/srv/kerminal/.env",
                readonly: false,
                size: 128,
              };
            case "sftp_trust_host_key":
              return {
                host: "10.23.42.18",
                hostId: args.request?.hostId ?? "prod-api",
                knownHostsPath: "C:/Users/kong/.ssh/known_hosts",
                port: 22,
              };
            case "sftp_classify_local_paths":
              return (args.request?.paths ?? []).map((path) => ({
                kind: String(path).endsWith("/") ? "directory" : "file",
                path,
              }));
            case "sftp_read_local_file_clipboard":
              return [];
            case "terminal_create_session":
            case "ssh_create_session":
            case "telnet_create_session":
            case "serial_create_session":
            case "docker_create_container_session": {
              const id = "readme-session-" + nextSessionId++;
              const channelId = args.output?.id;
              const requestArgs = Array.isArray(args.request?.args)
                ? args.request.args
                : [];
              const launchCommand = [
                args.request?.shell ?? "",
                ...requestArgs,
              ].join(" ");
              const isCodexSession = launchCommand.toLowerCase().includes("codex");
              sessions.set(id, { channelId, isCodexSession });
              queueMicrotask(() => {
                emitTerminal(channelId, {
                  data: isCodexSession
                    ? codexLoadingScreen()
                    : "deploy@prod-api:/srv/kerminal$ git status --short\\r\\n M src/features/tool-panel/AgentLauncherToolContent.tsx\\r\\n M src/features/machine-sidebar/RemoteHostCreateDialog.tsx\\r\\ndeploy@prod-api:/srv/kerminal$ ",
                  kind: "data",
                  sessionId: id,
                });
              });
              if (isCodexSession) {
                setTimeout(() => {
                  emitTerminal(channelId, {
                    data: codexReadyScreen(),
                    kind: "data",
                    sessionId: id,
                  });
                }, 3_500);
              }
              return {
                cols: args.request?.cols ?? 120,
                cwd: args.request?.cwd ?? "/srv/kerminal",
                id,
                rows: args.request?.rows ?? 32,
                shell:
                  cmd === "ssh_create_session"
                    ? "ssh"
                    : args.request?.shell ?? "pwsh",
                status: "running",
                targetRef: cmd === "ssh_create_session" ? "ssh:prod-api" : "local",
                targetToken: "readme-target-token",
              };
            }
            case "terminal_write": {
              const session = sessions.get(args.sessionId);
              emitTerminal(session?.channelId, {
                data: args.data,
                kind: "data",
                sessionId: args.sessionId,
              });
              return null;
            }
            case "terminal_resize":
            case "terminal_close":
              return null;
            case "terminal_list_sessions":
              return Array.from(sessions.keys()).map((id) => ({
                cols: 120,
                cwd: "/srv/kerminal",
                id,
                rows: 32,
                shell: "ssh",
                status: "running",
                targetRef: "ssh:prod-api",
                targetToken: "readme-target-token",
              }));
            case "external_launch_take_pending":
              return [];
            case "external_launch_deep_link_status":
              return externalLaunchDeepLinkStatus(false);
            case "external_launch_deep_link_register":
              return externalLaunchDeepLinkStatus(true);
            case "external_launch_deep_link_unregister":
              return externalLaunchDeepLinkStatus(false);
            case "terminal_log_state":
            case "terminal_stop_log":
              return { active: false, bytesWritten: 0 };
            case "terminal_pty_output_pump_stats":
              return terminalPtyOutputPumpStats(args.sessionId);
            case "terminal_reap_orphan_sessions":
              return { elapsedMs: 0, reapedCount: 0, sessionIds: [] };
            case "terminal_start_log":
              return {
                active: true,
                bytesWritten: 0,
                path: "readme-capture://terminal.log",
                startedAt: "1782197600",
              };
            case "terminal_session_binding_register":
            case "terminal_session_binding_ready":
              return {
                generation: 1,
                metadata: args.metadata ?? null,
                paneId: args.paneId,
                readyAtMs: Date.now(),
                registeredAtMs: Date.now(),
                sessionId: args.sessionId,
                status: "ready",
                updatedAtMs: Date.now(),
              };
            case "terminal_session_binding_disconnected":
              return null;
            case "terminal_session_binding_closed":
              return true;
            case "terminal_session_binding_events":
              return [];
            case "command_suggestion_list":
              return [];
            case "command_suggestion_record_feedback":
              return { recorded: true, skipReason: null };
            case "command_suggestion_record_audit_event":
              return { eventId: "readme-audit", recorded: true };
            case "command_suggestion_refresh_remote_commands":
            case "command_suggestion_refresh_remote_history":
            case "command_suggestion_refresh_remote_paths":
            case "command_suggestion_refresh_git_refs":
              return { cachedAtUnixMs: Date.now(), entryCount: 0, hostId: "prod-api" };
            case "command_history_list":
              return commandHistory();
            case "command_history_record":
              return { entry: null, recorded: true, skipReason: null };
            case "command_history_delete":
              return true;
            case "command_history_clear":
              return 0;
            case "snippet_list":
              return snippets();
            case "workflow_list":
              return workflows();
            case "port_forward_list":
              return portForwards();
            case "get_external_agent_workspace_status":
              return externalAgentWorkspaceStatus();
            case "agent_session_list":
              return agentSessions();
            case "agent_session_update":
              return updatedAgentSessionRecord(args.agentSessionId, args.request);
            case "agent_session_create":
              return createAgentSessionRecord(args.request);
            case "agent_session_rebind_target":
              return createAgentSessionRecord({
                agentId: "codex",
                target: args.target,
                title: "Codex",
              });
            case "prepare_external_agent_workspace":
              return prepareExternalAgentWorkspace(args.request);
            case "tmux_probe":
              return tmuxCapability(args.request);
            case "tmux_list_sessions":
              return tmuxSessions(args.request);
            case "tmux_create_session":
              return {
                activityAt: Math.floor(Date.now() / 1000),
                attached: false,
                clients: 0,
                createdAt: Math.floor(Date.now() / 1000),
                currentPath: args.request?.cwd ?? "/srv/kerminal",
                id: "$4",
                name: args.request?.name ?? "kerminal",
                status: "running",
                targetRef: "ssh:prod-api",
                windows: 1,
              };
            case "tmux_rename_session":
              return {
                ...tmuxSessions()[0],
                id: args.request?.sessionId ?? "$0",
                name: args.request?.name ?? "renamed",
              };
            case "tmux_kill_session":
            case "tmux_detach_current":
              return true;
            case "mcp_http_server_status":
            case "mcp_http_server_start":
            case "mcp_http_server_stop":
              return {
                bindAddress: "127.0.0.1",
                endpoint: null,
                localOnly: true,
                port: null,
                running: false,
              };
            case "diagnostics_runtime_health":
              return { checks: [], status: "healthy" };
            case "diagnostics_create_bundle":
              return { createdAt: "readme-capture", files: [], path: "readme-capture.zip" };
            case "file_dialog_select_local_file":
            case "file_dialog_select_local_image":
            case "file_dialog_select_local_directory":
            case "file_dialog_select_save_file":
              return null;
            case "file_dialog_open_local_directory":
              return null;
            default:
              window.__kerminalReadmeCaptureState.unknownInvocations.push({
                cmd,
                args: sanitizeArgs(args),
              });
              if (cmd.endsWith("_list") || cmd.includes("_list_")) return [];
              if (cmd.endsWith("_delete") || cmd.endsWith("_clear")) return true;
              return null;
          }
        },
      };

      function emitTerminal(channelId, message) {
        if (!channelId || !callbacks.has(channelId)) return;
        const index = channelIndexes.get(channelId) ?? 0;
        channelIndexes.set(channelId, index + 1);
        callbacks.get(channelId)({ index, message });
      }

      function codexLoadingScreen() {
        return [
          "\\x1b[2J\\x1b[H",
          "\\x1b[1;36m>_ OpenAI Codex\\x1b[0m \\x1b[90m(v0.144.1)\\x1b[0m",
          "",
          "\\x1b[90mLoading workspace...\\x1b[0m",
          "\\x1b[90mStarting MCP servers...\\x1b[0m",
          "\\x1b[1;33mMCP: kerminal starting\\x1b[0m",
        ].join("\\r\\n");
      }

      function codexReadyScreen() {
        return [
          "\\x1b[2J\\x1b[H",
          "\\x1b[1;36m>_ OpenAI Codex\\x1b[0m \\x1b[90m(v0.144.1)\\x1b[0m",
          "",
          "\\x1b[90mmodel:\\x1b[0m \\x1b[1m gpt-5.6-sol xhigh\\x1b[0m",
          "\\x1b[90mdirectory:\\x1b[0m ~\\\\.kerminal\\\\agents\\\\ags",
          "\\x1b[1;32mMCP: kerminal ready\\x1b[0m",
          "",
          "\\x1b[1mTip:\\x1b[0m Use \\x1b[1m/fast\\x1b[0m for faster inference.",
          "",
          "\\x1b[90m•\\x1b[0m 1 usage limit reset available.",
          "  Run \\x1b[1m/usage\\x1b[0m to use one.",
          "",
          "\\x1b[1m›\\x1b[0m \\x1b[7m \\x1b[0m",
          "",
          "\\x1b[1;33mgpt-5.6-sol xhigh\\x1b[0m · \\x1b[1;32mags_prod_api\\x1b[0m",
        ].join("\\r\\n") + "\\x1b[12;3H";
      }

      function profiles() {
        return [
          {
            args: [],
            createdAt: "readme-capture",
            env: {},
            id: "profile-powershell",
            isDefault: true,
            name: "PowerShell",
            shell: "pwsh.exe",
            sortOrder: 10,
            updatedAt: "readme-capture",
          },
        ];
      }

      function shellCandidates() {
        return [
          {
            args: [],
            id: "pwsh",
            isAvailable: true,
            isDefault: true,
            name: "PowerShell 7",
            shell: "pwsh.exe",
            source: "path",
          },
          {
            args: [],
            id: "cmd",
            isAvailable: true,
            isDefault: false,
            name: "Command Prompt",
            shell: "cmd.exe",
            source: "path",
          },
          {
            args: ["--login"],
            id: "git-bash",
            isAvailable: true,
            isDefault: false,
            name: "Git Bash",
            shell: "C:/Program Files/Git/bin/bash.exe",
            source: "commonPath",
          },
        ];
      }

      function readWorkspaceSession() {
        const workspaceSessionOverride = localStorage.getItem(
          "kerminal.readme.capture.session.override",
        );
        return JSON.parse(
          workspaceSessionOverride ?? ${JSON.stringify(JSON.stringify(defaultWorkspaceSession))},
        );
      }

      function remoteHostTree() {
        return [
          {
            createdAt: "readme-capture",
            hosts: [
              remoteHost({ host: "10.23.42.18", id: "prod-api", name: "prod-api", tags: ["prod", "gpu"], username: "deploy" }),
              remoteHost({ host: "10.23.42.19", id: "jump-box", name: "jump-box", tags: ["jump"], username: "ops" }),
              remoteHost({ host: "10.23.42.21", id: "edge-serial", name: "edge-serial", port: 1, tags: ["serial", "lab"], username: "" }),
            ],
            id: "group-prod",
            name: "Production",
            sortOrder: 10,
            updatedAt: "readme-capture",
          },
          {
            createdAt: "readme-capture",
            hosts: [
              remoteHost({ host: "10.24.8.5", id: "dev-box", name: "dev-box", tags: ["dev"], username: "kong" }),
              remoteHost({ host: "10.24.8.9", id: "rdp-lab", name: "rdp-lab", port: 3389, tags: ["rdp"], username: "Administrator" }),
            ],
            id: "group-dev",
            name: "Development",
            sortOrder: 20,
            updatedAt: "readme-capture",
          },
        ];
      }

      function remoteHost(input) {
        return {
          authType: "password",
          createdAt: "readme-capture",
          credentialSecret: "configured",
          groupId: input.id?.startsWith("dev") || input.id?.startsWith("rdp") ? "group-dev" : "group-prod",
          host: input.host,
          id: input.id,
          name: input.name,
          port: input.port ?? 22,
          production: input.tags?.includes("prod") ?? false,
          sortOrder: 10,
          sshOptions: defaultSshOptions(),
          tags: input.tags ?? [],
          updatedAt: "readme-capture",
          username: input.username,
        };
      }

      function createdRemoteHost(request = {}) {
        return {
          ...remoteHost({
            host: request.host ?? "10.24.8.20",
            id: request.id ?? "created-host",
            name: request.name ?? "created-host",
            port: request.port,
            tags: request.tags ?? [],
            username: request.username ?? "deploy",
          }),
          groupId: request.groupId ?? "group-prod",
          sortOrder: request.sortOrder ?? 30,
        };
      }

      function defaultSshOptions() {
        return {
          jumpHosts: [],
          proxy: { protocol: "none" },
          terminal: {
            altModifier: "8bit",
            backspaceKey: "ascii-delete",
            connectTimeoutSeconds: 30,
            deleteKey: "delete-sequence",
            encoding: "UTF-8",
            environment: "",
            keepaliveSeconds: 60,
            keyboardProfile: "default",
            loginScript: "",
            startupCommand: "",
            terminalType: "xterm-256color",
          },
          transfer: {
            enabled: true,
            followSymlinks: false,
            localStartDirectory: "C:/Users/kong/Downloads",
            maxConcurrentTransfers: 4,
            preserveTimestamps: true,
            remoteStartDirectory: "/srv/kerminal",
          },
          tunnels: [],
        };
      }

${browserBootstrapScriptTail()}
  `;
}
