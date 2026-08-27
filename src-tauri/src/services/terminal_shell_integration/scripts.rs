//! Shell discovery and integration-script materialization.
//! @author kongweiguang

use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
};
use uuid::Uuid;

use super::{
    AllowedShell, IntegratedShellKind, ShellIntegrationPlatform, ShellScriptFamily, BASH_SCRIPT,
    FISH_SCRIPT, KERMINAL_SHELL_INTEGRATION_ENV, POWERSHELL_SCRIPT, SHELL_INTEGRATION_DIR,
    ZSH_DOTDIR, ZSH_RC_SCRIPT, ZSH_SCRIPT,
};

pub(super) fn integration_args(
    kind: IntegratedShellKind,
    script_path: &Path,
    scripts: &ShellIntegrationScripts,
) -> Vec<String> {
    match kind {
        IntegratedShellKind::PowerShell7 | IntegratedShellKind::WindowsPowerShell => vec![
            "-NoLogo".to_owned(),
            "-NoExit".to_owned(),
            "-ExecutionPolicy".to_owned(),
            "Bypass".to_owned(),
            "-File".to_owned(),
            script_path.to_string_lossy().into_owned(),
        ],
        IntegratedShellKind::GitBash => vec![
            "--init-file".to_owned(),
            path_to_msys(script_path).unwrap_or_else(|| script_path.to_string_lossy().into_owned()),
            "-i".to_owned(),
        ],
        IntegratedShellKind::Bash => vec![
            "--init-file".to_owned(),
            script_path.to_string_lossy().into_owned(),
            "-i".to_owned(),
        ],
        IntegratedShellKind::Zsh => vec!["-i".to_owned()],
        IntegratedShellKind::Fish => vec![
            "--interactive".to_owned(),
            "--init-command".to_owned(),
            format!("source {}", fish_quote(&script_path.to_string_lossy())),
        ],
        IntegratedShellKind::WslBash => vec![
            "--exec".to_owned(),
            "bash".to_owned(),
            "--init-file".to_owned(),
            path_to_wsl(script_path).unwrap_or_else(|| script_path.to_string_lossy().into_owned()),
            "-i".to_owned(),
        ],
        IntegratedShellKind::WslZsh => vec![
            "--exec".to_owned(),
            "env".to_owned(),
            format!(
                "ZDOTDIR={}",
                path_to_wsl(&scripts.zsh_dotdir)
                    .unwrap_or_else(|| scripts.zsh_dotdir.to_string_lossy().into_owned())
            ),
            "zsh".to_owned(),
            "-i".to_owned(),
        ],
        IntegratedShellKind::WslFish => vec![
            "--exec".to_owned(),
            "fish".to_owned(),
            "--interactive".to_owned(),
            "--init-command".to_owned(),
            format!(
                "source {}",
                fish_quote(
                    &path_to_wsl(script_path)
                        .unwrap_or_else(|| script_path.to_string_lossy().into_owned())
                )
            ),
        ],
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ShellIntegrationScripts {
    powershell: PathBuf,
    bash: PathBuf,
    zsh: PathBuf,
    fish: PathBuf,
    pub(super) zsh_dotdir: PathBuf,
}

impl ShellIntegrationScripts {
    pub(super) fn script_path_for(&self, kind: IntegratedShellKind) -> &Path {
        match kind.script_family() {
            ShellScriptFamily::PowerShell => &self.powershell,
            ShellScriptFamily::Bash => &self.bash,
            ShellScriptFamily::Zsh => &self.zsh,
            ShellScriptFamily::Fish => &self.fish,
        }
    }
}

pub(super) fn ensure_shell_integration_scripts(
    cache_dir: &Path,
    platform: ShellIntegrationPlatform,
) -> io::Result<ShellIntegrationScripts> {
    let root = cache_dir.join(SHELL_INTEGRATION_DIR);
    fs::create_dir_all(&root)?;
    let scripts = ShellIntegrationScripts {
        powershell: root.join(POWERSHELL_SCRIPT),
        bash: root.join(BASH_SCRIPT),
        zsh: root.join(ZSH_SCRIPT),
        fish: root.join(FISH_SCRIPT),
        zsh_dotdir: root.join(ZSH_DOTDIR),
    };

    write_script_atomic(&scripts.powershell, powershell_script())?;
    write_script_atomic(&scripts.bash, bash_script())?;
    write_script_atomic(&scripts.zsh, zsh_script())?;
    write_script_atomic(&scripts.fish, fish_script())?;

    fs::create_dir_all(&scripts.zsh_dotdir)?;
    write_script_atomic(
        &scripts.zsh_dotdir.join(ZSH_RC_SCRIPT),
        &zsh_dotdir_script(&scripts.zsh, platform),
    )?;

    Ok(scripts)
}

fn write_script_atomic(path: &Path, content: &str) -> io::Result<()> {
    if fs::read_to_string(path).is_ok_and(|current| current == content) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    fs::write(&tmp_path, content)?;
    replace_file_atomic(&tmp_path, path)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_file_atomic(tmp_path: &Path, path: &Path) -> io::Result<()> {
    fs::rename(tmp_path, path)
}

#[cfg(target_os = "windows")]
fn replace_file_atomic(tmp_path: &Path, path: &Path) -> io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let tmp_wide = wide_null(tmp_path.as_os_str());
    let path_wide = wide_null(path.as_os_str());
    let ok = unsafe {
        MoveFileExW(
            tmp_wide.as_ptr(),
            path_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        let error = io::Error::last_os_error();
        let _ = fs::remove_file(tmp_path);
        return Err(error);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn wide_null(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    value.encode_wide().chain(std::iter::once(0)).collect()
}

pub(super) fn detect_allowed_shells(platform: ShellIntegrationPlatform) -> Vec<AllowedShell> {
    match platform {
        ShellIntegrationPlatform::Windows => detect_windows_shells(),
        ShellIntegrationPlatform::Unix => detect_unix_shells(),
    }
}

fn detect_windows_shells() -> Vec<AllowedShell> {
    let mut entries = Vec::new();
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::PowerShell7,
        "pwsh.exe",
        &[
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            r"C:\Program Files (x86)\PowerShell\7\pwsh.exe",
        ],
        ["pwsh", "pwsh.exe", "powershell7", "powershell-core"],
    );
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::WindowsPowerShell,
        "powershell.exe",
        &[r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"],
        ["powershell", "powershell.exe", "windows-powershell"],
    );
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::GitBash,
        "bash.exe",
        &[
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\Git\usr\bin\bash.exe",
        ],
        ["git-bash", "gitBash", "bash.exe"],
    );
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::WslBash,
        "wsl.exe",
        &[r"C:\Windows\System32\wsl.exe"],
        ["wsl", "wsl.exe", "wsl:bash", "wslBash"],
    );
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::WslZsh,
        "wsl.exe",
        &[r"C:\Windows\System32\wsl.exe"],
        ["wsl:zsh", "wslZsh"],
    );
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::WslFish,
        "wsl.exe",
        &[r"C:\Windows\System32\wsl.exe"],
        ["wsl:fish", "wslFish"],
    );
    entries
}

