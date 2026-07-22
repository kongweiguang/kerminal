//! 跨平台耐久文件替换原语。
//!
//! @author kongweiguang

use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use uuid::Uuid;

#[cfg(unix)]
use std::fs::File;

/// 将内容写入同一文件系统中的临时文件，再替换目标文件。
///
/// Windows 使用 `ReplaceFileW`，不会再执行 delete-before-rename；目标不存在时使用
/// `MoveFileExW`。失败时临时文件会被清理，已有目标不会被主动删除。
pub(crate) fn atomic_write(target_path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = target_path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("missing parent for {}", target_path.display()),
        )
    })?;
    fs::create_dir_all(parent)?;

    let temp_path = sibling_temp_path(target_path, "tmp")?;
    let result = write_new_file(&temp_path, contents)
        .and_then(|()| {
            persist_temp_file(&temp_path, target_path).map_err(|error| {
                io::Error::new(
                    error.kind(),
                    format!("persist {} failed: {error}", target_path.display()),
                )
            })
        })
        .and_then(|()| sync_parent_dir(parent));
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

/// 复制文件并通过临时文件发布，避免崩溃留下半份 backup。
pub(crate) fn durable_copy(source_path: &Path, target_path: &Path) -> io::Result<()> {
    let parent = target_path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("missing parent for {}", target_path.display()),
        )
    })?;
    fs::create_dir_all(parent)?;
    let temp_path = sibling_temp_path(target_path, "copy")?;
    let result = (|| {
        fs::copy(source_path, &temp_path)?;
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(&temp_path)?
            .sync_all()?;
        persist_temp_file(&temp_path, target_path).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("persist copy {} failed: {error}", target_path.display()),
            )
        })?;
        sync_parent_dir(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

/// 删除普通文件并同步其父目录；目标不存在视为幂等成功。
pub(crate) fn durable_remove_file(target_path: &Path) -> io::Result<bool> {
    match fs::metadata(target_path) {
        Ok(metadata) if metadata.is_file() => {
            fs::remove_file(target_path)?;
            if let Some(parent) = target_path.parent() {
                sync_parent_dir(parent)?;
            }
            Ok(true)
        }
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("target is not a file: {}", target_path.display()),
        )),
        Err(error) if is_missing_path_error(&error) => Ok(false),
        Err(error) => Err(error),
    }
}

/// 将新文件完整写入磁盘；调用方负责提供尚不存在的路径。
pub(crate) fn write_new_file(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

/// 同步目录项变更。Windows 的标准库不能以可移植方式打开目录句柄，因此由带
/// `WRITE_THROUGH` 的平台替换 API 提供落盘保证；Unix 则显式 fsync 父目录。
pub(crate) fn sync_parent_dir(parent: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(parent)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = parent;
        Ok(())
    }
}

pub(crate) fn is_missing_path_error(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
    )
}

fn sibling_temp_path(target_path: &Path, purpose: &str) -> io::Result<PathBuf> {
    let parent = target_path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("missing parent for {}", target_path.display()),
        )
    })?;
    let file_name = target_path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            target_path.display().to_string(),
        )
    })?;
    let mut temp_name = OsString::from(".");
    temp_name.push(file_name);
    temp_name.push(format!(
        ".{purpose}-{}-{}",
        std::process::id(),
        Uuid::new_v4()
    ));
    Ok(parent.join(temp_name))
}

#[cfg(not(windows))]
fn persist_temp_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    fs::rename(temp_path, target_path)
}

#[cfg(windows)]
fn persist_temp_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    use std::{
        os::windows::ffi::OsStrExt,
        ptr, thread,
        time::{Duration, Instant},
    };

    // Defender、索引器和 WebView 文件观察器可能短暂持有新发布的配置文件。
    // 保留有界重试，避免一次暂态 ACCESS_DENIED 破坏事务 journal/manifest 一致性。
    const RETRY_WINDOW: Duration = Duration::from_secs(5);
    const RETRY_INTERVAL: Duration = Duration::from_millis(20);

    let deadline = Instant::now() + RETRY_WINDOW;
    loop {
        match persist_temp_file_once(temp_path, target_path) {
            Ok(()) => return Ok(()),
            Err(error)
                if temp_path.is_file()
                    && retryable_windows_replace_error(&error)
                    && Instant::now() < deadline =>
            {
                thread::sleep(RETRY_INTERVAL);
            }
            Err(error) => return Err(error),
        }
    }

    fn retryable_windows_replace_error(error: &io::Error) -> bool {
        // ACCESS_DENIED、SHARING_VIOLATION 与 ReplaceFileW 的三种暂态移动失败。
        matches!(
            error.raw_os_error(),
            Some(5 | 32 | 33 | 80 | 183 | 1175 | 1176 | 1177)
        )
    }

    fn persist_temp_file_once(temp_path: &Path, target_path: &Path) -> io::Result<()> {
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH, REPLACEFILE_WRITE_THROUGH,
        };

        fn wide(path: &Path) -> Vec<u16> {
            path.as_os_str().encode_wide().chain(Some(0)).collect()
        }

        let temp = wide(temp_path);
        let target = wide(target_path);
        if target_path.exists() {
            // SAFETY: 两个 UTF-16 缓冲区在调用期间保持有效并以 NUL 结尾；可选指针均为空。
            let replaced = unsafe {
                ReplaceFileW(
                    target.as_ptr(),
                    temp.as_ptr(),
                    ptr::null(),
                    REPLACEFILE_WRITE_THROUGH,
                    ptr::null(),
                    ptr::null(),
                )
            };
            if replaced == 0 {
                return Err(io::Error::last_os_error());
            }
            return Ok(());
        }

        // SAFETY: 两个 UTF-16 缓冲区在调用期间保持有效并以 NUL 结尾；目标当前不存在。
        let moved = unsafe { MoveFileExW(temp.as_ptr(), target.as_ptr(), MOVEFILE_WRITE_THROUGH) };
        if moved == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}
