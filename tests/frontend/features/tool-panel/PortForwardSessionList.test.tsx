// @author kongweiguang

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PortForwardSessionList } from "../../../../src/features/tool-panel/port-forward/PortForwardSessionList";
import type { PortForwardSummary } from "../../../../src/lib/portForwardApi";

describe("PortForwardSessionList", () => {
  it("renders icon-only actions with edit and a red delete action", () => {
    const onEdit = vi.fn();
    render(
      <PortForwardSessionList
        canInject={false}
        injectDisabledReason="not focused"
        loading={false}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onEdit={onEdit}
        onInject={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleAutoUse={vi.fn()}
        sessions={[localForward]}
      />,
    );

    const row = screen.getByText("HTTP 80").closest("article");
    expect(row).not.toBeNull();
    const actions = within(row as HTMLElement);

    expect(row).toHaveTextContent(
      "127.0.0.1:18080→127.0.0.1:80",
    );
    expect(actions.queryByText("方向")).not.toBeInTheDocument();
    expect(actions.queryByText("来源")).not.toBeInTheDocument();
    expect(actions.queryByText("复制地址")).toBeNull();
    expect(actions.queryByText("编辑隧道")).toBeNull();
    expect(actions.queryByText("删除")).toBeNull();

    fireEvent.click(
      actions.getByRole("button", { name: "展开 HTTP 80 详情" }),
    );
    expect(actions.getByText("方向")).toBeInTheDocument();
    expect(actions.getByText("来源")).toBeInTheDocument();
    expect(actions.getByText("手动")).toBeInTheDocument();

    fireEvent.click(actions.getByRole("button", { name: "编辑隧道" }));
    expect(onEdit).toHaveBeenCalledWith(localForward);

    expect(
      actions.getByRole("button", { name: "删除隧道" }).className,
    ).toContain("text-rose-700");
  });

  it("keeps runtime diagnostics out of restored legacy fallback sessions", () => {
    render(
      <PortForwardSessionList
        canInject={false}
        injectDisabledReason="not focused"
        loading={false}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onInject={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleAutoUse={vi.fn()}
        sessions={[legacyFallbackForward]}
      />,
    );

    expect(screen.getByText("Legacy fallback")).toBeInTheDocument();
    expect(screen.queryByText(/Runtime:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fallback:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenSSH process/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SSH 端口转发进程已退出/)).not.toBeInTheDocument();
  });

  it("shows a non-terminal direct-tcpip failure on a running tunnel", () => {
    render(
      <PortForwardSessionList
        canInject={false}
        injectDisabledReason="not focused"
        loading={false}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onInject={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleAutoUse={vi.fn()}
        sessions={[runningFailedForward]}
      />,
    );

    const failure = screen.getByRole("alert", {
      name: "最近一次转发失败",
    });
    expect(failure).toHaveTextContent("最近一次连接失败，隧道仍在监听");
    expect(failure).toHaveTextContent("administratively prohibited");
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });
});

const localForward: PortForwardSummary = {
  bindHost: "127.0.0.1",
  createdAt: "2026-07-05T12:00:00+08:00",
  hostId: "external:launch-123",
  hostName: "External Launch",
  id: "forward-1",
  kind: "local",
  localBindHost: "127.0.0.1",
  localEndpoint: {
    host: "127.0.0.1",
    label: "本机监听",
    port: 18080,
    protocol: "tcp",
    side: "local",
  },
  name: "HTTP 80",
  remoteEndpoint: {
    host: "127.0.0.1",
    label: "主机服务",
    port: 80,
    protocol: "tcp",
    side: "host",
  },
  sourcePort: 18080,
  status: "running",
  targetHost: "127.0.0.1",
  targetPort: 80,
};

const legacyFallbackForward: PortForwardSummary = {
  ...localForward,
  id: "forward-legacy",
  name: "Legacy fallback",
  runtime: {
    backend: "openssh",
    cleanupStatus: "cleanedUp",
    fallbackReason: "managed SSH forward runtime unavailable or unsupported",
    mode: "openSshProcess",
    recentFailure: "SSH 端口转发进程已退出，退出码: exit code: 255",
    tunnelKind: "local",
  },
  status: "exited",
};

const runningFailedForward: PortForwardSummary = {
  ...localForward,
  id: "forward-running-failed",
  name: "Bastion tunnel",
  runtime: {
    backend: "native-russh",
    cleanupStatus: "active",
    managedChannelKind: "direct-tcpip",
    mode: "managedSshRuntime",
    recentFailure:
      "受管 SSH local forward direct-tcpip 失败: channel open failure: administratively prohibited",
    tunnelKind: "local",
  },
};
