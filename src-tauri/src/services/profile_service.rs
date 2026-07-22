//! 终端 Profile 业务服务。
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::profile::{
        ProfileCreateRequest, ProfileUpdateRequest, ShellCandidate, ShellCandidateSource,
        TerminalProfile,
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};

/// 终端 Profile 业务入口。
#[derive(Debug, Clone)]
pub struct ProfileService {
    config: ConfigFileStore,
    read_only_fallback: Arc<RwLock<Option<Vec<TerminalProfile>>>>,
}

impl ProfileService {
    /// 创建 Profile 服务。
    pub fn new(config: ConfigFileStore) -> Self {
        Self {
            config,
            read_only_fallback: Arc::new(RwLock::new(None)),
        }
    }

    /// 初始化默认终端 Profile。
    pub fn ensure_seed_profiles(&self) -> AppResult<()> {
        if !self.list_profiles()?.is_empty() {
            return Ok(());
        }

        let profiles = self.default_profiles();

        self.config
            .apply_profile_change_set(&profiles, &[])
            .map_err(config_file_error)
    }

    /// 列出终端 Profile。
    pub fn list_profiles(&self) -> AppResult<Vec<TerminalProfile>> {
        if let Some(profiles) = self
            .read_only_fallback
            .read()
            .map_err(|_| AppError::StateLockPoisoned("profile_recovery"))?
            .clone()
        {
            return Ok(profiles);
        }
        self.config.list_profiles().map_err(config_file_error)
    }

    /// 探测当前主机可用 shell。
    pub fn detect_shells(&self) -> Vec<ShellCandidate> {
        detect_shell_candidates()
    }

    /// 创建终端 Profile。
    pub fn create_profile(&self, request: ProfileCreateRequest) -> AppResult<TerminalProfile> {
        self.reject_recovery_write()?;
        let mut profiles = self.list_profiles()?;
        let timestamp = timestamp_now();
        let profile = TerminalProfile {
            id: Uuid::new_v4().to_string(),
            name: normalize_required_text("Profile 名称", request.name)?,
            shell: normalize_required_text("shell", request.shell)?,
            args: request.args,
            cwd: normalize_cwd(request.cwd)?,
            env: normalize_env(request.env)?,
            is_default: request.set_default || profiles.is_empty(),
            sidebar_group_id: normalize_sidebar_group_id(request.sidebar_group_id, None),
            sort_order: next_profile_sort_order(&profiles),
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        };

        let mut writes = Vec::new();
        if profile.is_default {
            clear_default_profiles(&mut profiles, &timestamp, &mut writes);
        }
        writes.push(profile.clone());
        self.config
            .apply_profile_change_set(&writes, &[])
            .map_err(config_file_error)?;
        Ok(profile)
    }

    /// 更新终端 Profile。
    pub fn update_profile(&self, request: ProfileUpdateRequest) -> AppResult<TerminalProfile> {
        self.reject_recovery_write()?;
        let mut profiles = self.list_profiles()?;
        let index = profiles
            .iter()
            .position(|profile| profile.id == request.id)
            .ok_or_else(|| AppError::NotFound(format!("终端 Profile 不存在: {}", request.id)))?;
        let existing = profiles[index].clone();
        let timestamp = timestamp_now();
        let profile = TerminalProfile {
            id: request.id.clone(),
            name: normalize_required_text("Profile 名称", request.name)?,
            shell: normalize_required_text("shell", request.shell)?,
            args: request.args,
            cwd: normalize_cwd(request.cwd)?,
            env: normalize_env(request.env)?,
            is_default: request.set_default || existing.is_default,
            sidebar_group_id: normalize_sidebar_group_id(
                request.sidebar_group_id,
                existing.sidebar_group_id,
            ),
            sort_order: request.sort_order,
            created_at: existing.created_at,
            updated_at: timestamp.clone(),
        };

        let mut writes = Vec::new();
        if profile.is_default {
            clear_default_profiles(&mut profiles, &timestamp, &mut writes);
        }
        writes.push(profile.clone());
        self.config
            .apply_profile_change_set(&writes, &[])
            .map_err(config_file_error)?;
        Ok(profile)
    }

