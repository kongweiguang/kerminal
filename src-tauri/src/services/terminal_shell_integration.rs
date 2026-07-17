//! Local shell integration launch planning.
//!
//! @author kongweiguang

use crate::models::terminal::{TerminalShellIntegrationStatus, TerminalShellIntegrationSummary};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
mod scripts;

use scripts::{
    detect_allowed_shells, ensure_shell_integration_scripts, integration_args,
    looks_like_path_override, same_path, shell_integration_disabled_by_env, shell_text_eq,
    ShellIntegrationScripts,
};

pub const KERMINAL_TERMINAL_ENV: &str = "KERMINAL_TERMINAL";
pub const KERMINAL_SHELL_INTEGRATION_ENV: &str = "KERMINAL_SHELL_INTEGRATION";

const SHELL_INTEGRATION_DIR: &str = "shell-integration";
const POWERSHELL_SCRIPT: &str = "kerminal-shell-integration.ps1";
const BASH_SCRIPT: &str = "kerminal-shell-integration.bash";
const ZSH_SCRIPT: &str = "kerminal-shell-integration.zsh";
const FISH_SCRIPT: &str = "kerminal-shell-integration.fish";
const ZSH_DOTDIR: &str = "zsh-dotdir";
const ZSH_RC_SCRIPT: &str = ".zshrc";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalShellLaunchPlan {
    pub shell: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub integration: TerminalShellIntegrationSummary,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellIntegrationPlatform {
    Windows,
    Unix,
}

impl ShellIntegrationPlatform {
    pub fn current() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self::Windows
        }

        #[cfg(not(target_os = "windows"))]
        {
            Self::Unix
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegratedShellKind {
    PowerShell7,
    WindowsPowerShell,
    GitBash,
    WslBash,
    WslZsh,
    WslFish,
    Zsh,
    Bash,
    Fish,
}

impl IntegratedShellKind {
    fn id(self) -> &'static str {
        match self {
            Self::PowerShell7 => "powershell7",
            Self::WindowsPowerShell => "windowsPowerShell",
            Self::GitBash => "gitBash",
            Self::WslBash => "wslBash",
            Self::WslZsh => "wslZsh",
            Self::WslFish => "wslFish",
            Self::Zsh => "zsh",
            Self::Bash => "bash",
            Self::Fish => "fish",
        }
    }

    fn script_family(self) -> ShellScriptFamily {
        match self {
            Self::PowerShell7 | Self::WindowsPowerShell => ShellScriptFamily::PowerShell,
            Self::GitBash | Self::WslBash | Self::Bash => ShellScriptFamily::Bash,
            Self::WslZsh | Self::Zsh => ShellScriptFamily::Zsh,
            Self::WslFish | Self::Fish => ShellScriptFamily::Fish,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellScriptFamily {
    PowerShell,
    Bash,
    Zsh,
    Fish,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellIntegrationCatalog {
    platform: ShellIntegrationPlatform,
    entries: Vec<AllowedShell>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowedShell {
    kind: IntegratedShellKind,
    executable: PathBuf,
    canonical_executable: PathBuf,
    aliases: Vec<String>,
}

impl AllowedShell {
    pub fn new(
        kind: IntegratedShellKind,
        executable: impl Into<PathBuf>,
        aliases: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let executable = executable.into();
        let canonical_executable =
            fs::canonicalize(&executable).unwrap_or_else(|_| executable.clone());
        Self {
            kind,
            canonical_executable,
            executable,
            aliases: aliases.into_iter().map(Into::into).collect(),
        }
    }
}

impl ShellIntegrationCatalog {
    pub fn detect_current() -> Self {
        Self {
            platform: ShellIntegrationPlatform::current(),
            entries: detect_allowed_shells(ShellIntegrationPlatform::current()),
        }
    }
    /// 从显式平台与允许列表构造目录，供受控运行时和集成测试注入发现结果。
    pub fn new(platform: ShellIntegrationPlatform, entries: Vec<AllowedShell>) -> Self {
        Self { platform, entries }
    }

    fn find(&self, requested_shell: &str) -> Option<&AllowedShell> {
        let requested_shell = requested_shell.trim();
        if requested_shell.is_empty() {
            return None;
        }
        let requested_lower = requested_shell.to_ascii_lowercase();
        let path_override = looks_like_path_override(requested_shell);
        let requested_canonical = if path_override {
            fs::canonicalize(requested_shell).ok()
        } else {
            None
        };

        for entry in &self.entries {
            if entry
                .aliases
                .iter()
                .any(|alias| shell_text_eq(alias, &requested_lower))
            {
                return Some(entry);
            }
            if !path_override && shell_text_eq(entry.kind.id(), &requested_lower) {
                return Some(entry);
            }
            if !path_override
                && entry
                    .executable
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| shell_text_eq(name, &requested_lower))
            {
                return Some(entry);
            }
            if let Some(requested_canonical) = &requested_canonical {
                if same_path(requested_canonical, &entry.canonical_executable) {
                    return Some(entry);
                }
            }
        }

        None
    }
}

pub fn build_terminal_shell_launch(
    shell: &str,
    args: &[String],
    env: &HashMap<String, String>,
    cache_dir: &Path,
) -> TerminalShellLaunchPlan {
    build_terminal_shell_launch_with_catalog(
        shell,
        args,
        env,
        cache_dir,
        &ShellIntegrationCatalog::detect_current(),
    )
}

pub fn build_terminal_shell_launch_with_catalog(
    shell: &str,
    args: &[String],
    env: &HashMap<String, String>,
    cache_dir: &Path,
    catalog: &ShellIntegrationCatalog,
) -> TerminalShellLaunchPlan {
    if shell_integration_disabled_by_env(env) {
        return bare_launch(shell, args, env, "disabled by environment");
    }
    if !args.is_empty() {
        return bare_launch(shell, args, env, "custom shell arguments");
    }

    let Some(entry) = catalog.find(shell).cloned() else {
        return bare_launch(shell, args, env, "unsupported shell");
    };

    match ensure_shell_integration_scripts(cache_dir, catalog.platform) {
        Ok(scripts) => integrated_launch(shell, env, &entry, &scripts, catalog.platform),
        Err(error) => bare_launch(shell, args, env, &format!("script setup failed: {error}")),
    }
}

fn integrated_launch(
    requested_shell: &str,
    env: &HashMap<String, String>,
    entry: &AllowedShell,
    scripts: &ShellIntegrationScripts,
    _platform: ShellIntegrationPlatform,
) -> TerminalShellLaunchPlan {
    let mut next_env = terminal_capability_env(env);
    next_env.insert(KERMINAL_SHELL_INTEGRATION_ENV.to_owned(), "1".to_owned());
    if entry.kind == IntegratedShellKind::Zsh {
        next_env.insert(
            "ZDOTDIR".to_owned(),
            scripts.zsh_dotdir.to_string_lossy().into_owned(),
        );
    }

    let script_path = scripts.script_path_for(entry.kind);
    let args = integration_args(entry.kind, script_path, scripts);
    TerminalShellLaunchPlan {
        shell: entry.executable.to_string_lossy().into_owned(),
        args,
        env: next_env,
        integration: TerminalShellIntegrationSummary {
            status: TerminalShellIntegrationStatus::Enabled,
            shell: Some(entry.kind.id().to_owned()),
            script_path: Some(script_path.to_string_lossy().into_owned()),
            reason: None,
        },
    }
    .with_requested_shell_fallback(requested_shell)
}

trait RequestedShellFallback {
    fn with_requested_shell_fallback(self, requested_shell: &str) -> Self;
}

impl RequestedShellFallback for TerminalShellLaunchPlan {
    fn with_requested_shell_fallback(mut self, requested_shell: &str) -> Self {
        if self.shell.trim().is_empty() {
            self.shell = requested_shell.to_owned();
        }
        self
    }
}

fn bare_launch(
    shell: &str,
    args: &[String],
    env: &HashMap<String, String>,
    reason: &str,
) -> TerminalShellLaunchPlan {
    TerminalShellLaunchPlan {
        shell: shell.to_owned(),
        args: args.to_vec(),
        env: terminal_capability_env(env),
        integration: TerminalShellIntegrationSummary {
            status: TerminalShellIntegrationStatus::Disabled,
            shell: None,
            script_path: None,
            reason: Some(reason.to_owned()),
        },
    }
}

/// shell integration 只增强提示符协议；所有本地 PTY 都必须声明真实终端能力。
/// 否则自定义 shell 参数等 bare launch 路径会继承宿主进程的 `TERM=dumb`，导致
/// Codex 等 inline TUI 关闭颜色、同步刷新和光标定位能力。
fn terminal_capability_env(env: &HashMap<String, String>) -> HashMap<String, String> {
    let mut next_env = env.clone();
    next_env.insert(KERMINAL_TERMINAL_ENV.to_owned(), "1".to_owned());

    let replace_term = next_env
        .get("TERM")
        .map(|value| {
            let value = value.trim();
            value.is_empty() || value.eq_ignore_ascii_case("dumb")
        })
        .unwrap_or(true);
    if replace_term {
        next_env.insert("TERM".to_owned(), "xterm-256color".to_owned());
    }

    let replace_colorterm = next_env
        .get("COLORTERM")
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    if replace_colorterm {
        next_env.insert("COLORTERM".to_owned(), "truecolor".to_owned());
    }

    let replace_term_program = next_env
        .get("TERM_PROGRAM")
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    if replace_term_program {
        next_env.insert("TERM_PROGRAM".to_owned(), "Kerminal".to_owned());
    }
    let replace_term_program_version = next_env
        .get("TERM_PROGRAM_VERSION")
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    if replace_term_program_version {
        next_env.insert(
            "TERM_PROGRAM_VERSION".to_owned(),
            env!("CARGO_PKG_VERSION").to_owned(),
        );
    }

    next_env
}
