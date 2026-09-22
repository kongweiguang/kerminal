/**
 * SFTP 紧凑传输队列行的恢复交互测试。
 *
 * @author kongweiguang
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SftpTransferQueueRow } from "../../../../src/features/sftp/SftpTransferQueueRow";
import { createSftpTransferSummary } from "../../support/sftp/SftpToolContent.testSupport";

describe("SftpTransferQueueRow", () => {
  it("keeps the idle-timeout recovery action singular and exposes its stable message", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const transfer = createSftpTransferSummary({
      bytesTransferred: 512,
      failureKind: "idleTimeout",
      idleTimeoutSeconds: 180,
      id: "long-transfer",
      localPath: "C:/Users/example/Downloads/a-very-long-artifact-name.tar.zst",
      remotePath: "/srv/releases/a-very-long-artifact-name.tar.zst",
      status: "failed",
      totalBytes: 1024,
    });

    render(
      <SftpTransferQueueRow
        onCancel={vi.fn()}
        onRetry={onRetry}
        transfer={transfer}
      />,
    );

    expect(
      screen.getByRole("button", { name: /继续传输.*a-very-long-artifact-name/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("网络连续 3 分钟无响应"),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /继续传输.*a-very-long-artifact-name/ }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /重试传输/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /查看传输详情/ }));
    expect(screen.getByText("网络连续 3 分钟无响应")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: /继续传输.*a-very-long-artifact-name/ }),
    );
    expect(onRetry).toHaveBeenCalledWith(transfer);
  });
});
