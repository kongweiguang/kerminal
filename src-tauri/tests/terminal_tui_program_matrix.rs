//! 本地 PTY 下真实 TUI 程序 smoke 矩阵。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::{TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    services::terminal_manager::TerminalManager,
};
use std::{
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[test]
fn local_pty_wsl_tui_program_matrix_covers_available_tools() {
    let cases = discover_tui_cases();
    let mut passed = Vec::new();
    let mut skipped = Vec::new();
    let mut failures = Vec::new();

    for case in cases {
        match case.status {
            TuiCaseStatus::Skipped(reason) => {
                println!(
                    "tui matrix program={} status=skipped reason={reason}",
                    case.name
                );
                skipped.push(format!("{}: {reason}", case.name));
            }
            TuiCaseStatus::Runnable {
                request,
                interaction,
                expected_exit,
                expected_output,
            } => match run_tui_case(
                case.name,
                request,
                interaction,
                expected_exit,
                expected_output,
            ) {
                Ok(report) => {
                    println!(
                        "tui matrix program={} status=passed data_bytes={}",
                        case.name, report.data_bytes
                    );
                    passed.push(case.name.to_owned());
                }
                Err(error) => failures.push(format!("{}: {error}", case.name)),
            },
        }
    }

    assert!(
        failures.is_empty(),
        "local PTY TUI program matrix failures:\n{}",
        failures.join("\n")
    );
    println!(
        "tui matrix summary passed={} skipped={}",
        passed.join(","),
        skipped.join(",")
    );
}

struct TuiCase {
    name: &'static str,
    status: TuiCaseStatus,
}

enum TuiCaseStatus {
    Runnable {
        request: TerminalCreateRequest,
        interaction: &'static str,
        expected_exit: &'static str,
        expected_output: &'static [&'static str],
    },
    Skipped(String),
}

struct TuiCaseReport {
    data_bytes: usize,
}

fn run_tui_case(
    name: &'static str,
    request: TerminalCreateRequest,
    interaction: &'static str,
    expected_exit: &'static str,
    expected_output: &'static [&'static str],
) -> Result<TuiCaseReport, String> {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let summary = manager
        .create_session(request, move |event| sender.send(event).is_ok())
        .map_err(|error| format!("create session failed: {error}"))?;

    let result = run_tui_case_inner(
        name,
        &manager,
        &summary.id,
        &receiver,
        interaction,
        expected_exit,
        expected_output,
    );
    let close_result = manager.close(&summary.id);
    match (result, close_result) {
        (Ok(report), Ok(())) => Ok(report),
        (Ok(report), Err(error)) if error.to_string().contains("终端会话不存在") => {
            Ok(report)
        }
        (Ok(_), Err(error)) => Err(format!("close failed after passing matrix: {error}")),
        (Err(error), _) => Err(error),
    }
}

fn run_tui_case_inner(
    name: &'static str,
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    interaction: &'static str,
    expected_exit: &'static str,
    expected_output: &'static [&'static str],
) -> Result<TuiCaseReport, String> {
    let mut transcript = collect_until_output(
        manager,
        session_id,
        receiver,
        &format!("matrix-{name}-ready"),
        Duration::from_secs(10),
    )?;
    transcript.push_str(&collect_additional_output_for(
        manager,
        session_id,
        receiver,
        Duration::from_millis(500),
    ));
    manager
        .write(session_id, interaction)
        .map_err(|error| format!("{name}: write TUI interaction failed: {error}"))?;
    transcript.push_str(&collect_until_output(
        manager,
        session_id,
        receiver,
        expected_exit,
        Duration::from_secs(10),
    )?);
    transcript.push_str(&collect_additional_output_for(
        manager,
        session_id,
        receiver,
        Duration::from_millis(250),
    ));

    for expected in expected_output {
        if !transcript.contains(expected) {
            return Err(format!(
                "{name}: missing expected output marker {expected:?}; transcript={transcript:?}"
            ));
        }
    }
    Ok(TuiCaseReport {
        data_bytes: transcript.len(),
    })
}

