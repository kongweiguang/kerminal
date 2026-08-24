//! External agent workspace file, launch, and path helpers.
//!
//! @author kongweiguang

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::{
    process::{Command, Stdio},
    sync::OnceLock,
};

use serde_json::Value;
use uuid::Uuid;

use super::types::{
    ExternalAgentFileAction, ExternalAgentFileOperation, ExternalAgentOverwritePolicy,
    WorkspaceTextPlan, WorkspaceWriteOptions,
};
#[cfg(windows)]
use super::{CREATE_NO_WINDOW, WINDOWS_AGENT_POWERSHELL, WINDOWS_AGENT_PWSH};
use super::{MANAGED_BLOCK_END, MANAGED_BLOCK_START};
use crate::{
    error::{AppError, AppResult},
    models::agent_session::{
        AgentSessionId, AgentSessionScope, AgentTargetBindingContext,
        AgentTargetBindingContextBinding, AgentTargetBindingStatus, AGENT_SESSION_SCHEMA_VERSION,
    },
};

pub(super) fn read_optional_string(path: &Path) -> AppResult<Option<String>> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn apply_text_plan(
    plan: WorkspaceTextPlan,
    options: &WorkspaceWriteOptions,
) -> AppResult<ExternalAgentFileOperation> {
    let changed = plan.current.as_deref() != Some(plan.next.as_str());
    let action = if !changed {
        ExternalAgentFileAction::Unchanged
    } else if plan.current.is_some() {
        ExternalAgentFileAction::Updated
    } else {
        ExternalAgentFileAction::Created
    };
    let diff =
        changed.then(|| build_safe_diff(plan.current_snippet.as_deref(), &plan.next_snippet));
    let mut backup_path = None;

    if changed && !options.dry_run {
        if let Some(parent) = plan.path.parent() {
            fs::create_dir_all(parent)?;
        }
        backup_path = backup_existing_file(&plan.path)?.map(|path| path_to_string(&path));
        let temp_path = plan.path.with_file_name(format!(
            ".{}.tmp-{}",
            plan.path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("kerminal"),
            Uuid::new_v4()
        ));
        fs::write(&temp_path, &plan.next)?;
        if plan.path.exists() {
            fs::remove_file(&plan.path)?;
        }
        fs::rename(temp_path, &plan.path)?;
    }

    Ok(ExternalAgentFileOperation {
        path: path_to_string(&plan.path),
        action,
        changed,
        dry_run: options.dry_run,
        backup_path,
        diff,
        reason: plan.reason,
    })
}

fn backup_existing_file(path: &Path) -> AppResult<Option<PathBuf>> {
    if !path.is_file() {
        return Ok(None);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("kerminal-file");
    let backup_path =
        path.with_file_name(format!("{file_name}.bak-{timestamp}-{}", Uuid::new_v4()));
    fs::copy(path, &backup_path)?;
    Ok(Some(backup_path))
}

pub(super) fn current_unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

/// 旧 unbound 上下文按新权限语义迁移为 global，确保无终端时仍能发现整个工作区。
pub(super) fn unbound_agent_target_binding_context(
    agent_session_id: AgentSessionId,
    generated_at: String,
) -> AgentTargetBindingContext {
    AgentTargetBindingContext {
        schema_version: AGENT_SESSION_SCHEMA_VERSION,
        agent_session_id,
        scope: Some(AgentSessionScope::Global),
        binding: AgentTargetBindingContextBinding {
            binding_id: None,
            generation: 0,
            status: AgentTargetBindingStatus::Unbound,
            stale: false,
            pane_id: None,
            tab_id: None,
            target_terminal_session_id: None,
            target_ref: None,
            cwd: None,
            shell: None,
        },
        agent_terminal: None,
        generated_at,
    }
}

pub(super) fn patch_managed_block(
    path: &Path,
    block: &str,
    reason: &str,
    options: &WorkspaceWriteOptions,
) -> AppResult<ExternalAgentFileOperation> {
    let current = read_optional_string(path)?;
    let current_content = current.as_deref().unwrap_or_default();
    let next = patch_managed_block_content(current_content, block);
    let current_snippet = extract_managed_block(current_content);
    apply_text_plan(
        WorkspaceTextPlan {
            path: path.to_path_buf(),
            next,
            current,
            current_snippet,
            next_snippet: block.trim_end().to_owned(),
            reason: reason.to_owned(),
        },
        options,
    )
}

pub(super) fn patch_managed_block_content(current: &str, block: &str) -> String {
    if let Some(start) = current.find(MANAGED_BLOCK_START) {
        if let Some(end_relative) = current[start..].find(MANAGED_BLOCK_END) {
            let end = start + end_relative + MANAGED_BLOCK_END.len();
            return format!(
                "{}{}{}",
                &current[..start],
                block.trim_end(),
                &current[end..]
            );
        }
        return format!("{}\n\n{}", current.trim_end(), block.trim_end());
    }
    if current.trim().is_empty() {
        format!("{}\n", block.trim_end())
    } else {
        format!("{}\n\n{}\n", current.trim_end(), block.trim_end())
    }
}

pub(super) fn replace_toml_table(content: &str, table_header: &str, replacement: &str) -> String {
    let lines = content.lines().collect::<Vec<_>>();
    let Some(start) = lines.iter().position(|line| line.trim() == table_header) else {
        let mut next = content.trim_end().to_owned();
        if !next.is_empty() {
            next.push_str("\n\n");
        }
        next.push_str(replacement.trim_end());
        next.push('\n');
        return next;
    };
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| {
            let trimmed = line.trim();
            (trimmed.starts_with('[') && trimmed.ends_with(']')).then_some(index)
        })
        .unwrap_or(lines.len());
    let mut next_lines = Vec::new();
    next_lines.extend_from_slice(&lines[..start]);
    next_lines.extend(replacement.trim_end().lines());
    next_lines.extend_from_slice(&lines[end..]);
    format!("{}\n", next_lines.join("\n").trim_end())
}

