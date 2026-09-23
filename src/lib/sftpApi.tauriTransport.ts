/** @author kongweiguang */

import { invoke } from "@tauri-apps/api/core";
import type {
  SftpArchiveDownloadRequest,
  SftpArchiveUploadRequest,
  SftpChmodRequest,
  SftpClassifyLocalPathsRequest,
  SftpClipboardDownloadRequest,
  SftpDeleteRequest,
  SftpDirectoryListing,
  SftpFilePreview,
  SftpHostKeyTrustSummary,
  SftpListDirectoryRequest,
  SftpLocalPathInfo,
  SftpManagedTransferRequest,
  SftpPathRequest,
  SftpPathStat,
  SftpPreviewRequest,
  SftpReadTextFileRequest,
  SftpReadTextFileResponse,
  SftpRemoteCopyRequest,
  SftpRenameRequest,
  SftpTransferCancelRequest,
  SftpTransferRequest,
  SftpTransferRetryRequest,
  SftpTransferScopeRequest,
  SftpTransferSummary,
  SftpTrustHostKeyRequest,
  SftpWriteTextFileRequest,
  SftpWriteTextFileResponse,
} from "./sftpApiTypes";

export function tauriListSftpDirectory(
  request: SftpListDirectoryRequest,
): Promise<SftpDirectoryListing> {
  return invoke<SftpDirectoryListing>("sftp_list_directory", { request });
}

export function tauriCreateSftpDirectory(
  request: SftpPathRequest,
): Promise<boolean> {
  return invoke<boolean>("sftp_create_directory", { request });
}

export function tauriDeleteSftpPath(
  request: SftpDeleteRequest,
): Promise<boolean> {
  return invoke<boolean>("sftp_delete", { request });
}

export function tauriRenameSftpPath(
  request: SftpRenameRequest,
): Promise<boolean> {
  return invoke<boolean>("sftp_rename", { request });
}

export function tauriPreviewSftpFile(
  request: SftpPreviewRequest,
): Promise<SftpFilePreview> {
  return invoke<SftpFilePreview>("sftp_preview_file", { request });
}

export function tauriReadSftpTextFile(
  request: SftpReadTextFileRequest,
): Promise<SftpReadTextFileResponse> {
  return invoke<SftpReadTextFileResponse>("sftp_read_text_file", { request });
}

export function tauriWriteSftpTextFile(
  request: SftpWriteTextFileRequest,
): Promise<SftpWriteTextFileResponse> {
  return invoke<SftpWriteTextFileResponse>("sftp_write_text_file", { request });
}

export function tauriStatSftpPath(
  request: SftpPathRequest,
): Promise<SftpPathStat> {
  return invoke<SftpPathStat>("sftp_stat_path", { request });
}

export function tauriChmodSftpPath(
  request: SftpChmodRequest,
): Promise<boolean> {
  return invoke<boolean>("sftp_chmod", { request });
}

export function tauriUploadSftpFile(
  request: SftpTransferRequest,
): Promise<boolean> {
  return invoke<boolean>("sftp_upload", { request });
}

export function tauriUploadSftpDirectory(
  request: SftpTransferRequest,
): Promise<boolean> {
  return invoke<boolean>("sftp_upload_directory", { request });
}

export function tauriDownloadSftpFile(
  request: SftpTransferRequest,
): Promise<boolean> {
  return invoke<boolean>("sftp_download", { request });
}

export function tauriDownloadSftpDirectory(
  request: SftpTransferRequest,
): Promise<boolean> {
  return invoke<boolean>("sftp_download_directory", { request });
}

export function tauriEnqueueSftpTransfer(
  request: SftpManagedTransferRequest,
): Promise<SftpTransferSummary> {
  return invoke<SftpTransferSummary>("sftp_enqueue_transfer", { request });
}

export function tauriEnqueueSftpRemoteCopy(
  request: SftpRemoteCopyRequest,
): Promise<SftpTransferSummary> {
  return invoke<SftpTransferSummary>("sftp_enqueue_remote_copy", { request });
}

export function tauriEnqueueSftpArchiveDownload(
  request: SftpArchiveDownloadRequest,
): Promise<SftpTransferSummary> {
  return invoke<SftpTransferSummary>("sftp_enqueue_archive_download", {
    request,
  });
}

export function tauriEnqueueSftpArchiveUpload(
  request: SftpArchiveUploadRequest,
): Promise<SftpTransferSummary> {
  return invoke<SftpTransferSummary>("sftp_enqueue_archive_upload", {
    request,
  });
}

export function tauriEnqueueSftpClipboardDownload(
  request: SftpClipboardDownloadRequest,
): Promise<SftpTransferSummary> {
  return invoke<SftpTransferSummary>("sftp_enqueue_clipboard_download", {
    request,
  });
}

export function tauriListSftpTransfers(
  request?: SftpTransferScopeRequest,
): Promise<SftpTransferSummary[]> {
  return request === undefined
    ? invoke<SftpTransferSummary[]>("sftp_list_transfers")
    : invoke<SftpTransferSummary[]>("sftp_list_transfers", { request });
}

export function tauriCancelSftpTransfer(
  request: SftpTransferCancelRequest,
): Promise<SftpTransferSummary> {
  return invoke<SftpTransferSummary>("sftp_cancel_transfer", { request });
}

/**
 * 只把旧任务 ID 交给后端恢复，避免前端重建路径参数导致断点、重命名结果或幂等键丢失。
 *
 * @author kongweiguang
 */
export function tauriRetrySftpTransfer(
  request: SftpTransferRetryRequest,
): Promise<SftpTransferSummary> {
  return invoke<SftpTransferSummary>("sftp_retry_transfer", { ...request });
}

export function tauriClearCompletedSftpTransfers(
  request?: SftpTransferScopeRequest,
): Promise<
  SftpTransferSummary[]
> {
  return request === undefined
    ? invoke<SftpTransferSummary[]>("sftp_clear_completed_transfers")
    : invoke<SftpTransferSummary[]>("sftp_clear_completed_transfers", {
        request,
      });
}

export function tauriClassifySftpLocalPaths(
  request: SftpClassifyLocalPathsRequest,
): Promise<SftpLocalPathInfo[]> {
  return invoke<SftpLocalPathInfo[]>("sftp_classify_local_paths", { request });
}

export function tauriReadSftpLocalFileClipboard(): Promise<
  SftpLocalPathInfo[]
> {
  return invoke<SftpLocalPathInfo[]>("sftp_read_local_file_clipboard");
}

export function tauriTrustSftpHostKey(
  request: SftpTrustHostKeyRequest,
): Promise<SftpHostKeyTrustSummary> {
  return invoke<SftpHostKeyTrustSummary>("sftp_trust_host_key", { request });
}