    /// 删除终端 Profile；至少保留一个本地 profile。
    pub fn delete_profile(&self, profile_id: &str) -> AppResult<bool> {
        self.reject_recovery_write()?;
        let mut profiles = self.list_profiles()?;
        if profiles.len() <= 1 {
            return Err(AppError::InvalidInput(
                "至少需要保留一个本地终端 Profile".to_owned(),
            ));
        }

        let Some(index) = profiles.iter().position(|profile| profile.id == profile_id) else {
            return Ok(false);
        };
        let removed = profiles.remove(index);
        let timestamp = timestamp_now();
        let mut writes = Vec::new();
        if removed.is_default && !profiles.iter().any(|profile| profile.is_default) {
            if let Some(next_default) = profiles.first_mut() {
                next_default.is_default = true;
                next_default.updated_at = timestamp;
                writes.push(next_default.clone());
            }
        }

        self.config
            .apply_profile_change_set(&writes, &[removed.id])
            .map_err(config_file_error)?;
        Ok(true)
    }

    /// 损坏 profile 集合使用进程内 shell 探测结果，并拒绝一切持久化修改。
    pub fn enter_read_only_recovery(&self) -> AppResult<()> {
        *self
            .read_only_fallback
            .write()
            .map_err(|_| AppError::StateLockPoisoned("profile_recovery"))? =
            Some(self.default_profiles());
        Ok(())
    }

    fn reject_recovery_write(&self) -> AppResult<()> {
        if self
            .read_only_fallback
            .read()
            .map_err(|_| AppError::StateLockPoisoned("profile_recovery"))?
            .is_some()
        {
            return Err(AppError::InvalidInput(
                "profiles/*.toml 处于只读恢复；请修复原文件并重新启动 Kerminal".to_owned(),
            ));
        }
        Ok(())
    }

    fn default_profiles(&self) -> Vec<TerminalProfile> {
        let timestamp = timestamp_now();
        self.detect_shells()
            .into_iter()
            .enumerate()
            .map(|(index, candidate)| TerminalProfile {
                id: format!("profile-{}", candidate.id),
                name: candidate.name,
                shell: candidate.shell,
                args: candidate.args,
                cwd: None,
                env: HashMap::new(),
                is_default: index == 0,
                sidebar_group_id: None,
                sort_order: ((index + 1) * 10) as i64,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            })
            .collect()
    }
}

fn clear_default_profiles(
    profiles: &mut [TerminalProfile],
    timestamp: &str,
    writes: &mut Vec<TerminalProfile>,
) {
    for profile in profiles {
        if profile.is_default {
            profile.is_default = false;
            profile.updated_at = timestamp.to_owned();
            writes.push(profile.clone());
        }
    }
}

fn next_profile_sort_order(profiles: &[TerminalProfile]) -> i64 {
    profiles
        .iter()
        .map(|profile| profile.sort_order)
        .max()
        .unwrap_or(0)
        + 10
}

fn timestamp_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}

fn detect_shell_candidates() -> Vec<ShellCandidate> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for definition in platform_shell_definitions() {
        push_candidate(&mut candidates, &mut seen, definition);
    }

    if candidates.is_empty() {
        let fallback = platform_fallback_shell();
        candidates.push(ShellCandidate {
            id: "fallback-shell".to_owned(),
            name: fallback.name.to_owned(),
            shell: fallback.command.to_owned(),
            args: fallback
                .args
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
            source: ShellCandidateSource::Fallback,
            is_available: Path::new(fallback.command).exists()
                || which::which(fallback.command).is_ok(),
            is_default: true,
        });
        return candidates;
    }

    for (index, candidate) in candidates.iter_mut().enumerate() {
        candidate.is_default = index == 0;
    }

    candidates
}

