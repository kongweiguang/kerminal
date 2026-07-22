// @author kongweiguang

import "../../support/tool-panel/ToolPanel.testSupport";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tools } from "../../../../src/features/workspace/workspaceData";
import { ToolPanel } from "../../../../src/features/tool-panel/ToolPanel";
import {
  containerMachine,
  diagnosticsApiMocks,
  localMachine,
  serverInfoApiMocks,
  sshMachine,
} from "../../support/tool-panel/ToolPanel.testSupport";

describe("ToolPanel system", () => {
it("uses the unified local monitor when no tab is open despite a sidebar selection", async () => {
  render(
    <ToolPanel
      activeTool="system"
      onActiveToolChange={vi.fn()}
      selectedMachine={sshMachine}
      tools={tools}
    />,
  );

  expect(await screen.findByText("本机系统")).toBeInTheDocument();
  expect(screen.queryByText("本机运行体验")).not.toBeInTheDocument();
  expect(
    screen.getByRole("tablist", { name: "系统信息视图" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(diagnosticsApiMocks.getRuntimeHealthSnapshot).toHaveBeenCalled();
  expect(serverInfoApiMocks.getServerInfoSnapshot).not.toHaveBeenCalled();
});

it("shows the redesigned system monitor for local machines", async () => {
  render(
    <ToolPanel
      activeTool="system"
      activeMachine={localMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(await screen.findByText("本机系统")).toBeInTheDocument();
  expect(screen.queryByText("远程服务器")).not.toBeInTheDocument();
  expect(
    screen.getByRole("tablist", { name: "系统信息视图" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "资源" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "进程" })).toBeInTheDocument();
  expect(diagnosticsApiMocks.getRuntimeHealthSnapshot).toHaveBeenCalled();
  expect(serverInfoApiMocks.getServerInfoSnapshot).not.toHaveBeenCalled();
});

it("keeps local runtime failures behind technical details", async () => {
  diagnosticsApiMocks.getRuntimeHealthSnapshot.mockRejectedValueOnce(
    new Error("snapshot failed: token=secret"),
  );

  render(
    <ToolPanel
      activeTool="system"
      activeMachine={localMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(await screen.findByText("无法读取本机系统信息")).toBeVisible();
  const technicalDetail = screen.getByText(/snapshot failed/);
  expect(technicalDetail).not.toBeVisible();
  expect(technicalDetail).not.toHaveTextContent("token=secret");
  expect(
    screen.getByRole("button", { name: "刷新本机系统信息" }),
  ).toBeInTheDocument();
});

it("loads and refreshes system metrics for the active SSH host", async () => {
  const user = userEvent.setup();

  render(
    <ToolPanel
      activeTool="system"
      activeMachine={sshMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(await screen.findByText("prod-api-01")).toBeInTheDocument();
  expect(document.body.innerHTML).not.toContain("--accent-color");
  expect(screen.queryByText("本机运行体验")).not.toBeInTheDocument();
  expect(
    screen.queryByText("NVIDIA GeForce RTX 4060"),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText("CPU").length).toBeGreaterThan(0);
  expect(screen.getAllByText("GPU").length).toBeGreaterThan(0);
  expect(screen.getAllByText("内存").length).toBeGreaterThan(0);
  expect(screen.getAllByText("磁盘").length).toBeGreaterThan(0);
  expect(screen.getByRole("tab", { name: "进程" })).toBeInTheDocument();
  expect(screen.getByText("6.8.0")).toBeInTheDocument();
  const intervalSelect = screen.getByRole("combobox", {
    name: "系统信息采集间隔",
  });
  expect(intervalSelect).toHaveAttribute("aria-valuetext", "3s");
  await user.click(intervalSelect);
  expect(screen.getByRole("option", { name: "手动" })).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: "手动" }));
  expect(intervalSelect).toHaveAttribute("aria-valuetext", "手动");
  expect(screen.getAllByText("采样中").length).toBeGreaterThan(0);
  expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledWith({
    hostId: "prod-api",
    target: {
      hostId: "prod-api",
      kind: "ssh",
    },
  });

  await user.click(screen.getByRole("tab", { name: "资源" }));
  expect(screen.getByText("4 核")).toBeInTheDocument();
  expect(screen.getAllByText(/%/).length).toBeGreaterThan(0);
  expect(screen.getByText("AMD EPYC 7B13")).toBeInTheDocument();
  expect(screen.getAllByText("NVIDIA RTX 4090").length).toBeGreaterThan(0);
  expect(screen.getAllByText("eth0").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("tab", { name: "进程" }));
  expect(screen.getByText("kerminal-agent")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "刷新服务器信息" }));

  expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledTimes(2);
});

it("shows primary network rates and all network interfaces", async () => {
  const user = userEvent.setup();
  serverInfoApiMocks.getServerInfoSnapshot
    .mockResolvedValueOnce({
      architecture: "x86_64",
      capturedAt: "10",
      cpuCount: 4,
      diskMount: "/",
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      hostname: "prod-api-01",
      memoryTotalBytes: 8 * 1024 * 1024 * 1024,
      memoryUsedBytes: 4 * 1024 * 1024 * 1024,
      networkInterfaces: [
        {
          name: "lo",
          rxBytes: 1_000_000,
          txBytes: 1_000_000,
        },
        {
          name: "eth0",
          rxBytes: 10 * 1024,
          txBytes: 5 * 1024,
        },
        {
          name: "tailscale0",
          rxBytes: 2 * 1024,
          txBytes: 1024,
        },
      ],
      networkRxBytes: 1_012_288,
      networkTxBytes: 1_006_144,
      os: "Linux",
      port: 22,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      uptimeSeconds: 90_000,
      username: "deploy",
    })
    .mockResolvedValueOnce({
      architecture: "x86_64",
      capturedAt: "13",
      cpuCount: 4,
      diskMount: "/",
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      hostname: "prod-api-01",
      memoryTotalBytes: 8 * 1024 * 1024 * 1024,
      memoryUsedBytes: 4 * 1024 * 1024 * 1024,
      networkInterfaces: [
        {
          name: "lo",
          rxBytes: 1_000_000,
          txBytes: 1_000_000,
        },
        {
          name: "eth0",
          rxBytes: 16 * 1024,
          txBytes: 8 * 1024,
        },
        {
          name: "tailscale0",
          rxBytes: 5 * 1024,
          txBytes: 2_560,
        },
      ],
      networkRxBytes: 1_021_504,
      networkTxBytes: 1_010_752,
      os: "Linux",
      port: 22,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      uptimeSeconds: 90_003,
      username: "deploy",
    });

  render(
    <ToolPanel
      activeTool="system"
      activeMachine={sshMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(await screen.findByText("prod-api-01")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "刷新服务器信息" }));
  await waitFor(() => {
    expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledTimes(2);
  });

  expect(screen.getByText("1.0 KB/s")).toBeInTheDocument();
  expect(screen.getByText("2.0 KB/s")).toBeInTheDocument();
  expect(screen.queryByText("lo")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "资源" }));
  expect(screen.getAllByText("eth0").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "全部" }));
  expect(screen.getByText("lo")).toBeInTheDocument();
  expect(screen.getByText("tailscale0")).toBeInTheDocument();
});

it("renders nullable SSH system metrics without crashing", async () => {
  serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValueOnce({
    architecture: null,
    capturedAt: "1",
    cpuCount: null,
    cpuCoreUsagePercents: null,
    cpuUsagePercent: null,
    diskMount: null,
    diskTotalBytes: null,
    diskUsedBytes: null,
    gpus: null,
    host: "prod.internal",
    hostId: "prod-api",
    hostName: "prod api",
    hostname: null,
    kernel: null,
    loadAverage: null,
    memoryTotalBytes: null,
    memoryUsedBytes: null,
    networkRxBytes: null,
    networkTxBytes: null,
    os: null,
    port: 22,
    swapTotalBytes: null,
    swapUsedBytes: null,
    uptimeSeconds: null,
    username: "deploy",
  });

  render(
    <ToolPanel
      activeTool="system"
      activeMachine={sshMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(await screen.findByText("远程服务器")).toBeInTheDocument();
  await waitFor(() => {
    expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledWith({
      hostId: "prod-api",
      target: {
        hostId: "prod-api",
        kind: "ssh",
      },
    });
  });
  expect(screen.queryByText("系统加载失败")).not.toBeInTheDocument();
  expect(screen.getAllByText("CPU").length).toBeGreaterThan(0);
  expect(screen.getAllByText("-").length).toBeGreaterThan(0);
});

it("loads system metrics from the active container target", async () => {
  render(
    <ToolPanel
      activeTool="system"
      activeMachine={containerMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(await screen.findByText("容器系统")).toBeInTheDocument();
  expect(screen.queryByText("本机运行体验")).not.toBeInTheDocument();
  expect(screen.getByText("api · docker @ prod-api")).toBeInTheDocument();
  expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledWith({
    hostId: "prod-api",
    target: {
      containerId: "c0ffee1234567890",
      containerName: "api",
      hostId: "prod-api",
      kind: "dockerContainer",
      runtime: "docker",
      workdir: "/app",
    },
  });
});

it("shows zero GPUs while keeping the empty GPU details aligned", async () => {
  serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValueOnce({
    capturedAt: "1",
    gpus: [],
    gpuProbeStatus: "nvidia_smi_no_devices",
    host: "prod.internal",
    hostId: "prod-api",
    hostName: "prod api",
    hostname: "prod-api-01",
    port: 22,
    username: "deploy",
  });

  render(
    <ToolPanel
      activeTool="system"
      activeMachine={sshMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect((await screen.findAllByText("0 张")).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole("tab", { name: "资源" }));
  expect(screen.getByText("0 张显卡")).toBeInTheDocument();
  expect(screen.getByText("未发现可监控 GPU")).toBeInTheDocument();
  expect(screen.queryByText(/NVIDIA-SMI has failed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/未返回可用 NVIDIA GPU/)).not.toBeInTheDocument();
});

it("renders lspci GPU fallback devices without utilization", async () => {
  serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValueOnce({
    architecture: "x86_64",
    capturedAt: "1",
    cpuCount: 8,
    cpuCoreUsagePercents: [11, 12, 13, 14, 15, 16, 17, 18],
    cpuUsagePercent: 14.5,
    diskMount: "/",
    diskTotalBytes: 64 * 1024 * 1024 * 1024,
    diskUsedBytes: 16 * 1024 * 1024 * 1024,
    gpus: [
      {
        name: "Intel Corporation UHD Graphics",
      },
    ],
    gpuProbeStatus: "lspci",
    host: "prod.internal",
    hostId: "prod-api",
    hostName: "prod api",
    hostname: "prod-api-01",
    kernel: "6.8.0",
    loadAverage: [0.1, 0.2, 0.3],
    memoryTotalBytes: 8 * 1024 * 1024 * 1024,
    memoryUsedBytes: 4 * 1024 * 1024 * 1024,
    networkRxBytes: 1024,
    networkTxBytes: 2048,
    os: "Linux",
    port: 22,
    swapTotalBytes: 2 * 1024 * 1024 * 1024,
    swapUsedBytes: 0,
    uptimeSeconds: 90_000,
    username: "deploy",
  });
  const user = userEvent.setup();

  render(
    <ToolPanel
      activeTool="system"
      activeMachine={sshMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  await screen.findByText("prod-api-01");
  await user.click(screen.getByRole("tab", { name: "资源" }));
  expect(screen.getByText("1 张设备，仅静态识别")).toBeInTheDocument();
  expect(
    screen.getByText("Intel Corporation UHD Graphics"),
  ).toBeInTheDocument();
  expect(screen.getAllByText(/仅静态识别/).length).toBeGreaterThan(0);
});

it("renders nvidia-smi list fallback devices without treating them as missing", async () => {
  serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValueOnce({
    architecture: "x86_64",
    capturedAt: "1",
    cpuCount: 8,
    cpuCoreUsagePercents: [11, 12, 13, 14, 15, 16, 17, 18],
    cpuUsagePercent: 14.5,
    diskMount: "/",
    diskTotalBytes: 64 * 1024 * 1024 * 1024,
    diskUsedBytes: 16 * 1024 * 1024 * 1024,
    gpus: [
      {
        name: "NVIDIA RTX 4500 Ada Generation",
        vendor: "NVIDIA",
      },
    ],
    gpuProbeStatus: "nvidia_smi_list",
    host: "prod.internal",
    hostId: "prod-api",
    hostName: "prod api",
    hostname: "prod-api-01",
    kernel: "6.8.0",
    loadAverage: [0.1, 0.2, 0.3],
    memoryTotalBytes: 8 * 1024 * 1024 * 1024,
    memoryUsedBytes: 4 * 1024 * 1024 * 1024,
    networkRxBytes: 1024,
    networkTxBytes: 2048,
    os: "Linux",
    port: 22,
    swapTotalBytes: 2 * 1024 * 1024 * 1024,
    swapUsedBytes: 0,
    uptimeSeconds: 90_000,
    username: "deploy",
  });
  const user = userEvent.setup();

  render(
    <ToolPanel
      activeTool="system"
      activeMachine={sshMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  await screen.findByText("prod-api-01");
  await user.click(screen.getByRole("tab", { name: "资源" }));
  expect(screen.getByText("1 张设备，仅静态识别")).toBeInTheDocument();
  expect(
    screen.getByText("NVIDIA RTX 4500 Ada Generation"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/未返回可用 NVIDIA GPU/)).not.toBeInTheDocument();
});
});