fn collect_until_output(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        match event.kind {
            TerminalOutputKind::Data => {
                received.push_str(&event.data);
                reply_to_frontend_terminal_queries(manager, session_id, &event.data);
            }
            TerminalOutputKind::Error => {
                return Err(format!("terminal emitted error event: {}", event.data));
            }
            _ => {}
        }

        if received.contains(expected) {
            return Ok(received);
        }
    }

    Err(format!(
        "expected PTY output to contain {expected:?}, got: {received:?}"
    ))
}

fn collect_additional_output_for(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    duration: Duration,
) -> String {
    let deadline = Instant::now() + duration;
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
            reply_to_frontend_terminal_queries(manager, session_id, &event.data);
        }
    }

    received
}

/// 模拟 xterm 对 TUI 启动探测的同步回复；按请求出现顺序写回，避免回复残留到 shell。
fn reply_to_frontend_terminal_queries(manager: &TerminalManager, session_id: &str, data: &str) {
    let mut responses = String::new();
    for (query, response) in [
        ("\u{1b}[>q", "\u{1b}P>|Kerminal 0.3.29\u{1b}\\"),
        ("\u{1b}[16t", "\u{1b}[6;16;8t"),
        ("\u{1b}]11;?\u{7}", "\u{1b}]11;rgb:1111/1111/1111\u{1b}\\"),
        ("\u{1b}[?996n", "\u{1b}[?997;2n"),
        ("\u{1b}[0c", "\u{1b}[?62;22c"),
        ("\u{1b}[6n", "\u{1b}[1;1R"),
        ("\u{1b}[?2026$p", "\u{1b}[?2026;2$y"),
        ("\u{1b}[?2027$p", "\u{1b}[?2027;2$y"),
    ] {
        if data.contains(query) {
            responses.push_str(response);
        }
    }
    if !responses.is_empty() {
        let _ = manager.write(session_id, &responses);
    }
}

/// 构造 WSL 可用工具矩阵，并在本机安装了可选 TUI 时纳入 yazi/superfile。
fn discover_tui_cases() -> Vec<TuiCase> {
    let Some(wsl) = find_executable("wsl.exe") else {
        return ["vim", "less", "top", "tmux", "yazi", "superfile"]
            .into_iter()
            .map(|name| skipped_case(name, "wsl.exe not found on PATH"))
            .collect();
    };

    let mut cases = [
        (
            "vim",
            vim_script(),
            ":q!\r",
            "matrix-vim-exit",
            &["matrix-vim-content"][..],
        ),
        (
            "less",
            less_script(),
            "q",
            "matrix-less-exit",
            &["matrix-less-content"][..],
        ),
        (
            "top",
            top_script(),
            "q",
            "matrix-top-exit",
            &["matrix-top-ready"][..],
        ),
        (
            "tmux",
            tmux_script(),
            "\u{2}d",
            "matrix-tmux-exit",
            &["matrix-tmux-pane"][..],
        ),
    ]
    .into_iter()
    .map(
        |(name, script, interaction, expected_exit, expected_output)| {
            if !wsl_has_command(name) {
                return skipped_case(name, format!("WSL command {name} not found"));
            }
            TuiCase {
                name,
                status: TuiCaseStatus::Runnable {
                    request: terminal_request(wsl.clone(), script),
                    interaction,
                    expected_exit,
                    expected_output,
                },
            }
        },
    )
    .collect::<Vec<_>>();
    cases.push(discover_optional_tui_case(
        &wsl,
        "yazi",
        "KERMINAL_TUI_YAZI",
        "yazi",
        "q",
    ));
    cases.push(discover_optional_tui_case(
        &wsl,
        "superfile",
        "KERMINAL_TUI_SUPERFILE",
        "spf",
        "q",
    ));
    cases
}