fn push_candidate(
    candidates: &mut Vec<ShellCandidate>,
    seen: &mut HashSet<String>,
    definition: ShellDefinition,
) {
    let Some(detected) = detect_shell_definition(&definition) else {
        return;
    };
    let key = normalize_shell_key(&detected.shell, &detected.args);
    if !seen.insert(key) {
        return;
    }

    candidates.push(ShellCandidate {
        id: definition.id.to_owned(),
        name: definition.name.to_owned(),
        shell: detected.shell,
        args: detected.args,
        source: detected.source,
        is_available: true,
        is_default: false,
    });
}

fn detect_shell_definition(definition: &ShellDefinition) -> Option<DetectedShellDefinition> {
    let probe_path = detect_probe_path(definition)?;
    let (shell, source) = detect_shell_path(definition)?;
    let args = definition
        .args
        .iter()
        .map(|value| {
            if *value == probe_path_arg_marker() {
                probe_path.clone()
            } else {
                Some((*value).to_owned())
            }
        })
        .collect::<Option<Vec<_>>>()?;

    Some(DetectedShellDefinition {
        shell,
        args,
        source,
    })
}

fn detect_probe_path(definition: &ShellDefinition) -> Option<Option<String>> {
    if definition.probe_paths.is_empty() {
        return Some(None);
    }

    for path in definition.probe_paths {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(Some(path_to_string(path)));
        }
    }
    None
}

fn detect_shell_path(definition: &ShellDefinition) -> Option<(String, ShellCandidateSource)> {
    if definition.command.starts_with(env_marker()) {
        let var_name = definition.command.trim_start_matches(env_marker());
        let value = env::var(var_name).ok()?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some((trimmed.to_owned(), ShellCandidateSource::Environment));
    }

    if let Ok(path) = which::which(definition.command) {
        return Some((path_to_string(path), ShellCandidateSource::Path));
    }

    for path in definition.common_paths {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some((path_to_string(path), ShellCandidateSource::CommonPath));
        }
    }

    None
}

fn normalize_required_text(field: &str, value: String) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    Ok(value)
}

fn normalize_cwd(cwd: Option<String>) -> AppResult<Option<String>> {
    let Some(cwd) = cwd else {
        return Ok(None);
    };
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Ok(None);
    }

    let path = PathBuf::from(cwd);
    if !path.exists() {
        return Err(AppError::InvalidInput("工作目录不存在".to_owned()));
    }
    if !path.is_dir() {
        return Err(AppError::InvalidInput("工作目录必须是文件夹".to_owned()));
    }

    Ok(Some(path_to_string(path)))
}

fn normalize_env(env: HashMap<String, String>) -> AppResult<HashMap<String, String>> {
    let mut normalized = HashMap::new();
    for (key, value) in env {
        let key = key.trim().to_owned();
        if key.is_empty() || key.contains('=') {
            return Err(AppError::InvalidInput(
                "环境变量名称不能为空，且不能包含 =".to_owned(),
            ));
        }
        normalized.insert(key, value);
    }
    Ok(normalized)
}

fn normalize_sidebar_group_id(
    sidebar_group_id: Option<String>,
    existing: Option<String>,
) -> Option<String> {
    match sidebar_group_id {
        Some(value) => {
            let value = value.trim();
            if value.is_empty() {
                None
            } else {
                Some(value.to_owned())
            }
        }
        None => existing,
    }
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn normalize_shell_key(shell: &str, args: &[String]) -> String {
    #[cfg(target_os = "windows")]
    {
        format!(
            "{}\x1f{}",
            shell.to_lowercase(),
            args.join("\x1f").to_lowercase()
        )
    }

    #[cfg(not(target_os = "windows"))]
    {
        format!("{}\x1f{}", shell, args.join("\x1f"))
    }
}

fn env_marker() -> &'static str {
    "env:"
}

fn probe_path_arg_marker() -> &'static str {
    "{probe}"
}

struct DetectedShellDefinition {
    shell: String,
    args: Vec<String>,
    source: ShellCandidateSource,
}

