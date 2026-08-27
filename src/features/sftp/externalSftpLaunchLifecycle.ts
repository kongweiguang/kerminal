/**
 * 外部 SFTP 工作台关闭协调器；资源 owner 仍由实际工作台组件持有。
 *
 * @author kongweiguang
 */

export interface ExternalSftpTabClosePreparation {
  canClose: boolean;
  cleanup?: Promise<void>;
}

type ExternalSftpTabCloseHandler = () => ExternalSftpTabClosePreparation;

const handlers = new Map<string, ExternalSftpTabCloseHandler>();

export function registerExternalSftpTabCloseHandler(
  tabId: string,
  handler: ExternalSftpTabCloseHandler,
) {
  handlers.set(tabId, handler);
  return () => {
    if (handlers.get(tabId) === handler) {
      handlers.delete(tabId);
    }
  };
}

export function prepareExternalSftpTabClose(
  tabId: string,
): ExternalSftpTabClosePreparation {
  // cleanup 必须交还批量关闭协调器等待；只有成功项才能进入 store、Agent 与
  // external owner 的后续清理，避免远端取消失败后 UI 仍错误移除对应 Tab。
  return handlers.get(tabId)?.() ?? { canClose: false };
}
