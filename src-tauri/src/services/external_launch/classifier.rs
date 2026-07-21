//! External launch source-tool classifier.
//!
//! @author kongweiguang

use super::model::ExternalLaunchSourceTool;

pub(crate) fn infer_source_tool_from_args(argv: &[String]) -> Option<ExternalLaunchSourceTool> {
    if argv.len() <= 1 {
        return None;
    }
    if has_token(argv, "--external-ssh")
        || has_token(argv, "--external-ssh-json")
        || argv.iter().any(|token| token.starts_with("kerminal://ssh"))
    {
        return Some(ExternalLaunchSourceTool::KerminalNative);
    }
    if has_token(argv, "--external-sftp")
        || argv
            .iter()
            .any(|token| token.starts_with("kerminal://sftp"))
    {
        return Some(ExternalLaunchSourceTool::KerminalNative);
    }
    if argv.iter().skip(1).any(|token| {
        let token = normalized_token(token);
        token.to_ascii_lowercase().starts_with("sftp://")
            || token.eq_ignore_ascii_case("--site")
            || token.eq_ignore_ascii_case("--logontype")
    }) {
        return Some(ExternalLaunchSourceTool::SftpClient);
    }
    let argv0_tool = argv
        .first()
        .and_then(|argv0| infer_source_tool_from_argv0(argv0));
    if argv0_tool.is_some_and(|tool| tool != ExternalLaunchSourceTool::KerminalNative) {
        return argv0_tool;
    }
    if has_token(argv, "/SSH2") {
        Some(ExternalLaunchSourceTool::Securecrt)
    } else if has_token(argv, "-url")
        || has_token(argv, "-newwin")
        || looks_like_ssh_url_argument(argv)
    {
        Some(ExternalLaunchSourceTool::Xshell)
    } else if has_token(argv, "-newtab")
        || has_token(argv, "-exec")
        || has_any_token(argv, &["-remotehost", "-host", "-hostname", "-server"])
        || argv
            .iter()
            .skip(1)
            .any(|token| looks_like_mobaxterm_session_file(token))
    {
        Some(ExternalLaunchSourceTool::Mobaxterm)
    } else if has_token(argv, "-ssh")
        || has_token(argv, "-pw")
        || has_token(argv, "-pwfile")
        || has_token(argv, "-load")
    {
        Some(ExternalLaunchSourceTool::Putty)
    } else if looks_like_generic_field_args(argv) {
        Some(ExternalLaunchSourceTool::KerminalNative)
    } else if looks_like_openssh_args(argv) || looks_like_bare_ssh_destination(argv) {
        Some(ExternalLaunchSourceTool::Openssh)
    } else {
        None
    }
}

fn normalized_token(token: &str) -> &str {
    token.trim().trim_matches(['\'', '"'])
}

fn infer_source_tool_from_argv0(argv0: &str) -> Option<ExternalLaunchSourceTool> {
    let filename = argv0.rsplit(['\\', '/']).next().unwrap_or(argv0);
    let lower = filename.to_ascii_lowercase();
    if lower.contains("mobaxterm") {
        Some(ExternalLaunchSourceTool::Mobaxterm)
    } else if lower.contains("xshell") {
        Some(ExternalLaunchSourceTool::Xshell)
    } else if lower.contains("securecrt") {
        Some(ExternalLaunchSourceTool::Securecrt)
    } else if lower.contains("putty") || lower.contains("plink") {
        Some(ExternalLaunchSourceTool::Putty)
    } else if lower == "ssh" || lower == "ssh.exe" {
        Some(ExternalLaunchSourceTool::Openssh)
    } else if lower.contains("kerminal") {
        Some(ExternalLaunchSourceTool::KerminalNative)
    } else {
        None
    }
}

fn has_token(argv: &[String], expected: &str) -> bool {
    argv.iter()
        .any(|token| token.eq_ignore_ascii_case(expected))
}

fn has_any_token(argv: &[String], expected: &[&str]) -> bool {
    argv.iter()
        .any(|token| expected.iter().any(|name| token.eq_ignore_ascii_case(name)))
}

fn looks_like_mobaxterm_session_file(token: &str) -> bool {
    token.to_ascii_lowercase().ends_with(".moba")
}

fn looks_like_ssh_url_argument(argv: &[String]) -> bool {
    argv.iter().skip(1).any(|token| {
        let lower = token.to_ascii_lowercase();
        lower.starts_with("ssh://") || lower.starts_with("b64%3e%3e") || lower.starts_with("b64>>")
    })
}

fn looks_like_generic_field_args(argv: &[String]) -> bool {
    find_named_option_any(
        argv,
        &[
            "--host",
            "--hostname",
            "--remote-host",
            "-host",
            "-hostname",
            "-remotehost",
            "-server",
        ],
    )
    .is_some()
}

pub(crate) fn looks_like_openssh_args(argv: &[String]) -> bool {
    let mut saw_openssh_option = false;
    let mut i = 1;
    while i < argv.len() {
        let token = &argv[i];
        match token.as_str() {
            "-p" | "-l" | "-i" | "-J" => {
                saw_openssh_option = true;
                i += 2;
            }
            "-o" | "-F" => {
                i += 2;
            }
            _ if token.starts_with('-') => {
                i += 1;
            }
            _ => {
                return saw_openssh_option;
            }
        }
    }
    false
}

fn looks_like_bare_ssh_destination(argv: &[String]) -> bool {
    argv.iter().skip(1).any(|token| {
        let value = token.trim();
        !value.starts_with('-')
            && !value.starts_with('/')
            && value.contains('@')
            && !value.contains('\\')
            && !value.to_ascii_lowercase().ends_with(".moba")
    })
}

fn find_named_option_any<'a>(argv: &'a [String], names: &[&str]) -> Option<&'a str> {
    argv.iter().enumerate().find_map(|(index, token)| {
        names
            .iter()
            .find_map(|name| inline_option_value(token, name))
            .or_else(|| {
                names
                    .iter()
                    .any(|name| token.eq_ignore_ascii_case(name))
                    .then(|| argv.get(index + 1).map(String::as_str))
                    .flatten()
            })
    })
}

fn inline_option_value<'a>(token: &'a str, name: &str) -> Option<&'a str> {
    let (left, right) = token.split_once('=')?;
    left.eq_ignore_ascii_case(name)
        .then(|| right.trim())
        .filter(|value| !value.is_empty())
}
