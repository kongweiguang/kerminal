//! SFTP 请求归一化、路径和传输端点建模。
//!
//! @author kongweiguang

use std::{
    fs::OpenOptions,
    io,
    path::{Path, PathBuf},
};

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::RemoteHost,
        sftp::{
            SftpArchiveDownloadRequest, SftpArchiveUploadRequest, SftpClassifyLocalPathsRequest,
            SftpClipboardDownloadRequest, SftpLocalPathInfo, SftpLocalPathKind,
            SftpManagedTransferRequest, SftpRemoteCopyRequest, SftpTransferDirection,
            SftpTransferEndpoint, SftpTransferKind, SftpTransferOperation,
        },
    },
};

use super::{
    backend::SftpEndpoint, DEFAULT_PREVIEW_BYTES, DEFAULT_TEXT_FILE_BYTES, MAX_PREVIEW_BYTES,
    MAX_TEXT_FILE_BYTES, MIN_PREVIEW_BYTES, MIN_TEXT_FILE_BYTES,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SystemFileClipboardSupport {
    NativeFileList,
    KerminalInternalOnly,
}

impl SystemFileClipboardSupport {
    pub(super) fn supports_native_file_list(self) -> bool {
        matches!(self, Self::NativeFileList)
    }
}

pub(super) fn normalize_managed_transfer_request(
    request: SftpManagedTransferRequest,
) -> AppResult<SftpManagedTransferRequest> {
    Ok(SftpManagedTransferRequest {
        host_id: request.host_id,
        remote_path: normalize_non_root_remote_path(&request.remote_path)?,
        local_path: validate_local_path(&request.local_path)?,
        direction: request.direction,
        kind: request.kind,
        conflict_policy: request.conflict_policy,
        view_scope: normalize_view_scope(request.view_scope)?,
        idle_timeout_seconds: request.idle_timeout_seconds,
    })
}

pub(super) fn normalize_remote_copy_request(
    request: SftpRemoteCopyRequest,
) -> AppResult<SftpRemoteCopyRequest> {
    let source_remote_path = normalize_non_root_remote_path(&request.source_remote_path)?;
    let target_remote_path = normalize_non_root_remote_path(&request.target_remote_path)?;
    if request.source_host_id == request.target_host_id && source_remote_path == target_remote_path
    {
        return Err(AppError::InvalidInput(
            "远程复制的源路径和目标路径不能相同".to_owned(),
        ));
    }
    Ok(SftpRemoteCopyRequest {
        source_host_id: request.source_host_id,
        source_remote_path,
        target_host_id: request.target_host_id,
        target_remote_path,
        kind: request.kind,
        conflict_policy: request.conflict_policy,
        view_scope: normalize_view_scope(request.view_scope)?,
        idle_timeout_seconds: request.idle_timeout_seconds,
    })
}

pub(super) fn normalize_archive_download_request(
    request: SftpArchiveDownloadRequest,
) -> AppResult<SftpArchiveDownloadRequest> {
    Ok(SftpArchiveDownloadRequest {
        host_id: request.host_id,
        source_remote_path: normalize_non_root_remote_path(&request.source_remote_path)?,
        target_local_path: validate_local_path(&request.target_local_path)?,
        kind: request.kind,
        conflict_policy: request.conflict_policy,
        view_scope: normalize_view_scope(request.view_scope)?,
    })
}

pub(super) fn normalize_archive_upload_request(
    request: SftpArchiveUploadRequest,
) -> AppResult<SftpArchiveUploadRequest> {
    Ok(SftpArchiveUploadRequest {
        host_id: request.host_id,
        source_local_path: validate_local_path(&request.source_local_path)?,
        target_remote_path: normalize_non_root_remote_path(&request.target_remote_path)?,
        kind: request.kind,
        conflict_policy: request.conflict_policy,
        view_scope: normalize_view_scope(request.view_scope)?,
    })
}

pub(super) fn normalize_clipboard_download_request(
    request: SftpClipboardDownloadRequest,
) -> AppResult<SftpClipboardDownloadRequest> {
    Ok(SftpClipboardDownloadRequest {
        host_id: request.host_id,
        source_remote_path: normalize_non_root_remote_path(&request.source_remote_path)?,
        kind: request.kind,
        view_scope: normalize_view_scope(request.view_scope)?,
    })
}

fn normalize_view_scope(view_scope: Option<String>) -> AppResult<Option<String>> {
    view_scope
        .map(|value| {
            validate_sftp_text("传输视图 scope", &value)?;
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_owned()))
            }
        })
        .transpose()
        .map(Option::flatten)
}

