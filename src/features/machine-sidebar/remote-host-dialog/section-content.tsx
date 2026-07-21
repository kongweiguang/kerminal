import type { Dispatch, SetStateAction } from "react";
import type {
  RemoteHost,
  RemoteHostAuthType,
  SshOptions,
} from "../../../lib/remoteHostApi";
import type { Machine } from "../../workspace/contracts/index";
import { LocalEnvironmentPanel, LocalPropertiesPanel } from "./local-panels";
import {
  type ConnectionMode,
  type DialogSection,
  type LocalShellPreset,
  type SectionTab,
} from "./model";
import {
  RdpDisplayPanel,
  RdpPropertiesPanel,
  SerialOptionsPanel,
  SerialPropertiesPanel,
  TelnetPropertiesPanel,
} from "./protocol-panels";
import { DeferredSection } from "./shared-ui";
import { SshJumpPanel } from "./ssh-jump-panel";
import {
  SshProxyPanel,
  SshTunnelPanel,
  type SshOptionsSetter,
} from "./ssh-network-panels";
import { SshPropertiesPanel } from "./ssh-properties-panel";
import {
  SshTerminalPanel,
  SshTransferPanel,
} from "./ssh-terminal-transfer-panels";

type StringSetter = Dispatch<SetStateAction<string>>;
type NullableStringSetter = Dispatch<SetStateAction<string | null>>;
type BooleanSetter = Dispatch<SetStateAction<boolean>>;

interface RemoteHostDialogSectionContentProps {
  activeSection: DialogSection;
  activeSectionDefinition?: SectionTab;
  authType: RemoteHostAuthType;
  credentialRef: string;
  credentialSecret: string;
  editingHost?: RemoteHost;
  editingLocalMachine?: Machine;
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  host: string;
  localArgs: string;
  localCwd: string;
  localEnv: string;
  localShell: string;
  localShellPresetId: string;
  localShellPresets: LocalShellPreset[];
  localTitle: string;
  mode: ConnectionMode;
  name: string;
  onCreateGroupClick?: () => void;
  port: string;
  production: boolean;
  rdpFullscreen: boolean;
  rdpHeight: string;
  rdpNote: string;
  rdpPassword: string;
  rdpUsername: string;
  rdpWidth: string;
  selectedProtocolLabel: string;
  serialBaud: string;
  serialDataBits: string;
  serialFlow: string;
  serialNote: string;
  serialParity: string;
  serialPort: string;
  serialStopBits: string;
  setAuthType: Dispatch<SetStateAction<RemoteHostAuthType>>;
  setCredentialRef: StringSetter;
  setCredentialSecret: StringSetter;
  setError: NullableStringSetter;
  setGroupId: StringSetter;
  setHost: StringSetter;
  setLocalArgs: StringSetter;
  setLocalCwd: StringSetter;
  setLocalEnv: StringSetter;
  setLocalShell: StringSetter;
  setLocalShellPresetId: StringSetter;
  setLocalTitle: StringSetter;
  setName: StringSetter;
  setPort: StringSetter;
  setProduction: BooleanSetter;
  setRdpFullscreen: BooleanSetter;
  setRdpHeight: StringSetter;
  setRdpNote: StringSetter;
  setRdpPassword: StringSetter;
  setRdpUsername: StringSetter;
  setRdpWidth: StringSetter;
  setSerialBaud: StringSetter;
  setSerialDataBits: StringSetter;
  setSerialFlow: StringSetter;
  setSerialNote: StringSetter;
  setSerialParity: StringSetter;
  setSerialPort: StringSetter;
  setSerialStopBits: StringSetter;
  setTags: StringSetter;
  setTelnetNote: StringSetter;
  setUsername: StringSetter;
  sshMachines: Machine[];
  sshOptions: SshOptions;
  tags: string;
  telnetNote: string;
  updateSshOptions: SshOptionsSetter;
  username: string;
}

