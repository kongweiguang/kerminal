// @author kongweiguang

import { useSyncExternalStore } from "react";
import type { SshHostKeyInspection } from "../../lib/sshHostKeyApi";

export interface SshHostKeyPromptOptions {
  inspection: SshHostKeyInspection;
  ownerId?: string;
}

interface SshHostKeyPromptQueueItem {
  id: string;
  options: SshHostKeyPromptOptions;
}

interface InternalSshHostKeyPromptQueueItem extends SshHostKeyPromptQueueItem {
  reject: (error: Error) => void;
  resolve: (inspection: SshHostKeyInspection | null) => void;
}

type SshHostKeyPromptSnapshot = {
  id: string;
  options: SshHostKeyPromptOptions;
} | null;

export interface SshHostKeyPromptStore {
  cancel(id: string): void;
  cancelForOwner(ownerId: string): void;
  complete(id: string, inspection: SshHostKeyInspection): void;
  fail(id: string, error: Error): void;
  getCurrent(): SshHostKeyPromptSnapshot;
  request(
    options: SshHostKeyPromptOptions,
  ): Promise<SshHostKeyInspection | null>;
  subscribe(listener: () => void): () => void;
}

/**
 * 创建串行的主机身份确认队列；队列项保存完整 inspection，避免并发 pane 的 host、port、fingerprint
 * 在同一个弹层里互相覆盖。ownerId 只用于调用方关闭时精确撤销自己的未完成请求。
 */
export function createSshHostKeyPromptStore(): SshHostKeyPromptStore {
  const listeners = new Set<() => void>();
  const queue: InternalSshHostKeyPromptQueueItem[] = [];
  let sequence = 0;
  let currentSnapshot: SshHostKeyPromptSnapshot = null;

  /** 更新缓存快照后通知消费者，保证 useSyncExternalStore 不会读到不稳定对象。 */
  const emitChange = () => {
    const item = queue[0];
    currentSnapshot = item
      ? { id: item.id, options: item.options }
      : null;
    for (const listener of listeners) {
      listener();
    }
  };

  /** 按稳定 id 移除一项并先通知 UI，再由调用方完成对应 Promise。 */
  const shift = (id: string) => {
    const index = queue.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }
    const [item] = queue.splice(index, 1);
    emitChange();
    return item;
  };

  return {
    /** 取消指定确认项并以 null 结束等待者，适用于用户主动取消。 */
    cancel(id) {
      shift(id)?.resolve(null);
    },
    /** 按 owner 精确撤销所有未完成项，防止 pane 关闭后继续恢复连接。 */
    cancelForOwner(ownerId) {
      for (const item of [...queue]) {
        if (item.options.ownerId === ownerId) {
          shift(item.id)?.resolve(null);
        }
      }
    },
    /** 接受后端二次核验结果并完成对应等待者，过期 id 会被安全忽略。 */
    complete(id, inspection) {
      shift(id)?.resolve(inspection);
    },
    /** 以异常结束指定确认项，让 changed/mismatch 能回到连接错误链。 */
    fail(id, error) {
      const item = shift(id);
      if (!item) {
        return;
      }
      // 失败走拒绝而不是 null，调用方才能把确认期 key 变化展示为阻断错误。
      item.reject(error);
    },
    /** 返回队列首项的缓存快照，避免渲染期间因对象身份变化触发循环读取。 */
    getCurrent() {
      return currentSnapshot;
    },
    /** 入队一次确认请求并立即发布首项变化，避免订阅建立前丢失首个请求。 */
    request(options) {
      const id = `ssh-host-key-prompt-${++sequence}`;
      return new Promise((resolve, reject) => {
        queue.push({ id, options, reject, resolve });
        emitChange();
      });
    },
    /** 注册队列变化监听器；返回幂等取消函数供 React 外部 store 清理。 */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 应用运行时共享的 SSH 主机身份确认队列。 */
const sshHostKeyPromptStore = createSshHostKeyPromptStore();

/** 将一次主机身份确认请求交给全局弹层，并等待用户决定。 */
export function requestSshHostKeyTrust(options: SshHostKeyPromptOptions) {
  return sshHostKeyPromptStore.request(options);
}

/** 关闭 pane 或 session generation 时撤销该 owner 尚未展示或正在展示的确认。 */
export function cancelSshHostKeyPromptsForOwner(ownerId: string) {
  sshHostKeyPromptStore.cancelForOwner(ownerId);
}

/** 取消全局队列中的指定确认项，供弹层取消按钮使用。 */
export function cancelSshHostKeyPrompt(id: string) {
  sshHostKeyPromptStore.cancel(id);
}

/** 完成一次经过后端二次核验的主机身份确认。 */
export function completeSshHostKeyPrompt(
  id: string,
  inspection: SshHostKeyInspection,
) {
  sshHostKeyPromptStore.complete(id, inspection);
}

/** 将确认期后端错误传回等待中的连接恢复流程。 */
export function failSshHostKeyPrompt(id: string, error: Error) {
  sshHostKeyPromptStore.fail(id, error);
}

/** 订阅当前弹层使用的队列首项，避免 effect 订阅窗口错过刚入队的确认请求。 */
export function useCurrentSshHostKeyPrompt(store = sshHostKeyPromptStore) {
  return useSyncExternalStore(
    store.subscribe,
    store.getCurrent,
    store.getCurrent,
  );
}
