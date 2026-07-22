// @author kongweiguang

import { FolderOpen } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { selectLocalFile } from "../../../lib/fileDialogApi";
import type { RemoteHostAuthType } from "../../../lib/remoteHostApi";
import { authOptions } from "./model";
import { FieldRow, GroupSelectRow, inputClassName } from "./shared-ui";

export function SshPropertiesPanel({
  authType,
  credentialRef,
  credentialSecret,
  groupId,
  groupOptions,
  host,
  name,
  onCreateGroupClick,
  port,
  production,
  setAuthType,
  setCredentialRef,
  setCredentialSecret,
  setError,
  setGroupId,
  setHost,
  setName,
  setPort,
  setProduction,
  setTags,
  setUsername,
  tags,
  username,
}: {
  authType: RemoteHostAuthType;
  credentialRef: string;
  credentialSecret: string;
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  host: string;
  name: string;
  onCreateGroupClick?: () => void;
  port: string;
  production: boolean;
  setAuthType: (value: RemoteHostAuthType) => void;
  setCredentialRef: (value: string) => void;
  setCredentialSecret: (value: string) => void;
  setError: (value: string | null) => void;
  setGroupId: (value: string) => void;
  setHost: (value: string) => void;
  setName: (value: string) => void;
  setPort: (value: string) => void;
  setProduction: (value: boolean) => void;
  setTags: (value: string) => void;
  setUsername: (value: string) => void;
  tags: string;
  username: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <FieldRow label="名称">
          <input
            aria-label="名称"
            autoFocus
            className={inputClassName}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="例如：ubuntu-dev"
            value={name}
          />
        </FieldRow>
        <GroupSelectRow
          groupId={groupId}
          groupOptions={groupOptions}
          onCreateGroupClick={onCreateGroupClick}
          setGroupId={setGroupId}
        />
        <FieldRow label="主机">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
            <input
              aria-label="主机"
              className={inputClassName}
              onChange={(event) => setHost(event.currentTarget.value)}
              placeholder="dev.internal 或 server.example.com"
              value={host}
            />
            <input
              aria-label="端口"
              className={inputClassName}
              inputMode="numeric"
              onChange={(event) => setPort(event.currentTarget.value)}
              value={port}
            />
          </div>
        </FieldRow>
        <FieldRow label="用户名">
          <input
            aria-label="用户名"
            className={inputClassName}
            onChange={(event) => setUsername(event.currentTarget.value)}
            placeholder="root"
            value={username}
          />
        </FieldRow>
        <FieldRow label="认证">
          <SshAuthFields
            authType={authType}
            credentialRef={credentialRef}
            credentialSecret={credentialSecret}
            setAuthType={setAuthType}
            setCredentialRef={setCredentialRef}
            setCredentialSecret={setCredentialSecret}
            setError={setError}
          />
        </FieldRow>
        <FieldRow label="标签">
          <input
            aria-label="标签"
            className={inputClassName}
            onChange={(event) => setTags(event.currentTarget.value)}
            placeholder="dev, ubuntu, staging"
            value={tags}
          />
        </FieldRow>
        <FieldRow label="环境">
          <div className="kerminal-field-surface flex min-h-9 items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-1.5 text-[13px] text-[var(--text-secondary)]">
            <span>生产或安全敏感主机</span>
            <Switch
              aria-label="生产主机"
              checked={production}
              onCheckedChange={setProduction}
            />
          </div>
        </FieldRow>
      </div>
    </div>
  );
}

function SshAuthFields({
  authType,
  credentialRef,
  credentialSecret,
  setAuthType,
  setCredentialRef,
  setCredentialSecret,
  setError,
}: {
  authType: RemoteHostAuthType;
  credentialRef: string;
  credentialSecret: string;
  setAuthType: (value: RemoteHostAuthType) => void;
  setCredentialRef: (value: string) => void;
  setCredentialSecret: (value: string) => void;
  setError: (value: string | null) => void;
}) {
  const choosePrivateKeyFile = async () => {
    try {
      const selected = await selectLocalFile();
      if (!selected) {
        return;
      }
      setError(null);
      setCredentialRef(selected);
      setCredentialSecret("");
    } catch (caught) {
      console.warn("Failed to select an SSH private key file", caught);
      setError("无法选择私钥文件，请重试。");
    }
  };

  return (
    <div className="grid gap-3">
      <Select
        aria-label="认证方式"
        buttonClassName="h-9"
        onValueChange={(value) => {
          const nextAuthType = value as RemoteHostAuthType;
          if (nextAuthType === authType) {
            return;
          }
          setAuthType(nextAuthType);
          setCredentialRef("");
          setCredentialSecret("");
        }}
        options={authOptions}
        value={authType}
      />
      {authType === "agent" ? (
        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          使用系统 ssh-agent，不保存额外凭据。
        </p>
      ) : (
        <>
          {authType === "password" ? (
            <div className="grid gap-2">
              <input
                aria-label="SSH 密码"
                autoComplete="off"
                className={inputClassName}
                onChange={(event) =>
                  setCredentialSecret(event.currentTarget.value)
                }
                placeholder="输入 SSH 密码"
                type="text"
                value={credentialSecret}
              />
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                密码保存在凭据保险箱中，编辑时可回显。
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_36px]">
                <input
                  aria-label="私钥路径"
                  className={inputClassName}
                  onChange={(event) =>
                    setCredentialRef(event.currentTarget.value)
                  }
                  placeholder="~/.ssh/id_ed25519"
                  value={credentialRef}
                />
                <Button
                  aria-label="Choose private key file"
                  className="h-9 w-9 px-0"
                  onClick={() => void choosePrivateKeyFile()}
                  title="Choose private key file"
                  type="button"
                  variant="secondary"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <textarea
                aria-label="私钥内容"
                className={`${inputClassName} min-h-[140px] resize-none py-2 font-mono text-xs`}
                onChange={(event) =>
                  setCredentialSecret(event.currentTarget.value)
                }
                placeholder="也可粘贴 OpenSSH 私钥内容"
                spellCheck={false}
                value={credentialSecret}
              />
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                私钥路径和内容二选一；粘贴内容保存在凭据保险箱中。
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