#[derive(Clone, Copy)]
struct ShellDefinition {
    id: &'static str,
    name: &'static str,
    command: &'static str,
    args: &'static [&'static str],
    common_paths: &'static [&'static str],
    probe_paths: &'static [&'static str],
}

#[cfg(target_os = "windows")]
fn platform_shell_definitions() -> Vec<ShellDefinition> {
    vec![
        ShellDefinition {
            id: "pwsh",
            name: "PowerShell 7",
            command: "pwsh.exe",
            args: &[],
            common_paths: &[
                r"C:\Program Files\PowerShell\7\pwsh.exe",
                r"C:\Program Files (x86)\PowerShell\7\pwsh.exe",
            ],
            probe_paths: &[],
        },
        ShellDefinition {
            id: "windows-powershell",
            name: "Windows PowerShell",
            command: "powershell.exe",
            args: &[],
            common_paths: &[r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"],
            probe_paths: &[],
        },
        ShellDefinition {
            id: "cmd",
            name: "Command Prompt",
            command: "cmd.exe",
            args: &[],
            common_paths: &[r"C:\Windows\System32\cmd.exe"],
            probe_paths: &[],
        },
        ShellDefinition {
            id: "vs-dev-cmd",
            name: "VS Developer Command Prompt",
            command: "cmd.exe",
            args: &["/d", "/k", "{probe}"],
            common_paths: &[r"C:\Windows\System32\cmd.exe"],
            probe_paths: &[
                r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat",
                r"C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
                r"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
                r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
                r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\Common7\Tools\VsDevCmd.bat",
                r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\Common7\Tools\VsDevCmd.bat",
                r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\Common7\Tools\VsDevCmd.bat",
                r"C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat",
            ],
        },
        ShellDefinition {
            id: "wsl",
            name: "WSL",
            command: "wsl.exe",
            args: &[],
            common_paths: &[r"C:\Windows\System32\wsl.exe"],
            probe_paths: &[],
        },
        ShellDefinition {
            id: "git-bash",
            name: "Git Bash",
            command: "bash.exe",
            args: &[],
            common_paths: &[
                r"C:\Program Files\Git\bin\bash.exe",
                r"C:\Program Files\Git\usr\bin\bash.exe",
            ],
            probe_paths: &[],
        },
    ]
}

#[cfg(not(target_os = "windows"))]
fn platform_shell_definitions() -> Vec<ShellDefinition> {
    vec![
        ShellDefinition {
            id: "env-shell",
            name: "默认登录 Shell",
            command: "env:SHELL",
            args: &[],
            common_paths: &[],
            probe_paths: &[],
        },
        ShellDefinition {
            id: "zsh",
            name: "zsh",
            command: "zsh",
            args: &[],
            common_paths: &["/bin/zsh", "/usr/bin/zsh"],
            probe_paths: &[],
        },
        ShellDefinition {
            id: "bash",
            name: "bash",
            command: "bash",
            args: &[],
            common_paths: &["/bin/bash", "/usr/bin/bash"],
            probe_paths: &[],
        },
        ShellDefinition {
            id: "fish",
            name: "fish",
            command: "fish",
            args: &[],
            common_paths: &["/bin/fish", "/usr/bin/fish"],
            probe_paths: &[],
        },
        ShellDefinition {
            id: "sh",
            name: "sh",
            command: "sh",
            args: &[],
            common_paths: &["/bin/sh", "/usr/bin/sh"],
            probe_paths: &[],
        },
    ]
}

#[cfg(target_os = "windows")]
fn platform_fallback_shell() -> ShellDefinition {
    ShellDefinition {
        id: "windows-powershell",
        name: "Windows PowerShell",
        command: "powershell.exe",
        args: &[],
        common_paths: &[],
        probe_paths: &[],
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_fallback_shell() -> ShellDefinition {
    ShellDefinition {
        id: "sh",
        name: "sh",
        command: "/bin/sh",
        args: &[],
        common_paths: &[],
        probe_paths: &[],
    }
}
