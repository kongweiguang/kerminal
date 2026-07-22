//! File-backed storage primitives.
//!
//! @author kongweiguang

use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use thiserror::Error;

pub use crate::storage::file_lock::FileStoreLock;

use crate::storage::{
    atomic_file::{self, durable_copy},
    durable_file_transaction::{
        apply_changes_locked, recover_pending_locked, restore_change_set_locked,
        DurableFileTransaction,
    },
    file_lock,
    storage_manifest::{StorageManifest, STORAGE_MANIFEST_SCHEMA_VERSION},
};

const STORAGE_MANIFEST_RELATIVE_PATH: &str = "storage-manifest.toml";
const TRANSACTION_LOCK_WAIT: Duration = Duration::from_secs(5);
const TRANSACTION_LOCK_RETRY: Duration = Duration::from_millis(10);

#[derive(Debug, Error)]
pub enum FileStoreError {
    #[error("file store IO failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid file store path: {0}")]
    InvalidPath(String),

    #[error("TOML parse failed")]
    TomlParse(#[from] TomlParseError),

    #[error("TOML encode failed: {0}")]
    TomlEncode(String),

    #[error("file store lock is already held: {0}")]
    Locked(PathBuf),

    /// 锁文件缺字段、schema 不支持或 owner 身份无法验证；必须 fail-closed。
    #[error("file store lock metadata is invalid: {0}")]
    InvalidLock(PathBuf),

    /// journal 无法解析或内部路径/状态不满足事务不变量。
    #[error("transaction journal is invalid at {path}: {reason}")]
    TransactionJournal { path: PathBuf, reason: String },

    /// 启动恢复无法安全完成；调用方不得继续覆盖相关目标。
    #[error("transaction recovery failed for {id}: {reason}")]
    TransactionRecovery { id: String, reason: String },

    /// 中断期间目标被外部修改，自动恢复会保留外部内容并停止。
    #[error("transaction target changed after interruption: {0}")]
    TransactionConflict(PathBuf),

    #[error("file was changed externally: {0}")]
    RevisionConflict(PathBuf),
}

pub type FileStoreResult<T> = Result<T, FileStoreError>;

#[derive(Debug, Clone)]
pub struct FileStore {
    root: PathBuf,
}

impl FileStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn path_for(&self, relative_path: impl AsRef<Path>) -> FileStoreResult<PathBuf> {
        Ok(self
            .root
            .join(sanitize_relative_path(relative_path.as_ref())?))
    }

