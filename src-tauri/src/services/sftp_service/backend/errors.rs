//! @author kongweiguang

use std::io;

use crate::{error::AppError, storage::file_store::FileStoreError};

pub(super) fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}

pub(crate) fn native_sftp_error(error: russh_sftp::client::error::Error) -> AppError {
    AppError::Sftp(format!("SFTP 协议失败: {error}"))
}

pub(crate) fn io_sftp_error(error: io::Error) -> AppError {
    AppError::Sftp(format!("SFTP 本地 I/O 失败: {error}"))
}
