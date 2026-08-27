// @author kongweiguang

import { Pencil } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import type { TerminalTab } from "../workspace/contracts/index";

/** 批量关闭确认始终只提交一次，由上层关闭协调器统一清理外部 owner。 */
export function CloseTabsConfirmationDialog({
  onClose,
  onConfirm,
  tabCount,
}: {
  onClose: () => void;
  onConfirm: () => void;
  tabCount: number;
}) {
  return (
    <ModalShell
      backdrop="solid"
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">取消</Button>
          <Button onClick={onConfirm} type="button" variant="danger">关闭标签</Button>
        </>
      }
      description={`将关闭 ${tabCount} 个终端标签。`}
      onClose={onClose}
      open={tabCount > 0}
      size="compact"
      title="确认关闭标签"
    >
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-100">
        当前标签内的会话会结束。
      </div>
    </ModalShell>
  );
}

/** 脏文件关闭确认与终端确认分离，避免未保存编辑被普通终端提示掩盖。 */
export function CloseWorkspaceFileTabsConfirmationDialog({
  dirtyTabCount,
  onClose,
  onConfirm,
  tabCount,
}: {
  dirtyTabCount: number;
  onClose: () => void;
  onConfirm: () => void;
  tabCount: number;
}) {
  return (
    <ModalShell
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">取消</Button>
          <Button onClick={onConfirm} type="button" variant="danger">放弃修改并关闭</Button>
        </>
      }
      description={`将关闭 ${tabCount} 个标签，其中 ${dirtyTabCount} 个文件有未保存修改。`}
      onClose={onClose}
      open={tabCount > 0}
      size="compact"
      title="关闭未保存文件"
    >
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-100">
        未保存的文件修改会丢失。
      </div>
    </ModalShell>
  );
}

/** 重命名在弹框内拒绝空白标题，关闭前只提交 trim 后的真实变化。 */
export function TerminalTabRenameDialog({
  onClose,
  onRenameTab,
  tab,
}: {
  onClose: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  tab: TerminalTab | null;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tab) return;
    setTitle(tab.title);
    setError(null);
  }, [tab]);

  /** 只提交非空且变化后的标题，错误留在当前 Dialog。 */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tab) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("请输入标签名称。");
      return;
    }
    if (trimmedTitle !== tab.title) onRenameTab(tab.id, trimmedTitle);
    onClose();
  };

  return (
    <ModalShell onClose={onClose} open={Boolean(tab)} size="compact" title="重命名标签">
      <form className="space-y-4" onSubmit={submit}>
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Pencil className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            标签信息
          </div>
          <label className="mt-4 block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">标签名称</span>
            <input
              autoFocus
              className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm"
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setError(null);
              }}
              placeholder="例如：生产日志"
              value={title}
            />
          </label>
          {error ? (
            <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">取消</Button>
          <Button disabled={!title.trim()} type="submit" variant="primary">保存标签</Button>
        </div>
      </form>
    </ModalShell>
  );
}