    pub fn read_toml<T: TomlDocument>(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> FileStoreResult<T> {
        let _lock = self.acquire_transaction_lock()?;
        recover_pending_locked(self)?;
        self.read_toml_locked(relative_path.as_ref())
    }

    pub fn write_toml<T: TomlDocument>(
        &self,
        relative_path: impl AsRef<Path>,
        value: &T,
    ) -> FileStoreResult<PathBuf> {
        let encoded = value.encode_toml()?;
        let _lock = self.acquire_transaction_lock()?;
        recover_pending_locked(self)?;
        self.atomic_write_locked(relative_path, encoded.as_bytes())
    }

    pub fn read_storage_manifest(&self) -> FileStoreResult<StorageManifest> {
        let _lock = self.acquire_transaction_lock()?;
        recover_pending_locked(self)?;
        self.read_storage_manifest_locked()
    }

    pub fn write_storage_manifest(&self, manifest: &StorageManifest) -> FileStoreResult<PathBuf> {
        let _lock = self.acquire_transaction_lock()?;
        recover_pending_locked(self)?;
        self.write_storage_manifest_locked(manifest)
    }

    /// 尝试获取跨进程锁；活跃 owner 存在时保持既有的立即返回 `Locked` 语义。
    pub fn acquire_lock(&self) -> FileStoreResult<FileStoreLock> {
        file_lock::acquire(&self.root)
    }

    /// 执行同锁 read-modify-write；闭包内只能通过事务对象读写目标文件。
    pub fn run_transaction<T, F>(
        &self,
        id: &str,
        timestamp: &str,
        operation: F,
    ) -> FileStoreResult<T>
    where
        F: FnOnce(&mut DurableFileTransaction<'_>) -> FileStoreResult<T>,
    {
        self.run_transaction_with(id, timestamp, operation, std::convert::identity)
    }

    /// 允许上层领域在保留自身错误类型的同时使用同一文件事务。
    ///
    /// `map_storage_error` 只转换锁、恢复和持久化阶段的错误；业务闭包错误会原样返回，
    /// 因而闭包失败时不会创建 journal，也不需要补偿式回滚。
    pub fn run_transaction_with<T, E, F, M>(
        &self,
        id: &str,
        timestamp: &str,
        operation: F,
        map_storage_error: M,
    ) -> Result<T, E>
    where
        F: FnOnce(&mut DurableFileTransaction<'_>) -> Result<T, E>,
        M: Fn(FileStoreError) -> E,
    {
        validate_change_set_id(id).map_err(&map_storage_error)?;
        let _lock = self
            .acquire_transaction_lock()
            .map_err(&map_storage_error)?;
        recover_pending_locked(self).map_err(&map_storage_error)?;
        let mut transaction = DurableFileTransaction::new(self);
        let result = operation(&mut transaction)?;
        let changes = transaction.into_changes();
        if !changes.is_empty() {
            apply_changes_locked(self, id, timestamp, changes).map_err(map_storage_error)?;
        }
        Ok(result)
    }

    /// 扫描并恢复上次进程留下的 pending journal；重复调用保持幂等。
    pub fn recover_pending_transactions(&self) -> FileStoreResult<()> {
        let _lock = self.acquire_transaction_lock()?;
        recover_pending_locked(self)
    }

    pub fn apply_change_set(
        &self,
        id: &str,
        timestamp: &str,
        changes: Vec<FileStoreChange>,
    ) -> FileStoreResult<StorageManifest> {
        validate_change_set_id(id)?;
        let _lock = self.acquire_transaction_lock()?;
        recover_pending_locked(self)?;
        apply_changes_locked(self, id, timestamp, coalesce_legacy_changes(changes))
    }

    pub fn restore_change_set(
        &self,
        id: &str,
        timestamp: &str,
    ) -> FileStoreResult<StorageManifest> {
        validate_change_set_id(id)?;
        let _lock = self.acquire_transaction_lock()?;
        restore_change_set_locked(self, id, timestamp)
    }

    /// 原子写入单文件。多文件一致性或 read-modify-write 必须使用 `run_transaction`。
    pub fn atomic_write(
        &self,
        relative_path: impl AsRef<Path>,
        contents: &[u8],
    ) -> FileStoreResult<PathBuf> {
        let relative_path = sanitize_relative_path(relative_path.as_ref())?;
        let _lock = self.acquire_transaction_lock()?;
        recover_pending_locked(self)?;
        self.atomic_write_locked(&relative_path, contents)
    }

    pub fn backup_existing(
        &self,
        relative_path: impl AsRef<Path>,
        backup_relative_root: impl AsRef<Path>,
    ) -> FileStoreResult<Option<PathBuf>> {
        let relative_path = relative_path.as_ref();
        let clean_relative_path = sanitize_relative_path(relative_path)?;
        let source_path = self.path_for(&clean_relative_path)?;
        if !source_path.exists() {
            return Ok(None);
        }
        if !source_path.is_file() {
            return Err(FileStoreError::InvalidPath(format!(
                "backup source is not a file: {}",
                relative_path.display()
            )));
        }

        let backup_root = self.path_for(backup_relative_root)?;
        let backup_path = backup_root.join(clean_relative_path);
        durable_copy(&source_path, &backup_path)?;
        Ok(Some(backup_path))
    }

    pub fn remove_file(&self, relative_path: impl AsRef<Path>) -> FileStoreResult<bool> {
        let _lock = self.acquire_transaction_lock()?;
        recover_pending_locked(self)?;
        self.remove_file_locked(relative_path.as_ref())
    }

    pub(crate) fn read_toml_locked<T: TomlDocument>(
        &self,
        relative_path: &Path,
    ) -> FileStoreResult<T> {
        let relative_path = sanitize_relative_path(relative_path)?;
        let absolute_path = self.path_for(&relative_path)?;
        let source = fs::read_to_string(&absolute_path)?;
        T::decode_toml(&source).map_err(|error| error.with_path(relative_path).into())
    }

    pub(crate) fn read_storage_manifest_locked(&self) -> FileStoreResult<StorageManifest> {
        match self.read_toml_locked::<StorageManifest>(Path::new(STORAGE_MANIFEST_RELATIVE_PATH)) {
            Ok(manifest) => Ok(manifest),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => {
                Ok(StorageManifest::new())
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) fn write_storage_manifest_locked(
        &self,
        manifest: &StorageManifest,
    ) -> FileStoreResult<PathBuf> {
        let encoded = manifest.encode_toml()?;
        self.atomic_write_locked(STORAGE_MANIFEST_RELATIVE_PATH, encoded.as_bytes())
    }

    pub(crate) fn atomic_write_locked(
        &self,
        relative_path: impl AsRef<Path>,
        contents: &[u8],
    ) -> FileStoreResult<PathBuf> {
        let target_path = self.path_for(relative_path)?;
        self.atomic_write_absolute_locked(&target_path, contents)?;
        Ok(target_path)
    }

    pub(crate) fn atomic_write_absolute_locked(
        &self,
        absolute_path: &Path,
        contents: &[u8],
    ) -> FileStoreResult<()> {
        atomic_file::atomic_write(absolute_path, contents).map_err(Into::into)
    }

    pub(crate) fn remove_file_locked(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> FileStoreResult<bool> {
        let relative_path = sanitize_relative_path(relative_path.as_ref())?;
        let target_path = self.path_for(&relative_path)?;
        atomic_file::durable_remove_file(&target_path).map_err(|error| {
            if error.kind() == ErrorKind::InvalidInput {
                FileStoreError::InvalidPath(format!(
                    "restore target is not a file: {}",
                    relative_path.display()
                ))
            } else {
                error.into()
            }
        })
    }

    pub(crate) fn validate_change_path(&self, relative_path: &Path) -> FileStoreResult<PathBuf> {
        let clean = sanitize_relative_path(relative_path)?;
        if clean == Path::new(STORAGE_MANIFEST_RELATIVE_PATH)
            || clean.starts_with("backups")
            || clean.starts_with(".storage-transactions")
            || clean == Path::new(".storage.lock")
        {
            return Err(FileStoreError::InvalidPath(format!(
                "transaction path is reserved: {}",
                clean.display()
            )));
        }
        Ok(clean)
    }

    fn acquire_transaction_lock(&self) -> FileStoreResult<FileStoreLock> {
        let started = Instant::now();
        loop {
            match self.acquire_lock() {
                Ok(lock) => return Ok(lock),
                Err(error @ FileStoreError::Locked(_))
                    if started.elapsed() >= TRANSACTION_LOCK_WAIT =>
                {
                    return Err(error)
                }
                Err(FileStoreError::Locked(_)) => thread::sleep(TRANSACTION_LOCK_RETRY),
                Err(error) => return Err(error),
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStoreChange {
    pub(crate) relative_path: PathBuf,
    pub(crate) contents: Option<Vec<u8>>,
    pub(crate) expected_original_sha256: Option<String>,
}

impl FileStoreChange {
    pub fn new(
        relative_path: impl AsRef<Path>,
        contents: impl Into<Vec<u8>>,
    ) -> FileStoreResult<Self> {
        Ok(Self {
            relative_path: sanitize_relative_path(relative_path.as_ref())?,
            contents: Some(contents.into()),
            expected_original_sha256: None,
        })
    }

    pub fn delete(relative_path: impl AsRef<Path>) -> FileStoreResult<Self> {
        Ok(Self {
            relative_path: sanitize_relative_path(relative_path.as_ref())?,
            contents: None,
            expected_original_sha256: None,
        })
    }

    pub fn relative_path(&self) -> &Path {
        &self.relative_path
    }
}

pub trait TomlDocument: Sized {
    fn encode_toml(&self) -> FileStoreResult<String>;

    fn decode_toml(source: &str) -> Result<Self, TomlParseError>;
}

impl TomlDocument for StorageManifest {
    fn encode_toml(&self) -> FileStoreResult<String> {
        toml::to_string_pretty(self).map_err(|error| FileStoreError::TomlEncode(error.to_string()))
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        let manifest: StorageManifest = toml::from_str(source)
            .map_err(|error| TomlParseError::single(1, 1, error.to_string()))?;
        if manifest.schema_version != STORAGE_MANIFEST_SCHEMA_VERSION {
            return Err(TomlParseError::single(
                1,
                1,
                format!(
                    "unsupported storage manifest schema_version: {}, expected {}",
                    manifest.schema_version, STORAGE_MANIFEST_SCHEMA_VERSION
                ),
            ));
        }
        Ok(manifest)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("TOML parse diagnostics: {diagnostics:?}")]
pub struct TomlParseError {
    diagnostics: Vec<ParseDiagnostic>,
}

impl TomlParseError {
    pub fn new(diagnostics: Vec<ParseDiagnostic>) -> Self {
        Self { diagnostics }
    }

    pub fn single(line: usize, column: usize, message: impl Into<String>) -> Self {
        Self {
            diagnostics: vec![ParseDiagnostic::new(line, column, message)],
        }
    }

    pub fn diagnostics(&self) -> &[ParseDiagnostic] {
        &self.diagnostics
    }

    pub fn with_path(mut self, path: PathBuf) -> Self {
        for diagnostic in &mut self.diagnostics {
            diagnostic.path = Some(path.clone());
        }
        self
    }

    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        let key = key.into();
        for diagnostic in &mut self.diagnostics {
            diagnostic.key = Some(key.clone());
        }
        self
    }

    pub fn with_recovery(mut self, recovery: impl Into<String>) -> Self {
        let recovery = recovery.into();
        for diagnostic in &mut self.diagnostics {
            diagnostic.recovery = Some(recovery.clone());
        }
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseDiagnostic {
    pub path: Option<PathBuf>,
    pub line: usize,
    pub column: usize,
    pub key: Option<String>,
    pub message: String,
    pub recovery: Option<String>,
}

impl ParseDiagnostic {
    pub fn new(line: usize, column: usize, message: impl Into<String>) -> Self {
        Self {
            path: None,
            line,
            column,
            key: None,
            message: message.into(),
            recovery: None,
        }
    }

    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        self.key = Some(key.into());
        self
    }

    pub fn with_recovery(mut self, recovery: impl Into<String>) -> Self {
        self.recovery = Some(recovery.into());
        self
    }
}

pub(crate) fn sanitize_relative_path(relative_path: &Path) -> FileStoreResult<PathBuf> {
    let mut clean = PathBuf::new();
    for component in relative_path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(FileStoreError::InvalidPath(
                    relative_path.display().to_string(),
                ));
            }
        }
    }

    if clean.as_os_str().is_empty() {
        return Err(FileStoreError::InvalidPath("empty path".to_string()));
    }

    Ok(clean)
}

pub(crate) fn validate_change_set_id(id: &str) -> FileStoreResult<()> {
    let id = id.trim();
    if id.is_empty()
        || id == "."
        || id == ".."
        || id.contains('/')
        || id.contains('\\')
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(FileStoreError::InvalidPath(format!(
            "invalid change set id: {id}"
        )));
    }
    Ok(())
}

pub(crate) fn manifest_path_string(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn coalesce_legacy_changes(changes: Vec<FileStoreChange>) -> Vec<FileStoreChange> {
    let mut normalized = Vec::<FileStoreChange>::new();
    for change in changes {
        if let Some(existing) = normalized
            .iter_mut()
            .find(|existing| existing.relative_path == change.relative_path)
        {
            // 旧 facade 允许同一路径出现多次，逐项应用后的稳定语义是最后一项生效。
            *existing = change;
        } else {
            normalized.push(change);
        }
    }
    normalized
}