fn detect_unix_shells() -> Vec<AllowedShell> {
    let mut entries = Vec::new();
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::Zsh,
        "zsh",
        &["/bin/zsh", "/usr/bin/zsh"],
        ["zsh"],
    );
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::Bash,
        "bash",
        &["/bin/bash", "/usr/bin/bash"],
        ["bash"],
    );
    push_detected_shell(
        &mut entries,
        IntegratedShellKind::Fish,
        "fish",
        &["/bin/fish", "/usr/bin/fish"],
        ["fish"],
    );
    entries
}

fn push_detected_shell<const N: usize>(
    entries: &mut Vec<AllowedShell>,
    kind: IntegratedShellKind,
    command: &str,
    common_paths: &[&str],
    aliases: [&str; N],
) {
    if entries.iter().any(|entry| entry.kind == kind) {
        return;
    }
    if let Ok(path) = which::which(command) {
        entries.push(AllowedShell::new(kind, path, aliases));
        return;
    }
    for path in common_paths {
        let path = PathBuf::from(path);
        if path.exists() {
            entries.push(AllowedShell::new(kind, path, aliases));
            return;
        }
    }
}

pub(super) fn shell_integration_disabled_by_env(env: &HashMap<String, String>) -> bool {
    env.get(KERMINAL_SHELL_INTEGRATION_ENV)
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            value == "0" || value == "false" || value == "off" || value == "disabled"
        })
        .unwrap_or(false)
}

