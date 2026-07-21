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
  const preparation = handlers.get(tabId)?.() ?? { canClose: false };
  if (preparation.cleanup) {
    // cleanup 由 owner 在 handler 内启动；关闭流程只消费同步确认，不能被远端取消/轮询拖住。
    void preparation.cleanup.catch(() => undefined);
  }
  return { canClose: preparation.canClose };
}
