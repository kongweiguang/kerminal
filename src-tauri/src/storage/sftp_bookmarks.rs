//! SFTP 路径书签的版本化文件存储。
//!
//! @author kongweiguang

use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::ErrorKind,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::sftp_bookmark::{
        normalize_sftp_bookmark_path, SftpBookmark, SftpBookmarkListRequest,
        SftpBookmarkSetRequest, SftpBookmarkTarget, SFTP_BOOKMARK_LIMIT_PER_TARGET,
    },
    storage::{
        durable_file_transaction::DurableFileTransaction,
        file_store::{FileStore, FileStoreError},
        RuntimeFileStore,
    },
};

const SFTP_BOOKMARK_FILE: &str = "data/sftp-bookmarks.json";
const SFTP_BOOKMARK_FILE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct SftpBookmarkDocument {
    bookmarks: Vec<SftpBookmarkRecord>,
    schema_version: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct SftpBookmarkRecord {
    created_at_unix_ms: i64,
    path: String,
    target: SftpBookmarkTarget,
}

impl RuntimeFileStore {
    /// 返回指定 SSH 主机或容器目标的书签，按最近收藏优先排序。
    pub fn list_sftp_bookmarks(
        &self,
        request: SftpBookmarkListRequest,
    ) -> AppResult<Vec<SftpBookmark>> {
        let target = SftpBookmarkTarget::from_remote_target(&request.target)?;
        self.with_file_io(|root| {
            let document = read_document(root)?;
            Ok(bookmarks_for_target(&document, &target))
        })
    }

    /// 原子设置指定路径的收藏状态；重复操作保持幂等。
    pub fn set_sftp_bookmark(
        &self,
        request: SftpBookmarkSetRequest,
    ) -> AppResult<Vec<SftpBookmark>> {
        let target = SftpBookmarkTarget::from_remote_target(&request.target)?;
        let path = normalize_sftp_bookmark_path(&request.path)?;
        self.with_file_io(|root| {
            let store = FileStore::new(root);
            let change_set_id = format!("sftp-bookmarks-{}", Uuid::new_v4());
            let timestamp = transaction_timestamp();
            store.run_transaction_with(
                &change_set_id,
                &timestamp,
                |transaction| {
                    let mut document = read_document_transaction(transaction)?;
                    let changed =
                        update_bookmark(&mut document, &target, &path, request.bookmarked)?;
                    let bookmarks = bookmarks_for_target(&document, &target);
                    if changed {
                        let mut encoded = serde_json::to_vec_pretty(&document)
                            .map_err(|_| AppError::Sftp("无法保存 SFTP 路径书签".to_owned()))?;
                        encoded.push(b'\n');
                        transaction
                            .write(SFTP_BOOKMARK_FILE, encoded)
                            .map_err(file_store_error)?;
                    }
                    Ok(bookmarks)
                },
                file_store_error,
            )
        })
    }
}

fn read_document(root: &Path) -> AppResult<SftpBookmarkDocument> {
    let store = FileStore::new(root);
    store
        .recover_pending_transactions()
        .map_err(file_store_error)?;
    let path = store
        .path_for(SFTP_BOOKMARK_FILE)
        .map_err(file_store_error)?;
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(empty_document()),
        Err(error) => return Err(AppError::Io(error)),
    };
    decode_document(&raw)
}

fn read_document_transaction(
    transaction: &mut DurableFileTransaction<'_>,
) -> AppResult<SftpBookmarkDocument> {
    let raw = match transaction.read_to_string(SFTP_BOOKMARK_FILE) {
        Ok(raw) => raw,
        Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => {
            return Ok(empty_document());
        }
        Err(error) => return Err(file_store_error(error)),
    };
    decode_document(&raw)
}

fn decode_document(raw: &str) -> AppResult<SftpBookmarkDocument> {
    let document = serde_json::from_str::<SftpBookmarkDocument>(raw)
        .map_err(|_| AppError::Sftp("SFTP 书签数据格式无效，未修改原文件".to_owned()))?;
    validate_document(&document)?;
    Ok(document)
}

