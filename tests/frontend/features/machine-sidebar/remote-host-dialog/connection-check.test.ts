// @author kongweiguang

import { describe, expect, it } from "vitest";
import { createDefaultSshOptions } from "../../../../../src/lib/remoteHostApi";
import type { ConnectionCheckInput } from "../../../../../src/features/machine-sidebar/remote-host-dialog/connection-check";
import { evaluateConnectionCheck } from "../../../../../src/features/machine-sidebar/remote-host-dialog/connection-check";

function baseInput(
  overrides: Partial<ConnectionCheckInput> = {},
): ConnectionCheckInput {
  return {
    authType: "agent",
    credentialRef: "",
    credentialSecret: "",
    keyPassphraseSecret: "",
    editingLocalMachine: false,
    groupId: "",
    host: "127.0.0.1",
    localArgs: "",
    localCwd: "",
    localEnv: "",
    localShell: "",
    localTitle: "",
    mode: "ssh",
    name: "Dev Host",
    port: "22",
    production: false,
    rdpFullscreen: true,
    rdpHeight: "900",
    rdpNote: "",
    rdpPassword: "",
    rdpUsername: "administrator",
    rdpWidth: "1440",
    selectedProtocolLabel: "SSH",
    serialBaud: "9600",
    serialDataBits: "8",
    serialFlow: "none",
    serialParity: "none",
    serialPort: "COM3",
    serialStopBits: "1",
    sshOptions: createDefaultSshOptions(),
    tags: "",
    username: "root",
    ...overrides,
  };
}

describe("evaluateConnectionCheck", () => {
  it("builds a backend SSH test request for a valid SSH form", () => {
    expect(evaluateConnectionCheck(baseInput())).toEqual({
      ok: true,
      testRequest: {
        host: {
          authType: "agent",
          credentialRef: undefined,
          credentialSecret: undefined,
          groupId: undefined,
          host: "127.0.0.1",
          name: "Dev Host",
          port: 22,
          production: false,
          protocol: "ssh",
          sshOptions: createDefaultSshOptions(),
          tags: [],
          username: "root",
        },
        mode: "ssh",
      },
    });
  });

  it("reports SSH authentication requirements before success", () => {
    expect(
      evaluateConnectionCheck(baseInput({ authType: "password" })),
    ).toEqual({
      error: "密码认证需要输入 SSH 密码。",
      ok: false,
    });
  });

  it("passes an encrypted private key passphrase into an SFTP connection test", () => {
    expect(
      evaluateConnectionCheck(
        baseInput({
          authType: "key",
          credentialRef: "/home/deploy/.ssh/id_ed25519",
          keyPassphraseSecret: "sftp-key-passphrase",
          mode: "sftp",
          selectedProtocolLabel: "SFTP",
        }),
      ),
    ).toMatchObject({
      ok: true,
      testRequest: {
        host: {
          keyPassphraseSecret: "sftp-key-passphrase",
          protocol: "sftp",
        },
        mode: "sftp",
      },
    });
  });

  it("requires saved credentials for password jump hosts", () => {
    const sshOptions = createDefaultSshOptions();
    sshOptions.jumpHosts = [
      {
        authType: "password",
        host: "bastion.internal",
        name: "bastion",
        port: 22,
        username: "ops",
      },
    ];

    expect(evaluateConnectionCheck(baseInput({ sshOptions }))).toEqual({
      error: "第 1 个跳板机密码认证需要输入 SSH 密码。",
      ok: false,
    });
  });

  it("accepts password jump hosts when a saved secret is available", () => {
    const sshOptions = createDefaultSshOptions();
    sshOptions.jumpHosts = [
      {
        authType: "password",
        credentialSecret: "jump-secret",
        host: "bastion.internal",
        name: "bastion",
        port: 22,
        username: "ops",
      },
    ];

    expect(evaluateConnectionCheck(baseInput({ sshOptions }))).toMatchObject({
      ok: true,
      testRequest: {
        mode: "ssh",
      },
    });
  });

  it("keeps local terminal validation outside the component", () => {
    expect(
      evaluateConnectionCheck(
        baseInput({
          localEnv: "VALID=value\nBROKEN",
          mode: "local",
          selectedProtocolLabel: "Local",
        }),
      ),
    ).toEqual({
      error: "环境变量第 2 行需要使用 KEY=value。",
      ok: false,
    });

    expect(
      evaluateConnectionCheck(
        baseInput({
          editingLocalMachine: true,
          localEnv: "TERM=xterm-256color",
          mode: "local",
          selectedProtocolLabel: "Local",
        }),
      ),
    ).toEqual({
      ok: true,
      statusMessage: "本地终端配置检查通过，确认后会保存到左侧卡片。",
    });
  });

  it("uses protocol-specific validators for RDP and Serial", () => {
    expect(
      evaluateConnectionCheck(
        baseInput({
          mode: "rdp",
          rdpFullscreen: false,
          rdpWidth: "639",
          selectedProtocolLabel: "RDP",
        }),
      ),
    ).toEqual({ error: "RDP 窗口尺寸不能小于 640x480。", ok: false });

    expect(
      evaluateConnectionCheck(
        baseInput({
          mode: "serial",
          selectedProtocolLabel: "Serial",
          serialBaud: "100",
        }),
      ),
    ).toEqual({
      error: "波特率必须是 300 到 4000000 之间的整数。",
      ok: false,
    });
  });

  it("returns an explicit unsupported message for future protocols", () => {
    expect(
      evaluateConnectionCheck(
        baseInput({
          mode: "ftp",
          selectedProtocolLabel: "FTP",
        }),
      ),
    ).toEqual({ error: "FTP 暂未支持测试。", ok: false });
  });
});