pub(super) fn normalize_remote_path(path: &str) -> AppResult<String> {
    validate_sftp_text("远程路径", path)?;
    let trimmed = path.trim();
    let mut normalized = if trimmed.is_empty() {
        "/".to_owned()
    } else {
        trimmed.replace('\\', "/")
    };
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    Ok(normalized)
}

pub(super) fn normalize_non_root_remote_path(path: &str) -> AppResult<String> {
    let normalized = normalize_remote_path(path)?;
    if normalized == "/" {
        return Err(AppError::InvalidInput(
            "不允许对远程根目录执行该操作".to_owned(),
        ));
    }
    Ok(normalized)
}

pub(super) fn validate_local_path(path: &str) -> AppResult<String> {
    validate_sftp_text("本地路径", path)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("本地路径不能为空".to_owned()));
    }
    Ok(normalize_local_path_text(trimmed))
}

fn normalize_local_path_text(path: &str) -> String {
    strip_windows_verbatim_prefix(path).unwrap_or_else(|| path.to_owned())
}

fn strip_windows_verbatim_prefix(path: &str) -> Option<String> {
    let path = path
        .strip_prefix("\\\\?\\")
        .or_else(|| path.strip_prefix("\\?\\"))
        .or_else(|| path.strip_prefix("\\\\.\\"))
        .or_else(|| path.strip_prefix("\\.\\"))?;

    Some(
        path.strip_prefix("UNC\\")
            .map(|rest| format!("\\\\{rest}"))
            .unwrap_or_else(|| path.to_owned()),
    )
}

pub(super) fn classify_local_paths(
    request: SftpClassifyLocalPathsRequest,
) -> AppResult<Vec<SftpLocalPathInfo>> {
    if request.paths.is_empty() {
        return Err(AppError::InvalidInput("请至少提供一个本地路径".to_owned()));
    }

    request
        .paths
        .into_iter()
        .map(|path| {
            let path = validate_local_path(&path)?;
            let metadata = std::fs::metadata(&path).map_err(|error| {
                AppError::InvalidInput(format!("无法读取本地路径 {path}: {error}"))
            })?;
            let kind = if metadata.is_file() {
                SftpLocalPathKind::File
            } else if metadata.is_dir() {
                SftpLocalPathKind::Directory
            } else {
                return Err(AppError::InvalidInput(format!(
                    "暂不支持该本地路径类型: {path}"
                )));
            };
            Ok(SftpLocalPathInfo { path, kind })
        })
        .collect()
}

#[cfg(windows)]
pub(super) fn read_local_file_clipboard() -> AppResult<Vec<SftpLocalPathInfo>> {
    use clipboard_win::{formats::FileList, get_clipboard, Format};

    if !FileList.is_format_avail() {
        return Ok(Vec::new());
    }

    let paths: Vec<PathBuf> = get_clipboard(FileList)
        .map_err(|error| AppError::Sftp(format!("读取系统文件剪贴板失败: {error}")))?;
    classify_clipboard_local_paths(paths)
}

#[cfg(not(windows))]
pub(super) fn read_local_file_clipboard() -> AppResult<Vec<SftpLocalPathInfo>> {
    Err(system_file_clipboard_unsupported_error("读取"))
}

pub(super) fn ensure_local_file_clipboard_supported() -> AppResult<()> {
    if system_file_clipboard_support().supports_native_file_list() {
        Ok(())
    } else {
        Err(system_file_clipboard_unsupported_error("写入"))
    }
}

#[cfg(windows)]
pub(super) fn write_local_file_clipboard(paths: &[PathBuf]) -> AppResult<()> {
    use clipboard_win::{formats::FileList, Setter};

    let path_strings = paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    FileList
        .write_clipboard(&path_strings)
        .map_err(|error| AppError::Sftp(format!("写入系统文件剪贴板失败: {error}")))
}

#[cfg(not(windows))]
pub(super) fn write_local_file_clipboard(_paths: &[PathBuf]) -> AppResult<()> {
    Err(system_file_clipboard_unsupported_error("写入"))
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn classify_clipboard_local_paths(
    paths: Vec<PathBuf>,
) -> AppResult<Vec<SftpLocalPathInfo>> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    classify_local_paths(SftpClassifyLocalPathsRequest {
        paths: paths
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
    })
}

