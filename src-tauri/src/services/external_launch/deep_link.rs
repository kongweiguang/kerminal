//! `kerminal://` 深链接的受控接入边界。
//!
//! @author kongweiguang

use url::Url;

use crate::error::{AppError, AppResult};

use super::{ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake};

/// Windows 动态注册使用的唯一协议名；安装包不会默认抢占该协议。
pub const EXTERNAL_LAUNCH_DEEP_LINK_SCHEME: &str = "kerminal";
const EXTERNAL_LAUNCH_DEEP_LINK_ACTIONS: &[&str] = &["ssh", "sftp"];

/// 从系统交付的 argv 中识别唯一的 Kerminal 协议 URL。
///
/// 这里只识别 scheme，action 与 query 的安全规则由接下来的严格校验和 parser
/// 共同执行，从而让非法 `kerminal://` 请求得到明确拒绝而不是降级成普通参数。
pub fn external_launch_protocol_url_from_args(argv: &[String]) -> Option<&str> {
    if argv.len() != 2 {
        return None;
    }
    let argument = argv.get(1)?;
    Url::parse(argument)
        .ok()
        .filter(|url| url.scheme() == EXTERNAL_LAUNCH_DEEP_LINK_SCHEME)
        .map(|_| argument.as_str())
}

/// 将 cold start、single-instance 与 `on_open_url` 收敛到同一 intake。
///
/// 该函数不读取注册表、不记录 URL，并且在进入 parser 前先拒绝错误 action；query
/// allowlist、secret、remote command 和本地文件参数继续由 native parser fail closed。
pub fn accept_external_launch_protocol_args(
    intake: &ExternalLaunchIntake,
    argv: Vec<String>,
    cwd: Option<String>,
) -> AppResult<ExternalLaunchAcceptOutcome> {
    let raw_url = external_launch_protocol_url_from_args(&argv).ok_or_else(|| {
        AppError::InvalidInput(
            "Kerminal protocol activation must contain exactly one kerminal:// URL".to_owned(),
        )
    })?;
    validate_external_launch_protocol_url(raw_url)?;
    intake.accept_args(argv, cwd, ExternalLaunchEntrypoint::Protocol)
}

/// 异步入口在有界 worker 中完成 parser，供窗口生命周期回调安全调用。
pub async fn accept_external_launch_protocol_args_bounded(
    intake: &ExternalLaunchIntake,
    argv: Vec<String>,
    cwd: Option<String>,
) -> AppResult<ExternalLaunchAcceptOutcome> {
    let raw_url = external_launch_protocol_url_from_args(&argv).ok_or_else(|| {
        AppError::InvalidInput(
            "Kerminal protocol activation must contain exactly one kerminal:// URL".to_owned(),
        )
    })?;
    validate_external_launch_protocol_url(raw_url)?;
    intake
        .accept_args_bounded(argv, cwd, ExternalLaunchEntrypoint::Protocol)
        .await
}

fn validate_external_launch_protocol_url(raw_url: &str) -> AppResult<()> {
    let url = Url::parse(raw_url)
        .map_err(|error| AppError::InvalidInput(format!("invalid Kerminal URL: {error}")))?;
    if url.scheme() != EXTERNAL_LAUNCH_DEEP_LINK_SCHEME
        || !url
            .host_str()
            .is_some_and(|action| EXTERNAL_LAUNCH_DEEP_LINK_ACTIONS.contains(&action))
        || url.path() != ""
        || url.fragment().is_some()
    {
        return Err(AppError::InvalidInput(
            "Kerminal protocol only supports kerminal://ssh and kerminal://sftp".to_owned(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err(AppError::InvalidInput(
            "Kerminal protocol authority must not contain credentials or a port".to_owned(),
        ));
    }
    Ok(())
}