/// 使用显式测试二进制或 WSL PATH 中的命令构造可选 TUI 用例，缺失时保留可见 skip。
fn discover_optional_tui_case(
    wsl: &Path,
    name: &'static str,
    override_env: &str,
    fallback_command: &str,
    interaction: &'static str,
) -> TuiCase {
    let command = env::var(override_env).unwrap_or_else(|_| fallback_command.to_owned());
    if !wsl_has_command(&command) {
        return skipped_case(
            name,
            format!("WSL command {command} not found; set {override_env} to override"),
        );
    }
    let expected_exit = match name {
        "yazi" => "matrix-yazi-exit:0",
        "superfile" => "matrix-superfile-exit:0",
        _ => "matrix-tui-exit:0",
    };
    TuiCase {
        name,
        status: TuiCaseStatus::Runnable {
            request: terminal_request(wsl.to_path_buf(), optional_tui_script(name, &command)),
            interaction,
            expected_exit,
            expected_output: &["\u{1b}[?1049h"],
        },
    }
}

fn skipped_case(name: &'static str, reason: impl Into<String>) -> TuiCase {
    TuiCase {
        name,
        status: TuiCaseStatus::Skipped(reason.into()),
    }
}

fn terminal_request(wsl: PathBuf, script: String) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some(wsl.to_string_lossy().into_owned()),
        args: vec!["-e".to_owned(), "bash".to_owned(), "-lc".to_owned(), script],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

/// 对命令名和绝对路径都做无副作用可执行性检查，供临时官方二进制参与矩阵。
fn wsl_has_command(command: &str) -> bool {
    let quoted = shell_quote(command);
    Command::new("wsl.exe")
        .args([
            "-e",
            "bash",
            "-lc",
            &format!("test -x {quoted} || command -v {quoted} >/dev/null 2>&1"),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// 生成单个 TUI 的退出探针；显式 LINES/COLUMNS 只作为 ioctl 之外的兼容兜底。
fn optional_tui_script(name: &str, command: &str) -> String {
    let marker = match name {
        "yazi" => "matrix-yazi",
        "superfile" => "matrix-superfile",
        _ => "matrix-tui",
    };
    format!(
        "export TERM=xterm-256color LINES=24 COLUMNS=80\nprintf '{marker}-ready\\n'\n{}\nrc=\"$?\"\nprintf '\\n{marker}-exit:%s\\n' \"$rc\"\n",
        shell_quote(command)
    )
}

/// 使用 POSIX 单引号封装测试命令，避免覆盖路径中的空格或引号改变脚本语义。
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn find_executable(program: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn vim_script() -> String {
    r#"export TERM=xterm-256color
tmp="$(mktemp)"
printf 'matrix-vim-content\n' > "$tmp"
printf 'matrix-vim-ready\n'
vim -Nu NONE -n -i NONE -N "$tmp"
rc="$?"
rm -f "$tmp"
printf 'matrix-vim-exit:%s\n' "$rc"
"#
    .to_owned()
}

fn less_script() -> String {
    r#"export TERM=xterm-256color
tmp="$(mktemp)"
printf 'matrix-less-content\nmatrix-less-second-line\n' > "$tmp"
printf 'matrix-less-ready\n'
less -R "$tmp"
rc="$?"
rm -f "$tmp"
printf 'matrix-less-exit:%s\n' "$rc"
"#
    .to_owned()
}

fn top_script() -> String {
    r#"export TERM=xterm-256color
printf 'matrix-top-ready\n'
top
rc="$?"
printf 'matrix-top-exit:%s\n' "$rc"
"#
    .to_owned()
}

fn tmux_script() -> String {
    r#"export TERM=xterm-256color
sock="kerminal-pty-matrix-$$"
tmux -L "$sock" -f /dev/null kill-server >/dev/null 2>&1 || true
tmux -L "$sock" -f /dev/null new-session -d -s matrix 'printf matrix-tmux-pane; sleep 30'
printf 'matrix-tmux-ready\n'
tmux -L "$sock" -f /dev/null attach-session -t matrix
rc="$?"
tmux -L "$sock" -f /dev/null kill-server >/dev/null 2>&1 || true
printf 'matrix-tmux-exit:%s\n' "$rc"
"#
    .to_owned()
}