export function RemoteHostDialogSectionContent({
  activeSection,
  activeSectionDefinition,
  authType,
  credentialRef,
  credentialSecret,
  editingHost,
  editingLocalMachine,
  groupId,
  groupOptions,
  host,
  localArgs,
  localCwd,
  localEnv,
  localShell,
  localShellPresetId,
  localShellPresets,
  localTitle,
  mode,
  name,
  onCreateGroupClick,
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
  serialNote,
  serialParity,
  serialPort,
  serialStopBits,
  setAuthType,
  setCredentialRef,
  setCredentialSecret,
  setError,
  setGroupId,
  setHost,
  setLocalArgs,
  setLocalCwd,
  setLocalEnv,
  setLocalShell,
  setLocalShellPresetId,
  setLocalTitle,
  setName,
  setPort,
  setProduction,
  setRdpFullscreen,
  setRdpHeight,
  setRdpNote,
  setRdpPassword,
  setRdpUsername,
  setRdpWidth,
  setSerialBaud,
  setSerialDataBits,
  setSerialFlow,
  setSerialNote,
  setSerialParity,
  setSerialPort,
  setSerialStopBits,
  setTags,
  setTelnetNote,
  setUsername,
  sshMachines,
  sshOptions,
  tags,
  telnetNote,
  updateSshOptions,
  username,
}: RemoteHostDialogSectionContentProps) {
  return mode === "local" ? (
    activeSection === "properties" ? (
      <LocalPropertiesPanel
        editing={Boolean(editingLocalMachine)}
        groupId={groupId}
        groupOptions={groupOptions}
        localArgs={localArgs}
        localCwd={localCwd}
        localShell={localShell}
        localShellPresetId={localShellPresetId}
        localShellPresets={localShellPresets}
        localTitle={localTitle}
        onCreateGroupClick={onCreateGroupClick}
        setError={setError}
        setGroupId={setGroupId}
        setLocalArgs={setLocalArgs}
        setLocalCwd={setLocalCwd}
        setLocalShell={setLocalShell}
        setLocalShellPresetId={setLocalShellPresetId}
        setLocalTitle={setLocalTitle}
      />
    ) : activeSection === "environment" ? (
      <LocalEnvironmentPanel localEnv={localEnv} setLocalEnv={setLocalEnv} />
    ) : (
      <DeferredSection
        modeLabel={selectedProtocolLabel}
        section={activeSectionDefinition}
      />
    )
  ) : mode === "rdp" ? (
    activeSection === "properties" ? (
      <RdpPropertiesPanel
        groupId={groupId}
        groupOptions={groupOptions}
        host={host}
        name={name}
        onCreateGroupClick={onCreateGroupClick}
        port={port}
        rdpNote={rdpNote}
        rdpPassword={rdpPassword}
        rdpUsername={rdpUsername}
        setGroupId={setGroupId}
        setHost={setHost}
        setName={setName}
        setPort={setPort}
        setRdpNote={setRdpNote}
        setRdpPassword={setRdpPassword}
        setRdpUsername={setRdpUsername}
      />
    ) : activeSection === "display" ? (
      <RdpDisplayPanel
        rdpFullscreen={rdpFullscreen}
        rdpHeight={rdpHeight}
        rdpWidth={rdpWidth}
        setRdpFullscreen={setRdpFullscreen}
        setRdpHeight={setRdpHeight}
        setRdpWidth={setRdpWidth}
      />
    ) : (
      <DeferredSection
        modeLabel={selectedProtocolLabel}
        section={activeSectionDefinition}
      />
    )
  ) : mode === "telnet" ? (
    activeSection === "properties" ? (
      <TelnetPropertiesPanel
        groupId={groupId}
        groupOptions={groupOptions}
        host={host}
        name={name}
        onCreateGroupClick={onCreateGroupClick}
        port={port}
        setGroupId={setGroupId}
        setHost={setHost}
        setName={setName}
        setPort={setPort}
        setTelnetNote={setTelnetNote}
        telnetNote={telnetNote}
      />
    ) : (
      <DeferredSection
        modeLabel={selectedProtocolLabel}
        section={activeSectionDefinition}
      />
    )
  ) : mode === "serial" ? (
    activeSection === "properties" ? (
      <SerialPropertiesPanel
        groupId={groupId}
        groupOptions={groupOptions}
        name={name}
        onCreateGroupClick={onCreateGroupClick}
        serialNote={serialNote}
        setGroupId={setGroupId}
        setName={setName}
        setSerialNote={setSerialNote}
      />
    ) : activeSection === "serial" ? (
      <SerialOptionsPanel
        serialBaud={serialBaud}
        serialDataBits={serialDataBits}
        serialFlow={serialFlow}
        serialParity={serialParity}
        serialPort={serialPort}
        serialStopBits={serialStopBits}
        setSerialBaud={setSerialBaud}
        setSerialDataBits={setSerialDataBits}
        setSerialFlow={setSerialFlow}
        setSerialParity={setSerialParity}
        setSerialPort={setSerialPort}
        setSerialStopBits={setSerialStopBits}
      />
    ) : (
      <DeferredSection
        modeLabel={selectedProtocolLabel}
        section={activeSectionDefinition}
      />
    )
  ) : (mode === "ssh" || mode === "sftp") && activeSection === "properties" ? (
    <SshPropertiesPanel
      authType={authType}
      credentialRef={credentialRef}
      credentialSecret={credentialSecret}
      groupId={groupId}
      host={host}
      name={name}
      onCreateGroupClick={onCreateGroupClick}
      port={port}
      production={production}
      protocolLabel={mode === "sftp" ? "SFTP" : "SSH"}
      groupOptions={groupOptions}
      setAuthType={setAuthType}
      setCredentialRef={setCredentialRef}
      setCredentialSecret={setCredentialSecret}
      setError={setError}
      setGroupId={setGroupId}
      setHost={setHost}
      setName={setName}
      setPort={setPort}
      setProduction={setProduction}
      setTags={setTags}
      setUsername={setUsername}
      tags={tags}
      username={username}
    />
  ) : (mode === "ssh" || mode === "sftp") && activeSection === "proxy" ? (
    <SshProxyPanel options={sshOptions} setOptions={updateSshOptions} />
  ) : mode === "ssh" && activeSection === "tunnel" ? (
    <SshTunnelPanel options={sshOptions} setOptions={updateSshOptions} />
  ) : (mode === "ssh" || mode === "sftp") && activeSection === "jump" ? (
    <SshJumpPanel
      options={sshOptions}
      setOptions={updateSshOptions}
      sshMachines={sshMachines.filter(
        (machine) => machine.id !== editingHost?.id,
      )}
    />
  ) : mode === "ssh" && activeSection === "terminal" ? (
    <SshTerminalPanel options={sshOptions} setOptions={updateSshOptions} />
  ) : mode === "sftp" && activeSection === "transfer" ? (
    <SshTransferPanel options={sshOptions} setOptions={updateSshOptions} />
  ) : (
    <DeferredSection
      modeLabel={selectedProtocolLabel}
      section={activeSectionDefinition}
    />
  );
}
