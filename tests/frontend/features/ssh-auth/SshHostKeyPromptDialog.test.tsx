// @author kongweiguang

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SshHostKeyInspection } from "../../../../src/lib/sshHostKeyApi";
import { SshHostKeyPromptDialog } from "../../../../src/features/ssh-host-key/SshHostKeyPromptDialog";

const unknownInspection: SshHostKeyInspection = {
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:host-key",
  host: "dev.example.com",
  hostId: "host-1",
  port: 22,
  status: "unknown",
};

describe("SshHostKeyPromptDialog", () => {
  it("shows target, algorithm and SHA-256 fingerprint and confirms without native dialogs", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SshHostKeyPromptDialog
        inspection={unknownInspection}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        open
      />,
    );

    expect(screen.getByRole("dialog", { name: "确认 SSH 主机身份" })).toBeInTheDocument();
    expect(screen.getAllByText("dev.example.com:22").length).toBe(2);
    expect(screen.getByText("ssh-ed25519")).toBeVisible();
    expect(screen.getByText("SHA256:host-key")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "信任并连接" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not offer a trust action for changed identity", () => {
    render(
      <SshHostKeyPromptDialog
        inspection={{ ...unknownInspection, status: "changed" }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole("button", { name: "信任并连接" })).toBeDisabled();
  });
});