pub(super) fn looks_like_path_override(value: &str) -> bool {
    value.contains('/') || value.contains('\\') || value.contains(':')
}

pub(super) fn shell_text_eq(left: &str, right_lower: &str) -> bool {
    left.eq_ignore_ascii_case(right_lower)
}

pub(super) fn same_path(left: &Path, right: &Path) -> bool {
    let left = left.to_string_lossy();
    let right = right.to_string_lossy();
    if cfg!(target_os = "windows") {
        left.eq_ignore_ascii_case(&right)
    } else {
        left == right
    }
}

fn path_to_msys(path: &Path) -> Option<String> {
    windows_drive_path(path).map(|(drive, tail)| format!("/{drive}/{tail}"))
}

fn path_to_wsl(path: &Path) -> Option<String> {
    windows_drive_path(path).map(|(drive, tail)| format!("/mnt/{drive}/{tail}"))
}

fn windows_drive_path(path: &Path) -> Option<(char, String)> {
    let raw = path.to_string_lossy().replace('\\', "/");
    let mut chars = raw.chars();
    let drive = chars.next()?.to_ascii_lowercase();
    if !drive.is_ascii_alphabetic() || chars.next()? != ':' {
        return None;
    }
    let tail = chars.as_str().trim_start_matches('/').to_owned();
    Some((drive, tail))
}

fn fish_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "\\'"))
}

fn powershell_script() -> &'static str {
    r#"$env:KERMINAL_TERMINAL = "1"
$env:KERMINAL_SHELL_INTEGRATION = "1"
function global:__kerminal_osc([string]$Value) {
  [Console]::Out.Write("$([char]27)]$Value$([char]7)")
}
function global:__kerminal_sanitize_command([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  return (($Value -replace '[\x00-\x1f\x7f]', ' ').Trim())
}
function global:__kerminal_cwd_uri {
  try {
    $path = (Get-Location).ProviderPath
    if ([string]::IsNullOrWhiteSpace($path)) { return "" }
    $uri = [System.Uri]::new($path).AbsoluteUri
    return $uri
  } catch {
    return ""
  }
}
$global:__kerminal_command_started = $false
try {
  Set-PSReadLineOption -AddToHistoryHandler {
    param([string]$Line)
    $command = __kerminal_sanitize_command $Line
    if (-not [string]::IsNullOrWhiteSpace($command)) {
      __kerminal_osc "133;C;$command"
      $global:__kerminal_command_started = $true
    }
    return $true
  }
} catch {}
function global:prompt {
  if ($global:__kerminal_command_started) {
    $exitCode = if ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } else { 0 }
    __kerminal_osc "133;D;$exitCode"
    $global:__kerminal_command_started = $false
  }
  __kerminal_osc "133;A"
  $cwdUri = __kerminal_cwd_uri
  if ($cwdUri) { __kerminal_osc "7;$cwdUri" }
  __kerminal_osc "133;B"
  "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
}
"#
}

fn bash_script() -> &'static str {
    r#"export KERMINAL_TERMINAL=1
export KERMINAL_SHELL_INTEGRATION=1
if [ -r "$HOME/.bashrc" ] && [ -z "${KERMINAL_BASHRC_SOURCED:-}" ]; then
  export KERMINAL_BASHRC_SOURCED=1
  . "$HOME/.bashrc"
fi
__kerminal_osc() { printf '\033]%s\a' "$1"; }
__kerminal_sanitize_command() {
  local command="$1"
  command="${command//$'\033'/ }"
  command="${command//$'\a'/ }"
  command="${command//$'\r'/ }"
  command="${command//$'\n'/ }"
  command="${command//$'\t'/ }"
  printf '%s' "$command"
}
__kerminal_cwd_uri() { printf 'file://%s%s' "${HOSTNAME:-localhost}" "$PWD"; }
__kerminal_prompt() {
  local status=$?
  if [ "${__kerminal_in_command:-0}" = "1" ]; then
    __kerminal_osc "133;D;$status"
    __kerminal_in_command=0
  fi
  __kerminal_osc "133;A"
  __kerminal_osc "7;$(__kerminal_cwd_uri)"
  __kerminal_osc "133;B"
}
__kerminal_preexec() {
  case "$BASH_COMMAND" in
    __kerminal_*|"$PROMPT_COMMAND") return ;;
  esac
  if [ "${__kerminal_in_command:-0}" != "1" ]; then
    local command
    command="$(__kerminal_sanitize_command "$BASH_COMMAND")"
    if [ -n "$command" ]; then
      __kerminal_osc "133;C;$command"
      __kerminal_in_command=1
    fi
  fi
}
PROMPT_COMMAND="__kerminal_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
trap '__kerminal_preexec' DEBUG
"#
}

