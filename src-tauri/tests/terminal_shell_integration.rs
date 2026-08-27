//! Shell integration launch planning tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::TerminalShellIntegrationStatus,
    services::terminal_shell_integration::{
        build_terminal_shell_launch_with_catalog, AllowedShell, IntegratedShellKind,
        ShellIntegrationCatalog, ShellIntegrationPlatform, KERMINAL_SHELL_INTEGRATION_ENV,
        KERMINAL_TERMINAL_ENV,
    },
};
#[cfg(target_os = "windows")]
use std::process::{Command, Stdio};
use std::{collections::HashMap, fs, path::PathBuf};
use tempfile::tempdir;

#[test]
fn builds_windows_powershell7_command_with_kerminal_env_and_script() {
    let temp = tempdir().unwrap();
    let pwsh = fake_executable(temp.path().join("pwsh.exe"));
    let cache = temp.path().join("cache");
    let plan = build_terminal_shell_launch_with_catalog(
        "pwsh.exe",
        &[],
        &HashMap::from([("TERM".to_owned(), "dumb".to_owned())]),
        &cache,
        &catalog(
            ShellIntegrationPlatform::Windows,
            vec![AllowedShell::new(
                IntegratedShellKind::PowerShell7,
                pwsh.clone(),
                ["pwsh", "pwsh.exe"],
            )],
        ),
    );

    assert_eq!(plan.shell, pwsh.to_string_lossy());
    assert_eq!(
        plan.integration.status,
        TerminalShellIntegrationStatus::Enabled
    );
    assert_eq!(plan.integration.shell.as_deref(), Some("powershell7"));
    assert_eq!(
        plan.args[..5],
        ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-File"],
    );
    assert_eq!(
        plan.env.get(KERMINAL_TERMINAL_ENV).map(String::as_str),
        Some("1")
    );
    assert_eq!(
        plan.env
            .get(KERMINAL_SHELL_INTEGRATION_ENV)
            .map(String::as_str),
        Some("1")
    );
    assert_eq!(
        plan.env.get("TERM").map(String::as_str),
        Some("xterm-256color")
    );
    assert_eq!(
        plan.env.get("COLORTERM").map(String::as_str),
        Some("truecolor")
    );
    assert!(script_path(&plan).exists());
    assert!(fs::read_to_string(script_path(&plan))
        .unwrap()
        .contains(KERMINAL_SHELL_INTEGRATION_ENV));
}

#[test]
/// 同时锁定命令净化和退出码变量约束，避免生成脚本再次使用 zsh 的只读 `status`。
fn shell_integration_scripts_emit_command_start_with_sanitized_payload() {
    let temp = tempdir().unwrap();
    let cache = temp.path().join("cache");
    let pwsh = fake_executable(temp.path().join("pwsh.exe"));
    let bash = fake_executable(temp.path().join("bash"));
    let zsh = fake_executable(temp.path().join("zsh"));
    let fish = fake_executable(temp.path().join("fish"));

    let powershell_plan = build_terminal_shell_launch_with_catalog(
        "pwsh.exe",
        &[],
        &HashMap::new(),
        &cache,
        &catalog(
            ShellIntegrationPlatform::Windows,
            vec![AllowedShell::new(
                IntegratedShellKind::PowerShell7,
                pwsh,
                ["pwsh.exe"],
            )],
        ),
    );
    let bash_plan = build_terminal_shell_launch_with_catalog(
        "bash",
        &[],
        &HashMap::new(),
        &cache,
        &catalog(
            ShellIntegrationPlatform::Unix,
            vec![AllowedShell::new(IntegratedShellKind::Bash, bash, ["bash"])],
        ),
    );
    let zsh_plan = build_terminal_shell_launch_with_catalog(
        "zsh",
        &[],
        &HashMap::new(),
        &cache,
        &catalog(
            ShellIntegrationPlatform::Unix,
            vec![AllowedShell::new(IntegratedShellKind::Zsh, zsh, ["zsh"])],
        ),
    );
    let fish_plan = build_terminal_shell_launch_with_catalog(
        "fish",
        &[],
        &HashMap::new(),
        &cache,
        &catalog(
            ShellIntegrationPlatform::Unix,
            vec![AllowedShell::new(IntegratedShellKind::Fish, fish, ["fish"])],
        ),
    );

    let powershell = fs::read_to_string(script_path(&powershell_plan)).unwrap();
    let bash = fs::read_to_string(script_path(&bash_plan)).unwrap();
    let zsh = fs::read_to_string(script_path(&zsh_plan)).unwrap();
    let fish = fs::read_to_string(script_path(&fish_plan)).unwrap();

    assert!(powershell.contains("__kerminal_sanitize_command $Line"));
    assert!(powershell.contains("__kerminal_osc \"133;C;$command\""));
    assert!(bash.contains("command=\"$(__kerminal_sanitize_command \"$BASH_COMMAND\")\""));
    assert!(bash.contains("__kerminal_osc \"133;C;$command\""));
    assert!(zsh.contains("command=\"$(__kerminal_sanitize_command \"$1\")\""));
    assert!(zsh.contains("__kerminal_osc \"133;C;$command\""));
    assert!(zsh.contains("local command_status=$?"));
    assert!(zsh.contains("__kerminal_osc \"133;D;$command_status\""));
    assert!(!zsh.contains("local status=$?"));
    assert!(fish.contains("set -l command (__kerminal_sanitize_command \"$argv[1]\")"));
    assert!(fish.contains("__kerminal_osc \"133;C;$command\""));
}