pub(super) fn parse_claude_mcp_json(
    path: &Path,
    current: Option<&str>,
    options: &WorkspaceWriteOptions,
) -> AppResult<Option<Value>> {
    let Some(content) = current else {
        return Ok(None);
    };
    if content.trim().is_empty() {
        return Ok(None);
    }
    match serde_json::from_str::<Value>(content) {
        Ok(Value::Object(_)) => Ok(serde_json::from_str::<Value>(content).ok()),
        Ok(_) | Err(_) => match options.overwrite_policy {
            ExternalAgentOverwritePolicy::BackupAndReplaceInvalid => Ok(None),
            ExternalAgentOverwritePolicy::PreserveUserContent => Err(AppError::InvalidInput(
                format!(
                    "{} is not a valid Claude MCP JSON object. Use overwritePolicy=backupAndReplaceInvalid to back it up and repair it.",
                    path_to_string(path)
                ),
            )),
        },
    }
}

fn extract_managed_block(content: &str) -> Option<String> {
    let start = content.find(MANAGED_BLOCK_START)?;
    let end_relative = content[start..].find(MANAGED_BLOCK_END)?;
    let end = start + end_relative + MANAGED_BLOCK_END.len();
    Some(content[start..end].to_owned())
}

pub(super) fn extract_toml_table(content: &str, table_header: &str) -> Option<String> {
    let lines = content.lines().collect::<Vec<_>>();
    let start = lines.iter().position(|line| line.trim() == table_header)?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| {
            let trimmed = line.trim();
            (trimmed.starts_with('[') && trimmed.ends_with(']')).then_some(index)
        })
        .unwrap_or(lines.len());
    Some(lines[start..end].join("\n"))
}

fn build_safe_diff(current: Option<&str>, next: &str) -> String {
    let current = current
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("<missing Kerminal managed section>");
    format!(
        "--- current\n{}\n+++ next\n{}\n",
        prefix_diff_lines(current, '-'),
        prefix_diff_lines(next.trim(), '+')
    )
}