/// 生成 zsh shell integration；退出码必须避开 zsh 的只读特殊参数 `status`，
/// 否则每次 `precmd` 都会报错并污染 TUI 退出后的提示符。
fn zsh_script() -> &'static str {
    r#"export KERMINAL_TERMINAL=1
export KERMINAL_SHELL_INTEGRATION=1
__kerminal_osc() { printf '\033]%s\a' "$1"; }
__kerminal_sanitize_command() {
  local command="$1"
  command="${command//$'\033'/ }"
  command="${command//$'\a'/ }"
  command="${command//$'\r'/ }"
  command="${command//$'\n'/ }"
  command="${command//$'\t'/ }"
  print -r -- "$command"
}
__kerminal_cwd_uri() { printf 'file://%s%s' "${HOST:-localhost}" "$PWD"; }
__kerminal_preexec() {
  local command
  command="$(__kerminal_sanitize_command "$1")"
  if [ -n "$command" ]; then
    __kerminal_osc "133;C;$command"
  fi
}
__kerminal_precmd() {
  local command_status=$?
  __kerminal_osc "133;D;$command_status"
  __kerminal_osc "133;A"
  __kerminal_osc "7;$(__kerminal_cwd_uri)"
  __kerminal_osc "133;B"
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec __kerminal_preexec
add-zsh-hook precmd __kerminal_precmd
"#
}

fn fish_script() -> &'static str {
    r#"set -gx KERMINAL_TERMINAL 1
set -gx KERMINAL_SHELL_INTEGRATION 1
function __kerminal_osc
  printf '\e]%s\a' $argv[1]
end
function __kerminal_sanitize_command
  set -l command (string replace -a (printf '\e') ' ' -- $argv[1])
  set command (string replace -a (printf '\a') ' ' -- $command)
  set command (string replace -a \r ' ' -- $command)
  set command (string replace -a \n ' ' -- $command)
  set command (string replace -a \t ' ' -- $command)
  string trim -- $command
end
function __kerminal_cwd_uri
  printf 'file://%s%s' (hostname) (pwd)
end
function __kerminal_preexec --on-event fish_preexec
  set -l command (__kerminal_sanitize_command "$argv[1]")
  if test -n "$command"
    __kerminal_osc "133;C;$command"
  end
end
function __kerminal_postexec --on-event fish_postexec
  __kerminal_osc "133;D;$status"
end
if functions -q fish_prompt
  functions -c fish_prompt __kerminal_user_fish_prompt
end
function fish_prompt
  __kerminal_osc '133;A'
  __kerminal_osc "7;"(__kerminal_cwd_uri)
  __kerminal_osc '133;B'
  if functions -q __kerminal_user_fish_prompt
    __kerminal_user_fish_prompt
  end
end
"#
}

fn zsh_dotdir_script(script_path: &Path, platform: ShellIntegrationPlatform) -> String {
    let source_path = match platform {
        ShellIntegrationPlatform::Windows => path_to_wsl(script_path)
            .or_else(|| path_to_msys(script_path))
            .unwrap_or_else(|| script_path.to_string_lossy().into_owned()),
        ShellIntegrationPlatform::Unix => script_path.to_string_lossy().into_owned(),
    };
    format!(
        "if [ -r \"$HOME/.zshrc\" ] && [ -z \"${{KERMINAL_ZSHRC_SOURCED:-}}\" ]; then\n  export KERMINAL_ZSHRC_SOURCED=1\n  . \"$HOME/.zshrc\"\nfi\n. {}\n",
        shell_quote(&source_path)
    )
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
