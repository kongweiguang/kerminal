// @author kongweiguang

import { useState } from "react";
import { Network, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import type {
  RemoteHostAuthType,
  SshJumpHostOptions,
  SshOptions,
} from "../../../lib/remoteHostApi";
import type { Machine } from "../../workspace/contracts/index";
import { authOptions } from "./model";
import {
  moveAt,
  normalizeJumpHostDraft,
  optionalNumber,
  removeAt,
  trimOptional,
  trimText,
} from "./request-builders";
import type { SshOptionsSetter } from "./ssh-network-panels";
import {
  ConfigList,
  ConfigListItem,
  EmptyConfigState,
  FieldRow,
  inputClassName,
  ListReorderActions,
  PasswordInput,
} from "./shared-ui";
import { SearchableHostSelect } from "./searchable-host-select";

export function SshJumpPanel({
  options,
  setOptions,
  sshMachines,
}: {
  options: SshOptions;
  setOptions: SshOptionsSetter;
  sshMachines: Machine[];
}) {
  const [draft, setDraft] = useState<SshJumpHostOptions>({
    authType: "agent",
    credentialRef: undefined,
    credentialSecret: undefined,
    host: "",
    name: "",
    port: 22,
    username: "",
  });
  const [draftError, setDraftError] = useState<string | null>(null);
  const selectExistingHost = (hostId: string) => {
    if (!hostId) {
      return;
    }
    const selectedHost = sshMachines.find((machine) => machine.id === hostId);
    if (!selectedHost) {
      return;
    }
    setDraft(jumpHostDraftFromMachine(selectedHost));
    setDraftError(null);
  };
  const updateDraft = (nextDraft: Partial<SshJumpHostOptions>) => {
    setDraft((current) => ({ ...current, ...nextDraft }));
  };
  const addJumpHost = () => {
    if (!draft.host.trim()) {
      setDraftError("跳板机主机不能为空。");
      return;
    }
    if (!draft.username.trim()) {
      setDraftError("跳板机用户名不能为空。");
      return;
    }
    if (draft.authType === "password" && !draft.credentialSecret?.trim()) {
      setDraftError("跳板机密码认证需要输入 SSH 密码。");
      return;
    }
    if (
      draft.authType === "key" &&
      !draft.credentialRef?.trim() &&
      !draft.credentialSecret?.trim()
    ) {
      setDraftError("跳板机密钥认证需要填写私钥路径或私钥内容。");
      return;
    }
    setDraftError(null);
    setOptions((current) => ({
      ...current,
      jumpHosts: [...current.jumpHosts, normalizeJumpHostDraft(draft)],
    }));
    setDraft({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      host: "",
      name: "",
      port: 22,
      username: "",
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <FieldRow label="已有主机">
          <div className="space-y-1">
            <SearchableHostSelect
              ariaLabel="已有跳板机主机"
              disabled={sshMachines.length === 0}
              machines={sshMachines}
              onSelectHost={selectExistingHost}
            />
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {sshMachines.length > 0
                ? "选择已有 SSH 主机可回填信息。"
                : "暂无可选 SSH 主机，可手填。"}
            </p>
          </div>
        </FieldRow>
        <FieldRow label="名称">
          <input
            aria-label="跳板机名称"
            className={inputClassName}
            onChange={(event) => {
              const value = event.currentTarget.value;
              updateDraft({ name: value });
            }}
            placeholder="可选，例如 bastion"
            value={draft.name}
          />
        </FieldRow>
        <FieldRow label="主机">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
            <input
              aria-label="跳板机主机"
              className={inputClassName}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateDraft({ host: value });
              }}
              placeholder="bastion.internal"
              value={draft.host}
            />
            <input
              aria-label="跳板机端口"
              className={inputClassName}
              inputMode="numeric"
              onChange={(event) => {
                const value = optionalNumber(event.currentTarget.value) ?? 22;
                updateDraft({ port: value });
              }}
              value={draft.port}
            />
          </div>
        </FieldRow>
        <FieldRow label="用户">
          <input
            aria-label="跳板机用户名"
            className={inputClassName}
            onChange={(event) => {
              const value = event.currentTarget.value;
              updateDraft({ username: value });
            }}
            placeholder="ops"
            value={draft.username}
          />
        </FieldRow>
        <FieldRow label="认证">
          <div className="grid gap-3 md:grid-cols-[184px_minmax(0,1fr)]">
            <Select
              aria-label="跳板机认证方式"
              buttonClassName="h-9"
              onValueChange={(value) => {
                const authType = value as RemoteHostAuthType;
                updateDraft({
                  authType,
                  credentialRef: authType === "key" ? draft.credentialRef : undefined,
                  credentialSecret: undefined,
                });
              }}
              options={authOptions.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              value={draft.authType}
            />
            {draft.authType === "agent" ? (
              <div className="flex h-9 items-center rounded-[var(--radius-control)] border border-dashed border-[var(--border-subtle)] px-3 text-[13px] text-[var(--text-secondary)]">
                使用 ssh-agent，不需要额外配置
              </div>
            ) : draft.authType === "password" ? (
              <PasswordInput
                ariaLabel="跳板机密码"
                onChange={(value) => updateDraft({ credentialSecret: value })}
                placeholder="SSH 密码"
                value={draft.credentialSecret ?? ""}
              />
            ) : (
              <input
                aria-label="跳板机私钥路径"
                className={inputClassName}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  updateDraft({ credentialRef: value });
                }}
                placeholder={
                  "~/.ssh/id_ed25519"
                }
                value={draft.credentialRef ?? ""}
              />
            )}
          </div>
          {draft.authType !== "agent" ? (
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {draft.authType === "password"
                ? "跳板机密码保存在凭据保险箱中。"
                : "跳板机密钥认证使用本机可访问的私钥路径。"}
            </p>
          ) : null}
        </FieldRow>
        <div className="flex justify-end">
          <Button onClick={addJumpHost} type="button" variant="secondary">
            <Plus className="h-4 w-4" />
            添加跳板机
          </Button>
        </div>
        {draftError ? (
          <p className="rounded-[var(--radius-control)] border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] leading-5 text-red-600 dark:text-red-300">
            {draftError}
          </p>
        ) : null}
      </div>
      {options.jumpHosts.length === 0 ? (
        <EmptyConfigState
          icon={<Network className="h-5 w-5" />}
          text="暂无跳板机。按列表顺序跳转。"
        />
      ) : (
        <ConfigList>
          {options.jumpHosts.map((jumpHost, index) => (
            <ConfigListItem
              key={`${jumpHost.host}-${jumpHost.port}-${index}`}
              actions={
                <ListReorderActions
                  canMoveDown={index < options.jumpHosts.length - 1}
                  canMoveUp={index > 0}
                  onDelete={() =>
                    setOptions((current) => ({
                      ...current,
                      jumpHosts: removeAt(current.jumpHosts, index),
                    }))
                  }
                  onMoveDown={() =>
                    setOptions((current) => ({
                      ...current,
                      jumpHosts: moveAt(current.jumpHosts, index, index + 1),
                    }))
                  }
                  onMoveUp={() =>
                    setOptions((current) => ({
                      ...current,
                      jumpHosts: moveAt(current.jumpHosts, index, index - 1),
                    }))
                  }
                />
              }
              meta={`${jumpHost.username}@${jumpHost.host}:${jumpHost.port} · ${jumpHost.authType}`}
              title={jumpHost.name || jumpHost.host}
            />
          ))}
        </ConfigList>
      )}
    </div>
  );
}


export function jumpHostDraftFromMachine(machine: Machine): SshJumpHostOptions {
  const authType = machine.authType ?? "agent";
  return {
    authType,
    credentialRef: authType === "key" ? trimOptional(machine.credentialRef) : undefined,
    credentialSecret:
      authType === "agent" ? undefined : trimOptional(machine.credentialSecret),
    host: trimText(machine.host),
    name: machine.name,
    port: machine.port ?? 22,
    username: trimText(machine.username),
  };
}
