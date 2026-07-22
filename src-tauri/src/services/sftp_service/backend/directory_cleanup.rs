//! SFTP-only 目录清理。
//!
//! @author kongweiguang

use russh_sftp::{client::SftpSession, protocol::FileType};

use crate::{error::AppResult, services::sftp_service::backend::errors::native_sftp_error};

/// SFTP-only 主机不能依赖远端 shell；后序遍历保证目录在子项删除后再移除。
pub(super) async fn remove_remote_directory_with_sftp(
    sftp: &SftpSession,
    root: &str,
) -> AppResult<()> {
    let mut stack = vec![(root.to_owned(), false)];
    while let Some((path, visited)) = stack.pop() {
        if visited {
            sftp.remove_dir(path).await.map_err(native_sftp_error)?;
            continue;
        }

        let entries = sftp
            .read_dir(path.clone())
            .await
            .map_err(native_sftp_error)?;
        stack.push((path, true));
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = entry.path();
            if entry.file_type() == FileType::Dir {
                stack.push((child, false));
            } else {
                sftp.remove_file(child).await.map_err(native_sftp_error)?;
            }
        }
    }
    Ok(())
}
