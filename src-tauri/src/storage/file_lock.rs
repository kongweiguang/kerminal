//! 带进程身份校验的 FileStore 跨进程锁。
//!
//! @author kongweiguang

use std::{
    fs::{self},
    io::{self, ErrorKind},
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, System};
use uuid::Uuid;

use super::{
    atomic_file::{sync_parent_dir, write_new_file},
    file_store::{FileStoreError, FileStoreResult},
};

const LOCK_SCHEMA_VERSION: u32 = 1;
const LOCK_FILE_NAME: &str = ".storage.lock";

/// FileStore 锁守卫；仅当磁盘 nonce 仍属于本守卫时才删除锁文件。
#[derive(Debug)]
#[must_use = "锁守卫必须存活到受保护操作结束"]
pub struct FileStoreLock {
    path: PathBuf,
    nonce: String,
}

impl Drop for FileStoreLock {
    fn drop(&mut self) {
        let Ok(source) = fs::read_to_string(&self.path) else {
            return;
        };
        let Ok(metadata) = decode_lock_metadata(&source) else {
            return;
        };
        if metadata.nonce != self.nonce {
            return;
        }
        if fs::remove_file(&self.path).is_ok() {
            if let Some(parent) = self.path.parent() {
                let _ = sync_parent_dir(parent);
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockMetadata {
    schema_version: u32,
    pid: u32,
    process_started_at_unix_seconds: u64,
    created_at_unix_ms: u64,
    nonce: String,
}

/// 获取锁；只有 owner PID 已消失或已被另一个启动时间的进程复用时才接管。
pub(crate) fn acquire(root: &Path) -> FileStoreResult<FileStoreLock> {
    fs::create_dir_all(root)?;
    let lock_path = root.join(LOCK_FILE_NAME);
    let metadata = current_lock_metadata()?;

    for _ in 0..3 {
        match create_lock_file(root, &lock_path, &metadata) {
            Ok(guard) => return Ok(guard),
            Err(error)
                if error.kind() == ErrorKind::AlreadyExists
                    || (error.kind() == ErrorKind::PermissionDenied && lock_path.exists()) =>
            {
                if !remove_if_provably_stale(&lock_path)? {
                    return Err(FileStoreError::Locked(lock_path));
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(FileStoreError::Locked(lock_path))
}

fn create_lock_file(
    root: &Path,
    lock_path: &Path,
    metadata: &LockMetadata,
) -> io::Result<FileStoreLock> {
    let source = toml::to_string_pretty(metadata)
        .map_err(|error| io::Error::new(ErrorKind::InvalidData, error.to_string()))?;
    let pending_path = root.join(format!(".storage.lock.pending-{}", metadata.nonce));
    write_new_file(&pending_path, source.as_bytes())?;

    // hard-link 的发布具有 create-new 语义，避免进程在空锁文件写入期间退出后留下
    // 无法判定 owner 的永久锁。
    let published = fs::hard_link(&pending_path, lock_path);
    let _ = fs::remove_file(&pending_path);
    published?;
    sync_parent_dir(root)?;
    Ok(FileStoreLock {
        path: lock_path.to_path_buf(),
        nonce: metadata.nonce.clone(),
    })
}

fn remove_if_provably_stale(lock_path: &Path) -> FileStoreResult<bool> {
    let observed_source = fs::read_to_string(lock_path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            FileStoreError::Locked(lock_path.to_path_buf())
        } else {
            error.into()
        }
    })?;
    let observed = decode_lock_metadata(&observed_source)
        .map_err(|()| FileStoreError::InvalidLock(lock_path.to_path_buf()))?;
    if !owner_is_provably_dead(&observed) {
        return Ok(false);
    }

    // 删除前再次比较完整记录，避免把已由其它竞争者发布的新锁当作旧锁删除。
    match fs::read_to_string(lock_path) {
        Ok(current_source) if current_source == observed_source => {}
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
        Err(error) => return Err(error.into()),
    }
    match fs::remove_file(lock_path) {
        Ok(()) => {
            if let Some(parent) = lock_path.parent() {
                sync_parent_dir(parent)?;
            }
            Ok(true)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(true),
        Err(error) => Err(error.into()),
    }
}

fn current_lock_metadata() -> FileStoreResult<LockMetadata> {
    let pid = std::process::id();
    let process_started_at_unix_seconds = current_process_start_time()?;
    let created_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| io::Error::other(error.to_string()))?
        .as_millis()
        .try_into()
        .map_err(|_| io::Error::other("lock timestamp overflow"))?;
    Ok(LockMetadata {
        schema_version: LOCK_SCHEMA_VERSION,
        pid,
        process_started_at_unix_seconds,
        created_at_unix_ms,
        nonce: Uuid::new_v4().to_string(),
    })
}

fn decode_lock_metadata(source: &str) -> Result<LockMetadata, ()> {
    let metadata = toml::from_str::<LockMetadata>(source).map_err(|_| ())?;
    if metadata.schema_version != LOCK_SCHEMA_VERSION
        || metadata.pid == 0
        || metadata.process_started_at_unix_seconds == 0
        || metadata.created_at_unix_ms == 0
        || metadata.nonce.trim().is_empty()
    {
        return Err(());
    }
    Ok(metadata)
}

fn owner_is_provably_dead(metadata: &LockMetadata) -> bool {
    if metadata.pid == std::process::id() {
        return current_process_start_time()
            .map(|started_at| started_at != metadata.process_started_at_unix_seconds)
            .unwrap_or(false);
    }
    let system = System::new_all();
    match system.process(Pid::from_u32(metadata.pid)) {
        Some(process) => process.start_time() != metadata.process_started_at_unix_seconds,
        None => true,
    }
}

fn current_process_start_time() -> io::Result<u64> {
    static START_TIME: OnceLock<u64> = OnceLock::new();
    if let Some(started_at) = START_TIME.get() {
        return Ok(*started_at);
    }
    let pid = std::process::id();
    let system = System::new_all();
    let started_at = system
        .process(Pid::from_u32(pid))
        .map(|process| process.start_time())
        .filter(|started_at| *started_at > 0)
        .ok_or_else(|| {
            io::Error::other("cannot determine current process start time for file-store lock")
        })?;
    let _ = START_TIME.set(started_at);
    Ok(*START_TIME.get().unwrap_or(&started_at))
}
