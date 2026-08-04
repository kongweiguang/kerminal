// @author kongweiguang

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteHost } from "../../../../src/lib/remoteHostApi";
import { RemoteHostCreateDialog } from "../../../../src/features/machine-sidebar/RemoteHostCreateDialog";
import {
  chooseSelectOption,
  createdHost,
  groups,
} from "../../support/machine-sidebar/RemoteHostCreateDialog.testSupport";

describe("RemoteHostCreateDialog Telnet and Serial modes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("creates a Telnet host without SSH credentials", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const savedTelnetHost: RemoteHost = {
      ...createdHost,
      authType: "agent",
      credentialRef: undefined,
      host: "lab.internal",
      id: "telnet-lab",
      name: "lab telnet",
      port: 2323,
      tags: ["telnet"],
      username: "",
    };
    const onCreateHost = vi.fn().mockResolvedValue(savedTelnetHost);
    const onCreated = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="telnet"
        groups={groups}
        onClose={onClose}
        onCreateHost={onCreateHost}
        onCreated={onCreated}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "lab telnet");
    await user.type(screen.getByLabelText("主机"), "lab.internal");
    await user.clear(screen.getByLabelText("端口"));
    await user.type(screen.getByLabelText("端口"), "2323");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "lab.internal",
      name: "lab telnet",
      port: 2323,
      protocol: "telnet",
      tags: ["telnet"],
      username: "",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(savedTelnetHost));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("creates a Serial host with explicit port settings", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const savedSerialHost: RemoteHost = {
      ...createdHost,
      authType: "agent",
      credentialRef: undefined,
      host: "COM9",
      id: "serial-console",
      name: "console serial",
      port: 1,
      tags: [
        "serial",
        "serial-port:COM9",
        "serial-baud:115200",
        "serial-data-bits:7",
        "serial-stop-bits:2",
        "serial-parity:even",
        "serial-flow:rtscts",
      ],
      username: "",
    };
    const onCreateHost = vi.fn().mockResolvedValue(savedSerialHost);
    const onCreated = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="serial"
        groups={groups}
        onClose={onClose}
        onCreateHost={onCreateHost}
        onCreated={onCreated}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "console serial");
    await user.click(screen.getByRole("button", { name: "串口" }));
    await user.type(screen.getByLabelText("串口"), "COM9");
    await user.clear(screen.getByLabelText("波特率"));
    await user.type(screen.getByLabelText("波特率"), "115200");
    await chooseSelectOption(user, "数据位", "7");
    await chooseSelectOption(user, "停止位", "2");
    await chooseSelectOption(user, "校验", "Even");
    await chooseSelectOption(user, "流控", "RTS/CTS");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "COM9",
      name: "console serial",
      port: 1,
      protocol: "serial",
      tags: [
        "serial",
        "serial-port:COM9",
        "serial-baud:115200",
        "serial-data-bits:7",
        "serial-stop-bits:2",
        "serial-parity:even",
        "serial-flow:rtscts",
      ],
      username: "",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(savedSerialHost));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("validates Serial baud without saving", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="serial"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "bad serial");
    await user.click(screen.getByRole("button", { name: "串口" }));
    await user.type(screen.getByLabelText("串口"), "COM9");
    await user.clear(screen.getByLabelText("波特率"));
    await user.type(screen.getByLabelText("波特率"), "42");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    const validationMessage = screen.getByText(
      "波特率必须是 300 到 4000000 之间的整数。",
    );
    expect(validationMessage).toBeInTheDocument();
    expect(validationMessage.closest("footer")).not.toBeNull();
    expect(onCreateHost).not.toHaveBeenCalled();
  });
});