pub(super) fn system_file_clipboard_support() -> SystemFileClipboardSupport {
    if cfg!(windows) {
        SystemFileClipboardSupport::NativeFileList
    } else {
        SystemFileClipboardSupport::KerminalInternalOnly
    }
}

fn system_file_clipboard_unsupported_error(action: &str) -> AppError {
    AppError::Sftp(format!(
        "当前平台暂不支持{action}系统文件剪贴板；请使用 Kerminal SFTP 内部复制/粘贴，或拖放本机文件。"
    ))
}

pub(super) fn validate_chmod_mode(mode: &str) -> AppResult<u32> {
    validate_sftp_text("权限模式", mode)?;
    let trimmed = mode.trim();
    if !matches!(trimmed.len(), 3 | 4) || !trimmed.chars().all(|ch| matches!(ch, '0'..='7')) {
        return Err(AppError::InvalidInput(
            "权限模式需要是 3 或 4 位八进制数字，例如 644 或 0755".to_owned(),
        ));
    }
    u32::from_str_radix(trimmed, 8)
        .map_err(|error| AppError::InvalidInput(format!("权限模式解析失败: {error}")))
}

pub(super) fn normalize_preview_bytes(max_bytes: Option<usize>) -> usize {
    max_bytes
        .unwrap_or(DEFAULT_PREVIEW_BYTES)
        .clamp(MIN_PREVIEW_BYTES, MAX_PREVIEW_BYTES)
}

pub(super) fn normalize_text_file_bytes(max_bytes: Option<usize>) -> usize {
    max_bytes
        .unwrap_or(DEFAULT_TEXT_FILE_BYTES)
        .clamp(MIN_TEXT_FILE_BYTES, MAX_TEXT_FILE_BYTES)
}

pub(super) fn validate_text_encoding(encoding: &str) -> AppResult<()> {
    match encoding {
        "utf-8" | "utf-8-lossy" => Ok(()),
        value => Err(AppError::InvalidInput(format!(
            "暂不支持的文本编码: {value}"
        ))),
    }
}

pub(super) fn validate_sftp_text(label: &str, value: &str) -> AppResult<()> {
    if value.contains('\0') || value.contains('\r') || value.contains('\n') {
        return Err(AppError::InvalidInput(format!(
            "{label}不能包含换行符或 NUL 字符"
        )));
    }
    Ok(())
}

pub(super) fn parent_remote_path(path: &str) -> Option<String> {
    if path == "/" {
        return None;
    }

    let trimmed = path.trim_end_matches('/');
    let (parent, _) = trimmed.rsplit_once('/')?;
    if parent.is_empty() {
        Some("/".to_owned())
    } else {
        Some(parent.to_owned())
    }
}

pub(super) fn join_remote_path(base_path: &str, name: &str) -> String {
    if base_path == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", base_path.trim_end_matches('/'), name)
    }
}

pub(super) fn is_remote_descendant_path(parent: &str, candidate: &str) -> bool {
    let parent = parent.trim_end_matches('/');
    let candidate = candidate.trim_end_matches('/');
    if parent.is_empty() || parent == "/" {
        return candidate != "/";
    }
    candidate
        .strip_prefix(parent)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

pub(super) fn remote_copy_source_label(request: &SftpRemoteCopyRequest) -> String {
    format!(
        "sftp://{}{}",
        request.source_host_id, request.source_remote_path
    )
}

pub(super) fn local_transfer_endpoint(path: String) -> SftpTransferEndpoint {
    SftpTransferEndpoint::Local { path }
}

pub(super) fn remote_transfer_endpoint(host: &RemoteHost, path: String) -> SftpTransferEndpoint {
    SftpTransferEndpoint::Remote {
        host_id: host.id.clone(),
        host_label: host.name.clone(),
        path,
    }
}

pub(super) fn managed_transfer_operation(
    direction: SftpTransferDirection,
) -> SftpTransferOperation {
    match direction {
        SftpTransferDirection::Upload => SftpTransferOperation::Upload,
        SftpTransferDirection::Download => SftpTransferOperation::Download,
    }
}

pub(super) fn managed_transfer_source(
    endpoint: &SftpEndpoint,
    request: &SftpManagedTransferRequest,
) -> SftpTransferEndpoint {
    match request.direction {
        SftpTransferDirection::Upload => local_transfer_endpoint(request.local_path.clone()),
        SftpTransferDirection::Download => {
            remote_transfer_endpoint(&endpoint.host, request.remote_path.clone())
        }
    }
}

pub(super) fn managed_transfer_target(
    endpoint: &SftpEndpoint,
    request: &SftpManagedTransferRequest,
) -> SftpTransferEndpoint {
    match request.direction {
        SftpTransferDirection::Upload => {
            remote_transfer_endpoint(&endpoint.host, request.remote_path.clone())
        }
        SftpTransferDirection::Download => local_transfer_endpoint(request.local_path.clone()),
    }
}

pub(super) fn remote_path_file_name(path: &str, kind: SftpTransferKind) -> String {
    let normalized = path.trim_end_matches('/');
    let fallback = match kind {
        SftpTransferKind::File => "remote-file",
        SftpTransferKind::Directory => "remote-directory",
    };
    normalized
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback)
        .to_owned()
}

