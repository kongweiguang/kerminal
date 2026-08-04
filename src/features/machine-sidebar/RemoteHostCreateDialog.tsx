// @author kongweiguang

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { testRemoteConnection } from "../../lib/connectionApi";
import { detectShells, type ShellCandidate } from "../../lib/profileApi";
import {
  createDefaultSshOptions,
  revealRemoteHostCredential,
} from "../../lib/remoteHostApi";
import type {
  RemoteHostAuthType,
  RemoteHostGroup,
  SshOptions,
} from "../../lib/remoteHostApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import { evaluateConnectionCheck } from "./remote-host-dialog/connection-check";
import {
  buildLocalShellPresets,
  formatLocalArgs,
  formatLocalEnv,
} from "./remote-host-dialog/local-form";
import {
  buildGroupOptions,
  CUSTOM_LOCAL_SHELL_PRESET_ID,
  DEFAULT_LOCAL_SHELL_PRESET_ID,
  type ConnectionMode,
  type DialogSection,
  initialTargetGroupId,
  protocolTabs,
  type RemoteHostCreateDialogProps,
  sectionTabsByMode,
} from "./remote-host-dialog/model";
import {
  isRdpRemoteHost,
  isSerialRemoteHost,
  isTelnetRemoteHost,
  normalizeSshOptionsForForm,
  readSerialTagValue,
} from "./remote-host-dialog/request-builders";
import { RemoteHostDialogSectionContent } from "./remote-host-dialog/section-content";
import {
  protocolButtonClassName,
  sectionButtonClassName,
} from "./remote-host-dialog/shared-ui";
import { RemoteHostGroupCreateDialog } from "./RemoteHostGroupCreateDialog";
import { executeRemoteHostConfirm } from "./remote-host-dialog/confirm-controller";

export type {
  LocalTerminalCreateOptions,
} from "./remote-host-dialog/model";

type ConnectionTestFeedback = UserFacingMessage;