fn validate_document(document: &SftpBookmarkDocument) -> AppResult<()> {
    if document.schema_version != SFTP_BOOKMARK_FILE_SCHEMA_VERSION {
        return Err(AppError::Sftp(
            "SFTP 书签数据版本不受当前应用支持，未修改原文件".to_owned(),
        ));
    }

    let mut per_target = BTreeMap::<SftpBookmarkTarget, usize>::new();
    let mut unique = HashSet::new();
    for record in &document.bookmarks {
        record
            .target
            .validate()
            .map_err(|_| AppError::Sftp("SFTP 书签数据格式无效，未修改原文件".to_owned()))?;
        if record.created_at_unix_ms < 0
            || normalize_sftp_bookmark_path(&record.path)
                .map_err(|_| AppError::Sftp("SFTP 书签数据格式无效，未修改原文件".to_owned()))?
                != record.path
        {
            return Err(AppError::Sftp(
                "SFTP 书签数据格式无效，未修改原文件".to_owned(),
            ));
        }
        let count = per_target.entry(record.target.clone()).or_default();
        *count += 1;
        if *count > SFTP_BOOKMARK_LIMIT_PER_TARGET
            || !unique.insert((record.target.clone(), record.path.clone()))
        {
            return Err(AppError::Sftp(
                "SFTP 书签数据格式无效，未修改原文件".to_owned(),
            ));
        }
    }
    Ok(())
}

fn update_bookmark(
    document: &mut SftpBookmarkDocument,
    target: &SftpBookmarkTarget,
    path: &str,
    bookmarked: bool,
) -> AppResult<bool> {
    let existing_index = document
        .bookmarks
        .iter()
        .position(|record| &record.target == target && record.path == path);
    if bookmarked {
        if existing_index.is_some() {
            return Ok(false);
        }
        let target_count = document
            .bookmarks
            .iter()
            .filter(|record| &record.target == target)
            .count();
        if target_count >= SFTP_BOOKMARK_LIMIT_PER_TARGET {
            return Err(AppError::InvalidInput(format!(
                "每个连接最多保存 {SFTP_BOOKMARK_LIMIT_PER_TARGET} 条 SFTP 路径书签"
            )));
        }
        document.bookmarks.push(SftpBookmarkRecord {
            created_at_unix_ms: current_unix_ms(),
            path: path.to_owned(),
            target: target.clone(),
        });
        sort_document(document);
        return Ok(true);
    }

    let Some(existing_index) = existing_index else {
        return Ok(false);
    };
    document.bookmarks.remove(existing_index);
    Ok(true)
}

fn bookmarks_for_target(
    document: &SftpBookmarkDocument,
    target: &SftpBookmarkTarget,
) -> Vec<SftpBookmark> {
    let mut bookmarks = document
        .bookmarks
        .iter()
        .filter(|record| &record.target == target)
        .map(|record| SftpBookmark {
            created_at_unix_ms: record.created_at_unix_ms,
            path: record.path.clone(),
        })
        .collect::<Vec<_>>();
    bookmarks.sort_by(|left, right| {
        right
            .created_at_unix_ms
            .cmp(&left.created_at_unix_ms)
            .then_with(|| left.path.cmp(&right.path))
    });
    bookmarks
}

fn empty_document() -> SftpBookmarkDocument {
    SftpBookmarkDocument {
        bookmarks: Vec::new(),
        schema_version: SFTP_BOOKMARK_FILE_SCHEMA_VERSION,
    }
}

fn sort_document(document: &mut SftpBookmarkDocument) {
    document.bookmarks.sort_by(|left, right| {
        left.target
            .cmp(&right.target)
            .then_with(|| right.created_at_unix_ms.cmp(&left.created_at_unix_ms))
            .then_with(|| left.path.cmp(&right.path))
    });
}

fn current_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn transaction_timestamp() -> String {
    format!("unix-ms:{}", current_unix_ms())
}

fn file_store_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        FileStoreError::Locked(_) => {
            AppError::Sftp("SFTP 书签正在被其它窗口更新，请稍后重试".to_owned())
        }
        _ => AppError::Sftp("SFTP 书签存储不可用，请稍后重试".to_owned()),
    }
}
