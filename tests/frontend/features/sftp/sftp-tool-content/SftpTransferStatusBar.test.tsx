/**
 * SFTP 传输状态栏测试。
 *
 * @author kongweiguang
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SftpTransferSummary } from "../../../../../src/lib/sftpApi";
import { SftpTransferStatusBar } from "../../../../../src/features/sftp/sftp-tool-content/SftpTransferStatusBar";

function transfer(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  const remotePath = overrides.remotePath ?? "/var/log/app.log";
  const localPath = overrides.localPath ?? "/Users/me/Downloads/app.log";

  return {
    bytesTransferred: 512,
    cancelRequested: false,
    createdAt: 1,
    direction: "download",
    hostId: "prod-api",
    id: "transfer-running",
    kind: "file",
    localPath,
    operation: "download",
    remotePath,
    source: {
      hostId: "prod-api",
      hostLabel: "prod-api",
      kind: "remote",
      path: remotePath,
    },
    status: "running",
    target: {
      kind: "local",
      path: localPath,
    },
    totalBytes: 1024,
    transportMode: "singleHostSftp",
    updatedAt: 1,
    ...overrides,
  };
}

describe("SftpTransferStatusBar", () => {
  it("does not offer cancel again after a transfer already requested cancellation", () => {
    const onCancel = vi.fn();

    render(
      <SftpTransferStatusBar
        onCancel={onCancel}
        onClearCompleted={vi.fn()}
        onRetry={vi.fn()}
        transfers={[transfer({ cancelRequested: true })]}
      />,
    );

    expect(
      screen.getByRole("status", { name: "SFTP 传输状态" }),
    ).toBeInTheDocument();
    expect(screen.getByText("app.log")).toBeInTheDocument();
    expect(screen.getByLabelText("正在取消")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消传输 app.log" }),
    ).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("offers clear when finished transfers exist alongside active transfers", async () => {
    const user = userEvent.setup();
    const onClearCompleted = vi.fn();

    render(
      <SftpTransferStatusBar
        onCancel={vi.fn()}
        onClearCompleted={onClearCompleted}
        onRetry={vi.fn()}
        transfers={[
          transfer({ id: "running", status: "running" }),
          transfer({
            bytesTransferred: 1024,
            id: "succeeded",
            status: "succeeded",
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "清理完成的传输" }));

    expect(onClearCompleted).toHaveBeenCalledTimes(1);
  });

  it("keeps transfer metadata collapsed until the focused detail action is opened", async () => {
    const user = userEvent.setup();

    render(
      <SftpTransferStatusBar
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onRetry={vi.fn()}
        transfers={[transfer()]}
      />,
    );

    expect(
      screen.queryByText(
        "prod-api:/var/log/app.log -> /Users/me/Downloads/app.log",
      ),
    ).not.toBeInTheDocument();

    const detailButton = screen.getByRole("button", {
      name: "查看传输详情 app.log",
    });
    detailButton.focus();
    await user.keyboard("{Enter}");

    expect(detailButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(
        "prod-api:/var/log/app.log -> /Users/me/Downloads/app.log",
      ),
    ).toBeInTheDocument();
  });

  it("keeps long transfer history compact and expandable", async () => {
    const user = userEvent.setup();

    render(
      <SftpTransferStatusBar
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onRetry={vi.fn()}
        transfers={Array.from({ length: 6 }, (_, index) =>
          transfer({
            id: `transfer-${index}`,
            localPath: `/Users/me/Downloads/app-${index}.log`,
            remotePath: `/var/log/app-${index}.log`,
            updatedAt: index,
          }),
        )}
      />,
    );

    const history = screen.getByLabelText("SFTP 传输历史列表");

    expect(history).toHaveClass("max-h-[15rem]", "overflow-hidden");
    expect(screen.getByText("app-0.log")).toBeInTheDocument();
    expect(screen.getByText("app-2.log")).toBeInTheDocument();
    expect(screen.queryByText("app-3.log")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "展开传输历史，查看其余 3 项",
      }),
    );

    expect(history).toHaveClass("max-h-72", "overflow-y-auto");
    expect(screen.getByText("app-5.log")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "收起传输历史" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("offers manual retry for failed managed transfers", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const failedTransfer = transfer({
      conflictPolicy: "overwrite",
      id: "failed-download",
      status: "failed",
    });

    render(
      <SftpTransferStatusBar
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onRetry={onRetry}
        transfers={[failedTransfer]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "重新传输 app.log" }));

    expect(onRetry).toHaveBeenCalledWith(failedTransfer);
  });

  it("offers manual retry for canceled managed transfers", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const canceledTransfer = transfer({
      conflictPolicy: "overwrite",
      id: "canceled-download",
      status: "canceled",
    });

    render(
      <SftpTransferStatusBar
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onRetry={onRetry}
        transfers={[canceledTransfer]}
      />,
    );

    const retryButton = screen.getByRole("button", {
      name: "重新传输 app.log",
    });
    expect(retryButton).toHaveAttribute(
      "title",
      "已请求重新传输；该任务没有可用断点。",
    );

    await user.click(retryButton);

    expect(onRetry).toHaveBeenCalledWith(canceledTransfer);
  });

  it("explains why failed transfers without retry metadata cannot be retried", async () => {
    const user = userEvent.setup();

    render(
      <SftpTransferStatusBar
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onRetry={vi.fn()}
        transfers={[
          transfer({
            operation: "remoteCopy",
            status: "failed",
          }),
        ]}
      />,
    );

    expect(
      screen.queryByText("不能安全重试：该传输类型暂不支持安全重试。"),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "查看传输详情 app.log" }),
    );
    expect(
      screen.getByText("不能安全重试：该传输类型暂不支持安全重试。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /继续传输 app.log|重新传输 app.log/ }),
    ).not.toBeInTheDocument();
  });
});
