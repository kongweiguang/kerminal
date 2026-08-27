//! Workspace session file-backed Tauri Commands。
//!
//! @author kongweiguang

use std::{fs, io::ErrorKind, path::Path};

use serde_json::{json, Value};
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
    storage::file_store::{FileStore, FileStoreError},
};

const WORKSPACE_SESSION_RELATIVE_PATH: &str = "workspace/session.json";
const WORKSPACE_SESSION_PRE_V3_RELATIVE_PATH: &str = "workspace/session.pre-v3.json";
const WORKSPACE_SESSION_VERSION: u64 = 3;

#[derive(Debug, PartialEq, Eq)]
enum ExistingWorkspaceSession {
    Missing,
    Legacy(Vec<u8>),
    Current,
    Unsupported,
    Invalid,
}

#[tauri::command]
/// 读取 workspace session；损坏根内容返回不可解码标记，让前端立即阻断本次自动保存。
pub fn workspace_session_load(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    load_workspace_session(state.paths().root.as_path()).map_err(|error| error.to_string())
}

#[tauri::command]
/// 只写入当前 v3 session，并在原子替换前保护旧版、未来版和损坏原文。
pub fn workspace_session_save(state: State<'_, AppState>, session: Value) -> Result<(), String> {
    save_workspace_session(state.paths().root.as_path(), session).map_err(|error| error.to_string())
}

fn load_workspace_session(root: &Path) -> AppResult<Option<Value>> {
    let store = FileStore::new(root);
    let path = store
        .path_for(WORKSPACE_SESSION_RELATIVE_PATH)
        .map_err(file_store_error)?;
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::Io(error)),
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(Some(invalid_workspace_session_load_marker())),
    };
    if value.is_object() {
        Ok(Some(value))
    } else {
        Ok(Some(invalid_workspace_session_load_marker()))
    }
}

/// 使用缺少 schema 必需字段的内部对象表示磁盘内容损坏，避免与真正 missing 混淆。
fn invalid_workspace_session_load_marker() -> Value {
    json!({ "__kerminalInvalidWorkspaceSession": true })
}

fn save_workspace_session(root: &Path, session: Value) -> AppResult<()> {
    if !session.is_object() {
        return Err(AppError::InvalidInput(
            "workspace session 必须是 JSON object".to_owned(),
        ));
    }
    if !is_v3_session(&session) {
        return Err(AppError::InvalidInput(
            "workspace session 只接受 v3 payload".to_owned(),
        ));
    }
    let store = FileStore::new(root);
    // 在每次覆盖前重新检查磁盘上的原文；load 将损坏内容当作 missing 时，
    // 这里仍必须拒绝覆盖，避免一次启动就把用户唯一的恢复线索抹掉。
    match inspect_existing_workspace_session(&store)? {
        ExistingWorkspaceSession::Missing | ExistingWorkspaceSession::Current => {}
        ExistingWorkspaceSession::Legacy(original) => {
            // 只有第一次升级旧 session 时保存原文，备份失败会在 atomic_write 前返回。
            backup_pre_v3_session_once(&store, &original)?;
        }
        ExistingWorkspaceSession::Unsupported => {
            return Err(AppError::InvalidInput(
                "workspace session 版本较新，拒绝覆盖".to_owned(),
            ));
        }
        ExistingWorkspaceSession::Invalid => {
            return Err(AppError::InvalidInput(
                "workspace session 原文件无效，拒绝覆盖".to_owned(),
            ));
        }
    }
    let mut bytes = serde_json::to_vec_pretty(&session)?;
    bytes.push(b'\n');
    store
        .atomic_write(WORKSPACE_SESSION_RELATIVE_PATH, &bytes)
        .map(|_| ())
        .map_err(file_store_error)
}

/** 判断前端是否正在提交严格 v3 session；未来版本不能借保存路径降级覆盖。 */
fn is_v3_session(session: &Value) -> bool {
    session
        .get("version")
        .and_then(Value::as_u64)
        .is_some_and(|version| version == WORKSPACE_SESSION_VERSION)
}

/**
 * 读取并分类当前 session 原文；分类失败采用 Invalid，调用方随后禁止覆盖原文件。
 * 读取原始 bytes 是为了让升级备份保留用户实际文件（包括换行和未知字段）。
 */
fn inspect_existing_workspace_session(store: &FileStore) -> AppResult<ExistingWorkspaceSession> {
    let session_path = store
        .path_for(WORKSPACE_SESSION_RELATIVE_PATH)
        .map_err(file_store_error)?;
    let original = match fs::read(session_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(ExistingWorkspaceSession::Missing)
        }
        Err(error) => return Err(AppError::Io(error)),
    };
    let value = match serde_json::from_slice::<Value>(&original) {
        Ok(value) => value,
        Err(_) => return Ok(ExistingWorkspaceSession::Invalid),
    };
    let Some(object) = value.as_object() else {
        return Ok(ExistingWorkspaceSession::Invalid);
    };
    let Some(raw_version) = object.get("version") else {
        return Ok(ExistingWorkspaceSession::Legacy(original));
    };
    let Some(version) = raw_version.as_u64() else {
        return Ok(ExistingWorkspaceSession::Invalid);
    };
    match version {
        1 | 2 => Ok(ExistingWorkspaceSession::Legacy(original)),
        WORKSPACE_SESSION_VERSION => Ok(ExistingWorkspaceSession::Current),
        version if version > WORKSPACE_SESSION_VERSION => Ok(ExistingWorkspaceSession::Unsupported),
        _ => Ok(ExistingWorkspaceSession::Invalid),
    }
}

/** 一次性保留 v1/v2/无版本原文；已存在备份时保持用户最初可恢复快照不被覆盖。 */
fn backup_pre_v3_session_once(store: &FileStore, original: &[u8]) -> AppResult<()> {
    let backup_path = store
        .path_for(WORKSPACE_SESSION_PRE_V3_RELATIVE_PATH)
        .map_err(file_store_error)?;
    if backup_path.is_file() {
        return Ok(());
    }
    store
        .atomic_write(WORKSPACE_SESSION_PRE_V3_RELATIVE_PATH, original)
        .map(|_| ())
        .map_err(file_store_error)
}

fn file_store_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}