pub(super) fn reserve_clipboard_download_target_path(
    request: &SftpClipboardDownloadRequest,
) -> AppResult<PathBuf> {
    let downloads_dir = system_downloads_dir()?;
    reserve_clipboard_download_target_path_in(&downloads_dir, request)
}

pub(super) fn reserve_clipboard_download_target_path_in(
    downloads_dir: &Path,
    request: &SftpClipboardDownloadRequest,
) -> AppResult<PathBuf> {
    let fallback = match request.kind {
        SftpTransferKind::File => "remote-file",
        SftpTransferKind::Directory => "remote-directory",
    };
    let raw_name = remote_path_file_name(&request.source_remote_path, request.kind);
    let file_name = safe_local_entry_name(&raw_name, fallback);
    reserve_unique_local_path(downloads_dir, &file_name, request.kind)
}

fn system_downloads_dir() -> AppResult<PathBuf> {
    dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
        .ok_or_else(|| AppError::Sftp("无法定位系统下载目录".to_owned()))
}

fn safe_local_entry_name(name: &str, fallback: &str) -> String {
    let candidate = name
        .trim()
        .trim_matches(|ch| matches!(ch, '/' | '\\'))
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                ch
            }
        })
        .collect::<String>();
    let candidate = candidate.trim().trim_matches('.').to_owned();
    if candidate.is_empty() || candidate == ".." {
        fallback.to_owned()
    } else {
        candidate
    }
}

fn reserve_unique_local_path(
    directory: &Path,
    file_name: &str,
    kind: SftpTransferKind,
) -> AppResult<PathBuf> {
    std::fs::create_dir_all(directory)?;

    let initial = directory.join(file_name);
    if reserve_local_path(&initial, kind)? {
        return Ok(initial);
    }

    let (stem, extension) = split_local_file_name(file_name);
    for index in 2..1000 {
        let candidate = directory.join(format!("{stem} ({index}){extension}"));
        if reserve_local_path(&candidate, kind)? {
            return Ok(candidate);
        }
    }

    let candidate = directory.join(format!("{stem}-{}{extension}", Uuid::new_v4()));
    reserve_local_path(&candidate, kind)?;
    Ok(candidate)
}

fn reserve_local_path(path: &Path, kind: SftpTransferKind) -> AppResult<bool> {
    let result = match kind {
        SftpTransferKind::File => OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map(|_| ()),
        SftpTransferKind::Directory => std::fs::create_dir(path),
    };

    match result {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(AppError::Io(error)),
    }
}

fn split_local_file_name(file_name: &str) -> (String, String) {
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(file_name)
        .to_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    (stem, extension)
}

pub(super) fn local_path_file_name(path: &Path, kind: SftpTransferKind) -> String {
    let fallback = match kind {
        SftpTransferKind::File => "local-file",
        SftpTransferKind::Directory => "local-directory",
    };
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback)
        .to_owned()
}

pub(super) fn initial_total_bytes(request: &SftpManagedTransferRequest) -> Option<u64> {
    if request.direction != SftpTransferDirection::Upload {
        return None;
    }

    let metadata = std::fs::metadata(&request.local_path).ok()?;
    if metadata.is_file() {
        return Some(metadata.len());
    }
    None
}