fn prefix_diff_lines(content: &str, prefix: char) -> String {
    if content.is_empty() {
        return format!("{prefix}<empty>");
    }
    content
        .lines()
        .map(|line| format!("{prefix}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn codex_config_ready(path: &Path) -> bool {
    fs::read_to_string(path)
        .map(|content| content.contains("[mcp_servers.kerminal]") && content.contains("url = "))
        .unwrap_or(false)
}

pub(super) fn claude_config_ready(path: &Path) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(root) = serde_json::from_str::<Value>(&content) else {
        return false;
    };
    root.pointer("/mcpServers/kerminal/url")
        .and_then(Value::as_str)
        .is_some()
}

pub(super) fn validate_agent_session_id(input: &str) -> AppResult<String> {
    let value = input.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(
            "Agent session id is required for a session workspace.".to_owned(),
        ));
    }
    if value.len() > 128 {
        return Err(AppError::InvalidInput(
            "Agent session id must be 128 characters or fewer.".to_owned(),
        ));
    }
    if !value
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || char == '_' || char == '-')
    {
        return Err(AppError::InvalidInput(
            "Agent session id may only contain ASCII letters, numbers, '_' or '-'.".to_owned(),
        ));
    }
    Ok(value.to_owned())
}

pub(super) fn scoped_agent_mcp_endpoint(base_endpoint: &str, agent_session_id: &str) -> String {
    format!(
        "{}/agents/{}",
        base_endpoint.trim_end_matches('/'),
        agent_session_id
    )
}

#[cfg(not(windows))]
fn parse_command_line(input: &str) -> AppResult<(String, Vec<String>)> {
    let parts = split_command_line(input);
    let Some(shell) = parts.first().filter(|value| !value.trim().is_empty()) else {
        return Err(AppError::InvalidInput(
            "Custom agent command is not configured. Enter a command before launch.".to_owned(),
        ));
    };
    Ok((shell.clone(), parts[1..].to_vec()))
}

pub(super) fn agent_launch_command(command: &str) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if let Some(shell) = preferred_windows_agent_shell() {
            powershell_agent_launch_command(shell, command)
        } else {
            cmd_agent_launch_command(command)
        }
    }

    #[cfg(not(windows))]
    {
        parse_command_line(command).unwrap_or_else(|_| (command.to_owned(), Vec::new()))
    }
}

#[cfg(windows)]
fn preferred_windows_agent_shell() -> Option<&'static str> {
    static PREFERRED_WINDOWS_AGENT_SHELL: OnceLock<Option<&'static str>> = OnceLock::new();
    *PREFERRED_WINDOWS_AGENT_SHELL.get_or_init(|| {
        [WINDOWS_AGENT_PWSH, WINDOWS_AGENT_POWERSHELL]
            .into_iter()
            .find(|shell| windows_agent_shell_available(shell))
    })
}

#[cfg(windows)]
fn windows_agent_shell_available(shell: &str) -> bool {
    Command::new(shell)
        .creation_flags(CREATE_NO_WINDOW)
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("$PSVersionTable.PSVersion.ToString()")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn powershell_agent_launch_command(shell: &str, command: &str) -> (String, Vec<String>) {
    (
        shell.to_owned(),
        vec![
            "-NoLogo".to_owned(),
            "-NoProfile".to_owned(),
            "-NoExit".to_owned(),
            "-Command".to_owned(),
            command.to_owned(),
        ],
    )
}

#[cfg(windows)]
fn cmd_agent_launch_command(command: &str) -> (String, Vec<String>) {
    (
        "cmd.exe".to_owned(),
        vec![
            "/d".to_owned(),
            "/s".to_owned(),
            "/k".to_owned(),
            command.to_owned(),
        ],
    )
}

#[cfg(not(windows))]
fn split_command_line(input: &str) -> Vec<String> {
    let chars = input.chars().collect::<Vec<_>>();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut index = 0;

    while index < chars.len() {
        let char = chars[index];
        if char == '\\' {
            if let Some(next) = chars.get(index + 1).copied() {
                if next == '"' || next == '\'' || next == '\\' || next.is_whitespace() {
                    current.push(next);
                    index += 2;
                    continue;
                }
            }
            current.push(char);
            index += 1;
            continue;
        }
        if let Some(active_quote) = quote {
            if char == active_quote {
                quote = None;
            } else {
                current.push(char);
            }
            index += 1;
            continue;
        }
        if char == '"' || char == '\'' {
            quote = Some(char);
            index += 1;
            continue;
        }
        if char.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            index += 1;
            continue;
        }
        current.push(char);
        index += 1;
    }

    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

pub(super) fn executable_on_path(command: &str) -> bool {
    let command_path = Path::new(command);
    if command_path.components().count() > 1 {
        return command_path.is_file();
    }
    let Some(path_value) = env::var_os("PATH") else {
        return false;
    };
    let candidates = executable_names(command);
    env::split_paths(&path_value).any(|directory| {
        candidates
            .iter()
            .any(|candidate| directory.join(candidate).is_file())
    })
}

/// 轻量探测 PI MCP adapter，避免每次状态刷新都启动 `pi --help` 子进程。
///
/// PI 的扩展目录允许通过 `PI_CODING_AGENT_DIR` 重定向；未设置时沿用 PI 原生的
/// `~/.pi/agent` 默认目录。这里只检查 adapter 包目录，CLI 本身由 PATH 独立探测。
pub(super) fn pi_mcp_adapter_available() -> bool {
    let Some(agent_dir) =
        resolve_pi_coding_agent_dir(env::var_os("PI_CODING_AGENT_DIR"), dirs::home_dir())
    else {
        return false;
    };
    pi_mcp_adapter_available_in(&agent_dir)
}

/// 把可选环境覆盖与 home fallback 收敛为可测试的 PI 配置根目录解析。
fn resolve_pi_coding_agent_dir(
    configured: Option<OsString>,
    home_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    configured
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir.map(|home| home.join(".pi").join("agent")))
}

