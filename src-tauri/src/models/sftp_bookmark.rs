//! SFTP 路径书签 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    models::target::{normalize_remote_path, RemoteTargetRef},
};

pub const SFTP_BOOKMARK_LIMIT_PER_TARGET: usize = 100;
const SFTP_BOOKMARK_MAX_IDENTIFIER_LENGTH: usize = 512;
const SFTP_BOOKMARK_MAX_PATH_LENGTH: usize = 4_096;

/// 查询某个可浏览远程目标的路径书签。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpBookmarkListRequest {
    pub target: RemoteTargetRef,
}

/// 更新某个远程路径的收藏状态。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpBookmarkSetRequest {
    pub bookmarked: bool,
    pub path: String,
    pub target: RemoteTargetRef,
}

/// 面向 SFTP 浏览器返回的单条书签。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpBookmark {
    pub created_at_unix_ms: i64,
    pub path: String,
}

/// 文件持久化使用的稳定目标身份，不保留展示属性或可变默认工作目录。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum SftpBookmarkTarget {
    Ssh {
        host_id: String,
    },
    DockerContainer {
        container_id: String,
        host_id: String,
        runtime: String,
    },
}

impl SftpBookmarkTarget {
    pub(crate) fn from_remote_target(target: &RemoteTargetRef) -> AppResult<Self> {
        match target {
            RemoteTargetRef::Ssh { host_id } => Ok(Self::Ssh {
                host_id: normalize_identifier("SSH 主机 ID", host_id)?,
            }),
            RemoteTargetRef::DockerContainer {
                container_id,
                host_id,
                runtime,
                ..
            } => Ok(Self::DockerContainer {
                container_id: normalize_identifier("容器 ID", container_id)?,
                host_id: normalize_identifier("容器宿主 SSH 主机 ID", host_id)?,
                runtime: runtime.as_str().to_owned(),
            }),
            _ => Err(AppError::InvalidInput(
                "SFTP 路径书签仅支持 SSH 主机或容器目标".to_owned(),
            )),
        }
    }

    pub(crate) fn validate(&self) -> AppResult<()> {
        match self {
            Self::Ssh { host_id } => {
                validate_canonical_identifier("SSH 主机 ID", host_id)?;
            }
            Self::DockerContainer {
                container_id,
                host_id,
                runtime,
            } => {
                validate_canonical_identifier("容器 ID", container_id)?;
                validate_canonical_identifier("容器宿主 SSH 主机 ID", host_id)?;
                if runtime != "docker" && runtime != "podman" {
                    return Err(AppError::InvalidInput("SFTP 书签容器运行时无效".to_owned()));
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn normalize_sftp_bookmark_path(path: &str) -> AppResult<String> {
    if path.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(
            "SFTP 书签路径不能包含控制字符".to_owned(),
        ));
    }
    let normalized = normalize_remote_path(path)?;
    if normalized.len() > SFTP_BOOKMARK_MAX_PATH_LENGTH {
        return Err(AppError::InvalidInput(format!(
            "SFTP 书签路径不能超过 {SFTP_BOOKMARK_MAX_PATH_LENGTH} 个字符"
        )));
    }
    Ok(normalized)
}

fn normalize_identifier(field: &str, value: &str) -> AppResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    if normalized.len() > SFTP_BOOKMARK_MAX_IDENTIFIER_LENGTH {
        return Err(AppError::InvalidInput(format!(
            "{field}不能超过 {SFTP_BOOKMARK_MAX_IDENTIFIER_LENGTH} 个字符"
        )));
    }
    if normalized.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(format!("{field}不能包含控制字符")));
    }
    Ok(normalized.to_owned())
}

fn validate_canonical_identifier(field: &str, value: &str) -> AppResult<()> {
    if normalize_identifier(field, value)? != value {
        return Err(AppError::InvalidInput(format!("{field}必须使用规范格式")));
    }
    Ok(())
}
