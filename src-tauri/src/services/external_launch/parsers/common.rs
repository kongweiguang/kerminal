//! Shared helpers for external SSH persona parsers.
//!
//! @author kongweiguang

use crate::error::{AppError, AppResult};

use super::super::{
    classifier::infer_source_tool_from_args,
    model::{
        ExternalLaunchIntent, ExternalLaunchParseInput, ExternalLaunchRequestDiagnostics,
        ExternalLaunchSource, ExternalLaunchSourceTool, ExternalSshAuth, ExternalSshLaunchOptions,
        ExternalSshLaunchRequest, ExternalSshTarget,
    },
    redaction::raw_hash,
};

pub(super) fn build_request(
    input: &ExternalLaunchParseInput,
    tool: ExternalLaunchSourceTool,
    parser: &str,
    target: ExternalSshTarget,
    auth: ExternalSshAuth,
    options: ExternalSshLaunchOptions,
    argv_redacted: Vec<String>,
) -> ExternalSshLaunchRequest {
    let source = ExternalLaunchSource {
        tool,
        entrypoint: input.entrypoint,
        persona: input
            .persona
            .clone()
            .or_else(|| Some(tool.as_str().to_owned())),
        argv0: input.argv.first().cloned(),
    };
    let diagnostics = ExternalLaunchRequestDiagnostics {
        parser: parser.to_owned(),
        argv_redacted,
        raw_hash: raw_hash(&input.argv),
        warnings: Vec::new(),
    };
    ExternalSshLaunchRequest::new(source, target, auth, options, diagnostics)
}

pub(super) struct RequestWithIntent {
    pub(super) target: ExternalSshTarget,
    pub(super) auth: ExternalSshAuth,
    pub(super) options: ExternalSshLaunchOptions,
    pub(super) intent: ExternalLaunchIntent,
    pub(super) argv_redacted: Vec<String>,
}

pub(super) fn build_request_with_intent(
    input: &ExternalLaunchParseInput,
    tool: ExternalLaunchSourceTool,
    parser: &str,
    request: RequestWithIntent,
) -> ExternalSshLaunchRequest {
    build_request(
        input,
        tool,
        parser,
        request.target,
        request.auth,
        request.options,
        request.argv_redacted,
    )
    .with_intent(request.intent)
}

pub(super) fn should_parse(
    input: &ExternalLaunchParseInput,
    parser_tool: ExternalLaunchSourceTool,
) -> bool {
    if input.source_tool == Some(parser_tool) {
        return true;
    }
    if input.source_tool.is_some() {
        return false;
    }
    infer_source_tool_from_args(&input.argv) == Some(parser_tool)
}

pub(super) fn option_value<'a>(
    argv: &'a [String],
    index: usize,
    option: &str,
) -> AppResult<&'a str> {
    argv.get(index + 1)
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput(format!("external SSH launch option {option} needs a value"))
        })
}

pub(super) fn find_option_index(argv: &[String], names: &[&str]) -> Option<usize> {
    argv.iter()
        .position(|token| names.iter().any(|name| token.eq_ignore_ascii_case(name)))
}

pub(super) fn find_named_option<'a>(argv: &'a [String], name: &str) -> Option<&'a str> {
    find_any_named_option(argv, &[name])
}

pub(super) fn find_any_named_option<'a>(argv: &'a [String], names: &[&str]) -> Option<&'a str> {
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

pub(super) fn required_named_option<'a>(argv: &'a [String], name: &str) -> AppResult<&'a str> {
    find_named_option(argv, name).ok_or_else(|| {
        AppError::InvalidInput(format!("external SSH launch option {name} is required"))
    })
}

pub(super) fn find_generic_host_option(argv: &[String]) -> Option<&str> {
    find_any_named_option(
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
}

pub(super) fn required_generic_host_option(argv: &[String]) -> AppResult<&str> {
    find_generic_host_option(argv).ok_or_else(|| {
        AppError::InvalidInput("external SSH launch host option is required".to_owned())
    })
}

fn inline_option_value<'a>(token: &'a str, name: &str) -> Option<&'a str> {
    let (left, right) = token.split_once('=')?;
    left.eq_ignore_ascii_case(name)
        .then(|| right.trim())
        .filter(|value| !value.is_empty())
}

pub(super) fn is_option(token: &str) -> bool {
    token.starts_with('-') || token.starts_with('/')
}

pub(crate) fn empty_to_none(value: &str) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

pub(crate) fn split_command_line(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    for ch in command.chars() {
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        match ch {
            '\'' | '"' => quote = Some(ch),
            ch if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

pub(super) fn is_ssh_command_token(token: &str) -> bool {
    token
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(token)
        .eq_ignore_ascii_case("ssh")
}

pub(super) fn matches_option(token: &str, names: &[&str]) -> bool {
    names.iter().any(|name| token.eq_ignore_ascii_case(name))
}