export function RemoteHostCreateDialog({
  defaultGroupId,
  defaultMode = "ssh",
  editingHost,
  editingLocalMachine,
  externalConfigConflict,
  groups,
  onClose,
  onCreateGroup,
  onCreateLocal,
  onCreateHost,
  onUpdateHost,
  onUpdateLocal,
  onCreated,
  onGroupCreated,
  open,
}: RemoteHostCreateDialogProps) {
  const targetGroups = useMemo(
    () => groups.filter((group) => group.id !== "local"),
    [groups],
  );
  const groupOptions = useMemo(
    () => buildGroupOptions(targetGroups),
    [targetGroups],
  );
  const sshMachines = useMemo(
    () =>
      groups.flatMap((group) =>
        group.machines.filter((machine) => machine.kind === "ssh"),
      ),
    [groups],
  );
  const [activeSection, setActiveSection] =
    useState<DialogSection>("properties");
  const [authType, setAuthType] = useState<RemoteHostAuthType>("password");
  const [credentialRef, setCredentialRef] = useState("");
  const [credentialSecret, setCredentialSecret] = useState("");
  const [keyPassphraseSecret, setKeyPassphraseSecret] = useState("");
  const [keyPassphraseDirty, setKeyPassphraseDirty] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [operationError, setOperationError] =
    useState<UserFacingMessage | null>(null);
  const [groupId, setGroupId] = useState("");
  const [host, setHost] = useState("");
  const [inlineGroupDialogOpen, setInlineGroupDialogOpen] = useState(false);
  const [localArgs, setLocalArgs] = useState("");
  const [localCwd, setLocalCwd] = useState("");
  const [localEnv, setLocalEnv] = useState("");
  const [localShell, setLocalShell] = useState("");
  const [localShellCandidates, setLocalShellCandidates] = useState<
    ShellCandidate[]
  >([]);
  const [localShellPresetId, setLocalShellPresetId] = useState(
    DEFAULT_LOCAL_SHELL_PRESET_ID,
  );
  const [localTitle, setLocalTitle] = useState("");
  const [mode, setMode] = useState<ConnectionMode>(defaultMode);
  const [name, setName] = useState("");
  const [port, setPort] = useState("22");
  const [production, setProduction] = useState(false);
  const [rdpFullscreen, setRdpFullscreen] = useState(true);
  const [rdpHeight, setRdpHeight] = useState("900");
  const [rdpNote, setRdpNote] = useState("");
  const [rdpPassword, setRdpPassword] = useState("");
  const [rdpUsername, setRdpUsername] = useState("");
  const [rdpWidth, setRdpWidth] = useState("1440");
  const [serialBaud, setSerialBaud] = useState("9600");
  const [serialDataBits, setSerialDataBits] = useState("8");
  const [serialFlow, setSerialFlow] = useState("none");
  const [serialNote, setSerialNote] = useState("");
  const [serialParity, setSerialParity] = useState("none");
  const [serialPort, setSerialPort] = useState("");
  const [serialStopBits, setSerialStopBits] = useState("1");
  const [savingAction, setSavingAction] = useState<"confirm" | "test" | null>(
    null,
  );
  const [sshOptions, setSshOptions] = useState<SshOptions>(() =>
    createDefaultSshOptions(),
  );
  const [connectionTestFeedback, setConnectionTestFeedback] =
    useState<ConnectionTestFeedback | null>(null);
  const [tags, setTags] = useState("");
  const [telnetNote, setTelnetNote] = useState("");
  const [username, setUsername] = useState("");
  const initializedFormTargetKeyRef = useRef<string | null>(null);
  const credentialRevealRequestRef = useRef(0);
  const setError = useCallback<Dispatch<SetStateAction<string | null>>>(
    (nextError) => {
      setOperationError(null);
      setErrorState(nextError);
    },
    [],
  );
  const updateKeyPassphraseSecret = useCallback((value: string) => {
    setKeyPassphraseSecret(value);
    setKeyPassphraseDirty(true);
  }, []);
  const formTargetKey = editingLocalMachine
    ? `local:${editingLocalMachine.id}`
    : editingHost
      ? `host:${editingHost.id}`
      : `create:${defaultMode}`;
  const credentialHostId = editingHost?.id;
  const credentialAuthType = editingHost?.authType;
  const persistedCredentialRef = editingHost?.credentialRef;
  const persistedCredentialSecret = editingHost?.credentialSecret;
  const persistedKeyPassphraseRef = editingHost?.keyPassphraseRef;
  const credentialHostUsesRdp = editingHost
    ? isRdpRemoteHost(editingHost)
    : false;

  useEffect(() => {
    if (!open) {
      initializedFormTargetKeyRef.current = null;
      credentialRevealRequestRef.current += 1;
      return;
    }
    if (initializedFormTargetKeyRef.current === formTargetKey) {
      return;
    }
    initializedFormTargetKeyRef.current = formTargetKey;

    const initialGroupId =
      editingLocalMachine?.remoteGroupId ??
      editingHost?.groupId ??
      initialTargetGroupId(targetGroups, defaultGroupId);
    const initialMode = editingLocalMachine
      ? "local"
      : editingHost?.protocol === "sftp"
        ? "sftp"
      : editingHost && isSerialRemoteHost(editingHost)
        ? "serial"
        : editingHost && isTelnetRemoteHost(editingHost)
          ? "telnet"
          : editingHost && isRdpRemoteHost(editingHost)
            ? "rdp"
            : editingHost
              ? "ssh"
              : defaultMode;
    setActiveSection("properties");
    setAuthType(
      editingHost?.authType ??
        (initialMode === "ssh" || initialMode === "sftp" || initialMode === "rdp"
          ? "password"
          : "agent"),
    );
    setCredentialRef(
      editingHost?.authType === "key" ? (editingHost.credentialRef ?? "") : "",
    );
    setCredentialSecret(
      editingHost?.authType === "password" || editingHost?.authType === "key"
        ? (editingHost.credentialSecret ?? "")
        : "",
    );
    setKeyPassphraseSecret(
      editingHost?.authType === "key"
        ? (editingHost.keyPassphraseSecret ?? "")
        : "",
    );
    setKeyPassphraseDirty(false);
    setError(null);
    setGroupId(initialGroupId);
    setHost(editingHost?.host ?? "");
    setLocalArgs(formatLocalArgs(editingLocalMachine?.args ?? []));
    setLocalCwd(editingLocalMachine?.cwd ?? "");
    setLocalEnv(formatLocalEnv(editingLocalMachine?.env));
    setLocalShell(editingLocalMachine?.shell ?? "");
    setLocalShellPresetId(
      editingLocalMachine?.shell
        ? CUSTOM_LOCAL_SHELL_PRESET_ID
        : DEFAULT_LOCAL_SHELL_PRESET_ID,
    );
    setLocalTitle(editingLocalMachine?.name ?? "");
    setMode(initialMode);
    setName(editingHost?.name ?? "");
    setPort(
      String(
        editingHost?.port ??
          (initialMode === "rdp"
            ? 3389
            : initialMode === "telnet"
              ? 23
              : initialMode === "serial"
                ? 1
                : 22),
      ),
    );
    setProduction(editingHost?.production ?? false);
    setRdpFullscreen(true);
    setRdpHeight("900");
    setRdpNote("");
    setRdpPassword(
      initialMode === "rdp" && editingHost?.authType === "password"
        ? (editingHost.credentialSecret ?? "")
        : "",
    );
    setRdpUsername(initialMode === "rdp" ? (editingHost?.username ?? "") : "");
    setRdpWidth("1440");
    setSerialBaud(readSerialTagValue(editingHost, "baud") ?? "9600");
    setSerialDataBits(readSerialTagValue(editingHost, "data-bits") ?? "8");
    setSerialFlow(readSerialTagValue(editingHost, "flow") ?? "none");
    setSerialNote("");
    setSerialParity(readSerialTagValue(editingHost, "parity") ?? "none");
    setSerialPort(
      initialMode === "serial"
        ? (readSerialTagValue(editingHost, "port") ?? editingHost?.host ?? "")
        : "",
    );
    setSerialStopBits(readSerialTagValue(editingHost, "stop-bits") ?? "1");
    setSavingAction(null);
    const normalizedSshOptions = normalizeSshOptionsForForm(editingHost?.sshOptions);
    setSshOptions(
      initialMode === "sftp"
        ? {
            ...normalizedSshOptions,
            transfer: { ...normalizedSshOptions.transfer, enabled: true },
            tunnels: [],
          }
        : normalizedSshOptions,
    );
    setConnectionTestFeedback(null);
    setTags(
      editingHost
        ? editingHost.tags.join(", ")
        : initialMode === "rdp"
          ? "rdp"
          : initialMode === "telnet"
            ? "telnet"
            : initialMode === "serial"
              ? "serial"
              : "",
    );
    setTelnetNote("");
    setUsername(editingHost?.username ?? "");
  }, [
    defaultMode,
    defaultGroupId,
    editingHost,
    editingLocalMachine,
    formTargetKey,
    open,
    setError,
    targetGroups,
  ]);

  useEffect(() => {
    if (!open || !credentialHostId) {
      return undefined;
    }
    if (
      credentialAuthType === "password" &&
      persistedCredentialSecret?.trim()
    ) {
      return undefined;
    }
    if (credentialAuthType === "key" && keyPassphraseDirty) {
      return undefined;
    }
    const shouldReveal =
      credentialAuthType === "password" ||
      (credentialAuthType === "key" &&
        (Boolean(persistedKeyPassphraseRef?.trim()) ||
          !persistedCredentialRef?.trim()));
    if (!shouldReveal) {
      return undefined;
    }

    let disposed = false;
    const requestId = credentialRevealRequestRef.current + 1;
    credentialRevealRequestRef.current = requestId;

    revealRemoteHostCredential(credentialHostId)
      .then((result) => {
        if (disposed || credentialRevealRequestRef.current !== requestId) {
          return;
        }
        let revealedSecret = false;
        if (result.credentialSecret) {
          setCredentialSecret(result.credentialSecret);
          revealedSecret = true;
          if (credentialHostUsesRdp) {
            setRdpPassword(result.credentialSecret);
          }
        }
        if (result.keyPassphraseSecret !== undefined) {
          setKeyPassphraseSecret(result.keyPassphraseSecret);
          setKeyPassphraseDirty(false);
          revealedSecret = true;
        }
        if (revealedSecret) {
          return;
        }
        if (
          result.message &&
          (result.status === "missing" || result.status === "unsupported")
        ) {
          setError(result.message);
        }
      })
      .catch((caught) => {
        if (disposed || credentialRevealRequestRef.current !== requestId) {
          return;
        }
        setError(null);
        setOperationError(
          buildUserFacingError(caught, {
            detail: "连接配置仍可编辑，但已保存的凭据暂时无法回显。",
            recoveryAction: "请确认凭据保险箱可用后重试。",
            title: "无法读取已保存凭据",
          }),
        );
      });

    return () => {
      disposed = true;
    };
  }, [
    credentialAuthType,
    credentialHostId,
    credentialHostUsesRdp,
    keyPassphraseDirty,
    open,
    persistedCredentialRef,
    persistedCredentialSecret,
    persistedKeyPassphraseRef,
    setError,
  ]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let disposed = false;
    detectShells()
      .then((candidates) => {
        if (!disposed) {
          setLocalShellCandidates(
            candidates.filter((candidate) => candidate.isAvailable),
          );
        }
      })
      .catch(() => {
        if (!disposed) {
          setLocalShellCandidates([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, [open]);

  const selectedProtocolLabel = (
    protocolTabs.find((protocol) => protocol.id === mode) ?? protocolTabs[0]
  ).label;

  const confirm = async () => {
    setConnectionTestFeedback(null);
    await executeRemoteHostConfirm({
      authType, credentialRef, credentialSecret, editingHost,
      editingLocalMachine, externalConfigConflict, groupId, host,
      keyPassphraseDirty, keyPassphraseSecret,
      localArgs, localCwd, localEnv, localShell, localTitle, mode, name,
      onClose, onCreateHost, onCreateLocal, onCreated, onUpdateHost,
      onUpdateLocal, port, production, rdpPassword, rdpUsername,
      selectedProtocolLabel, serialBaud, serialDataBits, serialFlow,
      serialParity, serialPort, serialStopBits, setError,
      setOperationError, setSavingAction, sshOptions, tags, username,
    });
  };

  const testConnection = async () => {
    setConnectionTestFeedback(null);
    const result = evaluateConnectionCheck({
      authType,
      credentialRef,
      credentialSecret,
      keyPassphraseSecret,
      editingLocalMachine: Boolean(editingLocalMachine),
      groupId,
      host,
      localArgs,
      localCwd,
      localEnv,
      localShell,
      localTitle,
      mode,
      name,
      port,
      production,
      rdpFullscreen,
      rdpHeight,
      rdpNote,
      rdpPassword,
      rdpUsername,
      rdpWidth,
      selectedProtocolLabel,
      serialBaud,
      serialDataBits,
      serialFlow,
      serialParity,
      serialPort,
      serialStopBits,
      sshOptions,
      tags,
      username,
    });
    if (!result.ok) {
      setError(null);
      setConnectionTestFeedback({
        severity: "error",
        title: result.error,
      });
      return;
    }
    if (!result.testRequest) {
      setError(null);
      setConnectionTestFeedback({
        severity: "info",
        title: result.statusMessage,
      });
      return;
    }

    setSavingAction("test");
    setError(null);
    try {
      const testResult = await testRemoteConnection(result.testRequest);
      setConnectionTestFeedback({
        severity: "info",
        title: testResult.message,
      });
    } catch (caught) {
      setError(null);
      setConnectionTestFeedback(
        buildUserFacingError(caught, {
          detail: `${selectedProtocolLabel} 未能完成连接测试。`,
          recoveryAction: "请检查地址、网络和认证信息后重试。",
          title: "连接测试失败",
        }),
      );
    } finally {
      setSavingAction(null);
    }
  };

  const activeSections = sectionTabsByMode[mode] ?? sectionTabsByMode.ssh ?? [];
  const activeSectionDefinition =
    activeSections.find((section) => section.id === activeSection) ??
    activeSections[0];
  const updateSshOptions = (
    next: SshOptions | ((current: SshOptions) => SshOptions),
  ) => {
    setSshOptions((current) =>
      typeof next === "function" ? next(current) : next,
    );
  };
  const localShellPresets = useMemo(
    () => buildLocalShellPresets(localShellCandidates),
    [localShellCandidates],
  );
  const handleInlineGroupCreated = async (group: RemoteHostGroup) => {
    setGroupId(group.id);
    await onGroupCreated?.(group);
  };
  const showTestButton = (
    ["ssh", "sftp", "rdp", "telnet", "serial"] as ConnectionMode[]
  ).includes(mode);
  const footerFeedback: ConnectionTestFeedback | null =
    connectionTestFeedback ??
    operationError ??
    (error
      ? { severity: "error", title: error }
      : externalConfigConflict
        ? buildUserFacingError(externalConfigConflict, {
            detail: "当前草稿已保留，但不能直接覆盖外部修改。",
            recoveryAction: "请关闭并重新打开连接配置后再编辑。",
            severity: "warning",
            title: "连接配置已在外部更新",
          })
        : null);
  const sectionContent = (
    <RemoteHostDialogSectionContent
      activeSection={activeSection}
      activeSectionDefinition={activeSectionDefinition}
      authType={authType}
      credentialRef={credentialRef}
      credentialSecret={credentialSecret}
      keyPassphraseSecret={keyPassphraseSecret}
      editingHost={editingHost}
      editingLocalMachine={editingLocalMachine}
      groupId={groupId}
      groupOptions={groupOptions}
      host={host}
      localArgs={localArgs}
      localCwd={localCwd}
      localEnv={localEnv}
      localShell={localShell}
      localShellPresetId={localShellPresetId}
      localShellPresets={localShellPresets}
      localTitle={localTitle}
      mode={mode}
      name={name}
      onCreateGroupClick={
        onCreateGroup ? () => setInlineGroupDialogOpen(true) : undefined
      }
      port={port}
      production={production}
      rdpFullscreen={rdpFullscreen}
      rdpHeight={rdpHeight}
      rdpNote={rdpNote}
      rdpPassword={rdpPassword}
      rdpUsername={rdpUsername}
      rdpWidth={rdpWidth}
      selectedProtocolLabel={selectedProtocolLabel}
      serialBaud={serialBaud}
      serialDataBits={serialDataBits}
      serialFlow={serialFlow}
      serialNote={serialNote}
      serialParity={serialParity}
      serialPort={serialPort}
      serialStopBits={serialStopBits}
      setAuthType={setAuthType}
      setCredentialRef={setCredentialRef}
      setCredentialSecret={setCredentialSecret}
      setKeyPassphraseSecret={updateKeyPassphraseSecret}
      setError={setError}
      setGroupId={setGroupId}
      setHost={setHost}
      setLocalArgs={setLocalArgs}
      setLocalCwd={setLocalCwd}
      setLocalEnv={setLocalEnv}
      setLocalShell={setLocalShell}
      setLocalShellPresetId={setLocalShellPresetId}
      setLocalTitle={setLocalTitle}
      setName={setName}
      setPort={setPort}
      setProduction={setProduction}
      setRdpFullscreen={setRdpFullscreen}
      setRdpHeight={setRdpHeight}
      setRdpNote={setRdpNote}
      setRdpPassword={setRdpPassword}
      setRdpUsername={setRdpUsername}
      setRdpWidth={setRdpWidth}
      setSerialBaud={setSerialBaud}
      setSerialDataBits={setSerialDataBits}
      setSerialFlow={setSerialFlow}
      setSerialNote={setSerialNote}
      setSerialParity={setSerialParity}
      setSerialPort={setSerialPort}
      setSerialStopBits={setSerialStopBits}
      setTags={setTags}
      setTelnetNote={setTelnetNote}
      setUsername={setUsername}
      sshMachines={sshMachines}
      sshOptions={sshOptions}
      tags={tags}
      telnetNote={telnetNote}
      updateSshOptions={updateSshOptions}
      username={username}
    />
  );

  return (
    <>
      <ModalShell
        footer={
          <>
            {footerFeedback ? (
              <UserFacingNotice
                className="mr-auto min-w-0 flex-1 text-left"
                compact
                message={footerFeedback}
              />
            ) : null}
            <Button onClick={onClose} type="button" variant="ghost">
              取消
            </Button>
            {showTestButton ? (
              <Button
                disabled={savingAction !== null}
                onClick={() => void testConnection()}
                type="button"
                variant="secondary"
              >
                {savingAction === "test" ? "测试中..." : "测试连接"}
              </Button>
            ) : null}
            <Button
              disabled={savingAction !== null || Boolean(externalConfigConflict)}
              onClick={() => void confirm()}
              type="button"
              variant="primary"
            >
              {savingAction === "confirm" ? "处理中..." : "确认"}
            </Button>
          </>
        }
        onClose={onClose}
        open={open}
        size="large"
        title={editingHost || editingLocalMachine ? "编辑连接配置" : "新建主机"}
      >
        <div className="space-y-4">
          <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-[var(--border-subtle)] pb-3">
            {protocolTabs.map((protocol) => {
              const Icon = protocol.Icon;
              const selected = protocol.id === mode;
              const disabled =
                Boolean(editingHost || editingLocalMachine) &&
                protocol.id !== mode;
              return (
                <button
                  aria-pressed={selected}
                  className={protocolButtonClassName(selected, disabled)}
                  disabled={disabled}
                  key={protocol.id}
                  onClick={() => {
                    setMode(protocol.id);
                    setActiveSection("properties");
                    setError(null);
                    setConnectionTestFeedback(null);
                    if (protocol.id === "rdp") {
                      setPort("3389");
                      setTags("rdp");
                    } else if (protocol.id === "telnet") {
                      setAuthType("agent");
                      setCredentialRef("");
                      setCredentialSecret("");
                      setKeyPassphraseSecret("");
                      setKeyPassphraseDirty(false);
                      setPort("23");
                      setRdpUsername("");
                      setTags("telnet");
                      setUsername("");
                    } else if (protocol.id === "serial") {
                      setAuthType("agent");
                      setCredentialRef("");
                      setCredentialSecret("");
                      setKeyPassphraseSecret("");
                      setKeyPassphraseDirty(false);
                      setHost("");
                      setPort("1");
                      setRdpUsername("");
                      setSerialBaud("9600");
                      setSerialDataBits("8");
                      setSerialFlow("none");
                      setSerialParity("none");
                      setSerialPort("");
                      setSerialStopBits("1");
                      setTags("serial");
                      setUsername("");
                    } else if (protocol.id === "ssh" || protocol.id === "sftp") {
                      setAuthType("password");
                      setPort("22");
                      setTags("");
                      if (protocol.id === "sftp") {
                        setSshOptions((current) => ({
                          ...current,
                          transfer: { ...current.transfer, enabled: true },
                          tunnels: [],
                        }));
                      }
                    }
                  }}
                  title={protocol.label}
                  type="button"
                >
                  <Icon className="h-4 w-4" />
                  <span>{protocol.label}</span>
                </button>
              );
            })}
          </div>

          <div className="grid min-h-[424px] gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
            <nav
              aria-label="连接配置分区"
              className="space-y-1 border-b border-[var(--border-subtle)] pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-4"
            >
              {activeSections.map((section) => {
                const Icon = section.Icon;
                const selected = section.id === activeSection;
                return (
                  <button
                    aria-pressed={selected}
                    className={sectionButtonClassName(selected)}
                    key={section.id}
                    onClick={() => {
                      setActiveSection(section.id);
                      setConnectionTestFeedback(null);
                    }}
                    type="button"
                  >
                    <Icon className="h-4 w-4" />
                    {section.label}
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0">
              {sectionContent}
            </div>
          </div>
        </div>
      </ModalShell>
      {inlineGroupDialogOpen && onCreateGroup ? (
        <RemoteHostGroupCreateDialog
          onClose={() => setInlineGroupDialogOpen(false)}
          onCreateGroup={onCreateGroup}
          onCreated={handleInlineGroupCreated}
          open={inlineGroupDialogOpen}
        />
      ) : null}
    </>
  );
}