#[cfg(target_os = "windows")]
#[test]
/// 在真实 WSL zsh 中执行生成的 hook，证明非零退出码可上报且不会触碰只读参数。
fn generated_zsh_precmd_runs_in_wsl_without_read_only_parameter_errors() {
    let zsh_available = Command::new("wsl.exe")
        .args(["-e", "sh", "-lc", "command -v zsh >/dev/null 2>&1"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if !zsh_available {
        println!("WSL zsh unavailable; skipping real generated-hook execution");
        return;
    }

    let temp = tempdir().expect("create shell integration temp dir");
    let plan = build_terminal_shell_launch_with_catalog(
        "wsl:zsh",
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog(
            ShellIntegrationPlatform::Windows,
            vec![AllowedShell::new(
                IntegratedShellKind::WslZsh,
                "wsl.exe",
                ["wsl:zsh"],
            )],
        ),
    );
    let script = script_path(&plan);
    let converted = Command::new("wsl.exe")
        .args(["-e", "wslpath", "-a"])
        .arg(&script)
        .output()
        .expect("convert generated script path for WSL");
    assert!(
        converted.status.success(),
        "wslpath failed: {}",
        String::from_utf8_lossy(&converted.stderr)
    );
    let wsl_script = String::from_utf8(converted.stdout)
        .expect("wslpath output must be UTF-8")
        .trim()
        .to_owned();
    let command = format!(
        ". '{}'; false; __kerminal_precmd",
        wsl_script.replace('\'', "'\\''")
    );
    let output = Command::new("wsl.exe")
        .args(["-e", "zsh", "-f", "-c", &command])
        .output()
        .expect("execute generated zsh hook in WSL");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(output.status.success(), "zsh hook failed: {stderr}");
    assert!(
        stdout.contains("\u{1b}]133;D;1\u{7}"),
        "zsh hook did not preserve the previous exit status: {stdout:?}"
    );
    assert!(
        !stderr.contains("read-only variable"),
        "zsh hook wrote a read-only special parameter: {stderr}"
    );
}

#[test]
fn disables_integration_for_custom_shell_args_and_preserves_bare_launch() {
    let temp = tempdir().unwrap();
    let shell = fake_executable(temp.path().join("powershell.exe"));
    let args = vec![
        "-NoProfile".to_owned(),
        "-Command".to_owned(),
        "echo ok".to_owned(),
    ];
    let env = HashMap::from([("CUSTOM".to_owned(), "value".to_owned())]);

    let plan = build_terminal_shell_launch_with_catalog(
        "powershell.exe",
        &args,
        &env,
        temp.path(),
        &catalog(
            ShellIntegrationPlatform::Windows,
            vec![AllowedShell::new(
                IntegratedShellKind::WindowsPowerShell,
                shell,
                ["powershell.exe"],
            )],
        ),
    );

    assert_eq!(plan.shell, "powershell.exe");
    assert_eq!(plan.args, args);
    assert_eq!(plan.env.get("CUSTOM").map(String::as_str), Some("value"));
    assert_eq!(
        plan.env.get(KERMINAL_TERMINAL_ENV).map(String::as_str),
        Some("1")
    );
    assert_eq!(
        plan.env.get("TERM").map(String::as_str),
        Some("xterm-256color")
    );
    assert_eq!(
        plan.env.get("COLORTERM").map(String::as_str),
        Some("truecolor")
    );
    assert_eq!(
        plan.env.get("TERM_PROGRAM").map(String::as_str),
        Some("Kerminal")
    );
    assert_eq!(
        plan.env.get("TERM_PROGRAM_VERSION").map(String::as_str),
        Some(env!("CARGO_PKG_VERSION"))
    );
    assert_eq!(
        plan.integration.status,
        TerminalShellIntegrationStatus::Disabled
    );
    assert_eq!(
        plan.integration.reason.as_deref(),
        Some("custom shell arguments")
    );
}

#[test]
fn path_override_must_canonicalize_to_allowed_shell() {
    let temp = tempdir().unwrap();
    let allowed = fake_executable(temp.path().join("bin").join("bash"));
    let unlisted = fake_executable(temp.path().join("other").join("bash"));
    let catalog = catalog(
        ShellIntegrationPlatform::Unix,
        vec![AllowedShell::new(
            IntegratedShellKind::Bash,
            allowed.clone(),
            ["bash"],
        )],
    );

    let enabled = build_terminal_shell_launch_with_catalog(
        &allowed.to_string_lossy(),
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog,
    );
    let disabled = build_terminal_shell_launch_with_catalog(
        &unlisted.to_string_lossy(),
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog,
    );

    assert_eq!(
        enabled.integration.status,
        TerminalShellIntegrationStatus::Enabled
    );
    assert_eq!(
        disabled.integration.status,
        TerminalShellIntegrationStatus::Disabled
    );
    assert_eq!(
        disabled.integration.reason.as_deref(),
        Some("unsupported shell")
    );
}

#[test]
fn builds_git_bash_launch_spec_with_msys_init_file() {
    let temp = tempdir().unwrap();
    let bash = fake_executable(temp.path().join("Git").join("bin").join("bash.exe"));
    let plan = build_terminal_shell_launch_with_catalog(
        "bash.exe",
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog(
            ShellIntegrationPlatform::Windows,
            vec![AllowedShell::new(
                IntegratedShellKind::GitBash,
                bash,
                ["bash.exe", "git-bash"],
            )],
        ),
    );

    assert_eq!(plan.integration.shell.as_deref(), Some("gitBash"));
    assert_eq!(plan.args.first().map(String::as_str), Some("--init-file"));
    assert_eq!(plan.args.last().map(String::as_str), Some("-i"));
    assert!(script_path(&plan).exists());
}

#[test]
fn builds_wsl_bash_zsh_and_fish_launch_specs() {
    let temp = tempdir().unwrap();
    let wsl = fake_executable(temp.path().join("wsl.exe"));
    let catalog = catalog(
        ShellIntegrationPlatform::Windows,
        vec![
            AllowedShell::new(
                IntegratedShellKind::WslBash,
                wsl.clone(),
                ["wsl.exe", "wsl:bash"],
            ),
            AllowedShell::new(IntegratedShellKind::WslZsh, wsl.clone(), ["wsl:zsh"]),
            AllowedShell::new(IntegratedShellKind::WslFish, wsl, ["wsl:fish"]),
        ],
    );

    let bash = build_terminal_shell_launch_with_catalog(
        "wsl.exe",
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog,
    );
    let zsh = build_terminal_shell_launch_with_catalog(
        "wsl:zsh",
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog,
    );
    let fish = build_terminal_shell_launch_with_catalog(
        "wsl:fish",
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog,
    );

    assert_eq!(
        bash.args[..3],
        [
            "--exec".to_owned(),
            "bash".to_owned(),
            "--init-file".to_owned()
        ],
    );
    assert_eq!(
        zsh.args[..4],
        [
            "--exec".to_owned(),
            "env".to_owned(),
            zsh.args[2].clone(),
            "zsh".to_owned(),
        ],
    );
    assert!(zsh.args[2].starts_with("ZDOTDIR="));
    assert!(fish
        .args
        .windows(2)
        .any(|window| window == ["--exec", "fish"]));
    assert!(fish.args.iter().any(|arg| arg.contains("source ")));
}

#[test]
fn builds_unix_bash_zsh_and_fish_launch_specs() {
    let temp = tempdir().unwrap();
    let bash = fake_executable(temp.path().join("bash"));
    let zsh = fake_executable(temp.path().join("zsh"));
    let fish = fake_executable(temp.path().join("fish"));
    let catalog = catalog(
        ShellIntegrationPlatform::Unix,
        vec![
            AllowedShell::new(IntegratedShellKind::Zsh, zsh, ["zsh"]),
            AllowedShell::new(IntegratedShellKind::Bash, bash, ["bash"]),
            AllowedShell::new(IntegratedShellKind::Fish, fish, ["fish"]),
        ],
    );

    let zsh_plan = build_terminal_shell_launch_with_catalog(
        "zsh",
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog,
    );
    let bash_plan = build_terminal_shell_launch_with_catalog(
        "bash",
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog,
    );
    let fish_plan = build_terminal_shell_launch_with_catalog(
        "fish",
        &[],
        &HashMap::new(),
        temp.path(),
        &catalog,
    );

    assert_eq!(zsh_plan.args, ["-i"]);
    assert!(zsh_plan.env.contains_key("ZDOTDIR"));
    assert_eq!(
        bash_plan.args.first().map(String::as_str),
        Some("--init-file")
    );
    assert_eq!(bash_plan.args.last().map(String::as_str), Some("-i"));
    assert_eq!(
        fish_plan.args[..2],
        ["--interactive".to_owned(), "--init-command".to_owned()],
    );
}

#[test]
fn script_setup_failure_disables_integration_without_failing_launch() {
    let temp = tempdir().unwrap();
    let bash = fake_executable(temp.path().join("bash"));
    let cache = temp.path().join("cache");
    fs::create_dir_all(&cache).unwrap();
    fs::write(cache.join("shell-integration"), "not a directory").unwrap();

    let plan = build_terminal_shell_launch_with_catalog(
        "bash",
        &[],
        &HashMap::new(),
        &cache,
        &catalog(
            ShellIntegrationPlatform::Unix,
            vec![AllowedShell::new(IntegratedShellKind::Bash, bash, ["bash"])],
        ),
    );

    assert_eq!(
        plan.integration.status,
        TerminalShellIntegrationStatus::Disabled
    );
    assert!(plan
        .integration
        .reason
        .as_deref()
        .unwrap_or_default()
        .starts_with("script setup failed:"));
    assert_eq!(plan.shell, "bash");
    assert!(plan.args.is_empty());
}

#[test]
fn kerminal_env_opt_out_disables_integration() {
    let temp = tempdir().unwrap();
    let bash = fake_executable(temp.path().join("bash"));
    let env = HashMap::from([(KERMINAL_SHELL_INTEGRATION_ENV.to_owned(), "off".to_owned())]);

    let plan = build_terminal_shell_launch_with_catalog(
        "bash",
        &[],
        &env,
        temp.path(),
        &catalog(
            ShellIntegrationPlatform::Unix,
            vec![AllowedShell::new(IntegratedShellKind::Bash, bash, ["bash"])],
        ),
    );

    assert_eq!(
        plan.integration.status,
        TerminalShellIntegrationStatus::Disabled
    );
    assert_eq!(
        plan.integration.reason.as_deref(),
        Some("disabled by environment")
    );
    assert_eq!(
        plan.env
            .get(KERMINAL_SHELL_INTEGRATION_ENV)
            .map(String::as_str),
        Some("off")
    );
    assert_eq!(
        plan.env.get(KERMINAL_TERMINAL_ENV).map(String::as_str),
        Some("1")
    );
    assert_eq!(
        plan.env.get("TERM").map(String::as_str),
        Some("xterm-256color")
    );
    assert_eq!(
        plan.env.get("COLORTERM").map(String::as_str),
        Some("truecolor")
    );
}

#[test]
fn bare_launch_preserves_explicit_terminal_capabilities() {
    let temp = tempdir().unwrap();
    let env = HashMap::from([
        ("TERM".to_owned(), "screen-256color".to_owned()),
        ("COLORTERM".to_owned(), "24bit".to_owned()),
        ("TERM_PROGRAM".to_owned(), "explicit-terminal".to_owned()),
        ("TERM_PROGRAM_VERSION".to_owned(), "9.1".to_owned()),
        ("NO_COLOR".to_owned(), "1".to_owned()),
        ("FORCE_COLOR".to_owned(), "0".to_owned()),
        ("CLICOLOR".to_owned(), "0".to_owned()),
    ]);

    let plan = build_terminal_shell_launch_with_catalog(
        "custom-shell",
        &[],
        &env,
        temp.path(),
        &catalog(ShellIntegrationPlatform::Unix, vec![]),
    );

    assert_eq!(
        plan.integration.status,
        TerminalShellIntegrationStatus::Disabled
    );
    assert_eq!(
        plan.env.get("TERM").map(String::as_str),
        Some("screen-256color")
    );
    assert_eq!(plan.env.get("COLORTERM").map(String::as_str), Some("24bit"));
    assert_eq!(
        plan.env.get("TERM_PROGRAM").map(String::as_str),
        Some("explicit-terminal")
    );
    assert_eq!(
        plan.env.get("TERM_PROGRAM_VERSION").map(String::as_str),
        Some("9.1")
    );
    assert_eq!(plan.env.get("NO_COLOR").map(String::as_str), Some("1"));
    assert_eq!(plan.env.get("FORCE_COLOR").map(String::as_str), Some("0"));
    assert_eq!(plan.env.get("CLICOLOR").map(String::as_str), Some("0"));
    assert_eq!(
        plan.env.get(KERMINAL_TERMINAL_ENV).map(String::as_str),
        Some("1")
    );
}

fn catalog(
    platform: ShellIntegrationPlatform,
    entries: Vec<AllowedShell>,
) -> ShellIntegrationCatalog {
    ShellIntegrationCatalog::new(platform, entries)
}

fn fake_executable(path: PathBuf) -> PathBuf {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "").unwrap();
    path
}

fn script_path(
    plan: &kerminal_lib::services::terminal_shell_integration::TerminalShellLaunchPlan,
) -> PathBuf {
    PathBuf::from(
        plan.integration
            .script_path
            .as_deref()
            .expect("script path"),
    )
}