/// 在已解析的 PI 配置根目录下检查官方 adapter 包目录。
fn pi_mcp_adapter_available_in(agent_dir: &Path) -> bool {
    agent_dir
        .join("npm")
        .join("node_modules")
        .join("pi-mcp-adapter")
        .is_dir()
}

fn executable_names(command: &str) -> Vec<OsString> {
    #[cfg(windows)]
    {
        let command_path = Path::new(command);
        if command_path.extension().is_some() {
            return vec![OsString::from(command)];
        }
        let path_ext = env::var_os("PATHEXT")
            .and_then(|value| value.into_string().ok())
            .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_owned());
        path_ext
            .split(';')
            .filter(|extension| !extension.trim().is_empty())
            .map(|extension| OsString::from(format!("{command}{extension}")))
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![OsString::from(command)]
    }
}

/// External agent workspace runtime rules used by integration tests.
#[doc(hidden)]
pub mod rules {
    use std::ffi::OsString;

    pub fn executable_names(command: &str) -> Vec<OsString> {
        super::executable_names(command)
    }
}

pub(super) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(super) fn workspace_display_path(workspace_dir: &Path, path: &Path) -> String {
    if workspace_dir.file_name().and_then(|name| name.to_str()) != Some(".kerminal") {
        return path_to_string(path);
    }
    let Ok(relative) = path.strip_prefix(workspace_dir) else {
        return path_to_string(path);
    };
    let suffix = relative.to_string_lossy().replace('\\', "/");
    if suffix.is_empty() {
        "~/.kerminal".to_owned()
    } else {
        format!("~/.kerminal/{suffix}")
    }
}

#[cfg(test)]
mod tests {
    use super::{pi_mcp_adapter_available_in, resolve_pi_coding_agent_dir};
    use std::{ffi::OsString, fs, path::PathBuf};

    #[test]
    /// 环境覆盖优先于 home fallback，空覆盖则保持 PI 原生默认目录。
    fn pi_agent_dir_resolution_prefers_non_empty_override() {
        assert_eq!(
            resolve_pi_coding_agent_dir(
                Some(OsString::from("D:/portable/pi-agent")),
                Some(PathBuf::from("C:/Users/test")),
            ),
            Some(PathBuf::from("D:/portable/pi-agent"))
        );
        assert_eq!(
            resolve_pi_coding_agent_dir(
                Some(OsString::new()),
                Some(PathBuf::from("C:/Users/test")),
            ),
            Some(PathBuf::from("C:/Users/test/.pi/agent"))
        );
    }

    #[test]
    /// adapter 探测只认约定包目录，不把仅存在 npm 根目录的半安装状态误报为可用。
    fn pi_mcp_adapter_probe_requires_package_directory() {
        let temp = tempfile::tempdir().expect("temp PI root");
        fs::create_dir_all(temp.path().join("npm").join("node_modules"))
            .expect("create node_modules");
        assert!(!pi_mcp_adapter_available_in(temp.path()));

        fs::create_dir_all(
            temp.path()
                .join("npm")
                .join("node_modules")
                .join("pi-mcp-adapter"),
        )
        .expect("create adapter package");
        assert!(pi_mcp_adapter_available_in(temp.path()));
    }
}
