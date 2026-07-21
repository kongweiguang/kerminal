//! Kerminal-native external SSH launch parser.
//!
//! @author kongweiguang

use serde::Deserialize;
use url::Url;

use crate::error::{AppError, AppResult};

use super::common::{
    build_request, build_request_with_intent, find_any_named_option, find_generic_host_option,
    find_option_index, required_generic_host_option, required_named_option, should_parse,
};
use crate::services::external_launch::{
    destination::parse_port,
    model::{
        ExternalLaunchIntent, ExternalLaunchParseInput, ExternalLaunchSourceTool,
        ExternalSecretKind, ExternalSecretSlot, ExternalSecretSource, ExternalSshAuth,
        ExternalSshLaunchOptions, ExternalSshLaunchRequest, ExternalSshTarget,
    },
    parser::ExternalLaunchParser,
    redaction::redact_kerminal_json_secrets,
    ssh_url::{is_truthy_query_value, query_param, required_query_param},
};

pub(crate) struct KerminalNativeParser;

impl ExternalLaunchParser for KerminalNativeParser {
    fn tool(&self) -> ExternalLaunchSourceTool {
        ExternalLaunchSourceTool::KerminalNative
    }

    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>> {
        if !should_parse(input, self.tool()) {
            return Ok(None);
        }
        if let Some((url_index, raw_url)) = input
            .argv
            .iter()
            .enumerate()
            .find(|(_, token)| token.starts_with("kerminal://ssh"))
        {
            return Ok(Some(parse_kerminal_protocol_url(
                input, raw_url, url_index,
            )?));
        }
        if let Some((url_index, raw_url)) = input
            .argv
            .iter()
            .enumerate()
            .find(|(_, token)| token.starts_with("kerminal://sftp"))
        {
            return Ok(Some(parse_kerminal_sftp_protocol_url(
                input, raw_url, url_index,
            )?));
        }
        if let Some(json_index) = find_option_index(&input.argv, &["--external-ssh-json"]) {
            let raw_json =
                super::common::option_value(&input.argv, json_index, "--external-ssh-json")?;
            return Ok(Some(parse_kerminal_json(input, raw_json, json_index)?));
        }
        let explicit_sftp_marker = input.argv.iter().any(|token| token == "--external-sftp");
        let explicit_external_marker =
            explicit_sftp_marker || input.argv.iter().any(|token| token == "--external-ssh");
        if !explicit_external_marker && find_generic_host_option(&input.argv).is_none() {
            return Ok(None);
        }

        let host = if explicit_external_marker {
            required_named_option(&input.argv, "--host")?
        } else {
            required_generic_host_option(&input.argv)?
        };
        let port = find_any_named_option(&input.argv, &["--port", "-port", "-p"])
            .map(parse_port)
            .transpose()?
            .unwrap_or(22);
        let username = find_any_named_option(
            &input.argv,
            &["--user", "--username", "-user", "-username", "-login", "-l"],
        )
        .map(str::to_owned);
        let mut options = ExternalSshLaunchOptions {
            open_sftp: input.argv.iter().any(|token| token == "--open-sftp"),
            ..ExternalSshLaunchOptions::default()
        };
        options.display_name = Some(match username.as_deref() {
            Some(username) => format!("{username}@{host}"),
            None => host.to_owned(),
        });
        let target = ExternalSshTarget::new(host, port, username)?;
        let intent = if explicit_sftp_marker {
            ExternalLaunchIntent::SftpTransfer {
                remote_path: find_any_named_option(&input.argv, &["--remote-path", "--path"])
                    .map(validate_sftp_path)
                    .transpose()?,
                selected_entry: None,
                host_key_assertion: None,
            }
        } else {
            ExternalLaunchIntent::SshTerminal
        };
        Ok(Some(build_request_with_intent(
            input,
            self.tool(),
            if explicit_sftp_marker {
                "kerminal-native-sftp-flags"
            } else {
                "kerminal-native-flags"
            },
            target,
            ExternalSshAuth::default(),
            options,
            intent,
            input.argv.clone(),
        )))
    }
}

fn parse_kerminal_sftp_protocol_url(
    input: &ExternalLaunchParseInput,
    raw_url: &str,
    url_index: usize,
) -> AppResult<ExternalSshLaunchRequest> {
    let url = Url::parse(raw_url)
        .map_err(|error| AppError::InvalidInput(format!("invalid Kerminal SFTP URL: {error}")))?;
    if url.scheme() != "kerminal" || url.host_str() != Some("sftp") {
        return Err(AppError::InvalidInput(
            "Kerminal external SFTP URL must start with kerminal://sftp".to_owned(),
        ));
    }
    const ALLOWED: &[&str] = &["host", "port", "user", "username", "path"];
    for (key, _) in url.query_pairs() {
        if !ALLOWED.contains(&key.as_ref()) {
            return Err(AppError::InvalidInput(format!(
                "unsupported or unsafe Kerminal SFTP protocol parameter: {key}"
            )));
        }
    }
    let host = required_query_param(&url, "host")?;
    let port = query_param(&url, "port")
        .map(|value| parse_port(&value))
        .transpose()?
        .unwrap_or(22);
    let username = query_param(&url, "user").or_else(|| query_param(&url, "username"));
    let target = ExternalSshTarget::new(host, port, username)?;
    let mut redacted = input.argv.clone();
    redacted[url_index] = redact_kerminal_protocol_url(&url);
    Ok(build_request_with_intent(
        input,
        ExternalLaunchSourceTool::KerminalNative,
        "kerminal-native-sftp-protocol",
        target,
        ExternalSshAuth::default(),
        ExternalSshLaunchOptions::default(),
        ExternalLaunchIntent::SftpTransfer {
            remote_path: query_param(&url, "path")
                .as_deref()
                .map(validate_sftp_path)
                .transpose()?,
            selected_entry: None,
            host_key_assertion: None,
        },
        redacted,
    ))
}

fn validate_sftp_path(path: &str) -> AppResult<String> {
    if !path.starts_with('/') || path.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(
            "external SFTP path must be absolute and must not contain control characters"
                .to_owned(),
        ));
    }
    Ok(path.to_owned())
}

fn parse_kerminal_json(
    input: &ExternalLaunchParseInput,
    raw_json: &str,
    json_index: usize,
) -> AppResult<ExternalSshLaunchRequest> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Envelope {
        host: String,
        port: Option<u16>,
        #[serde(alias = "user")]
        username: Option<String>,
        password: Option<String>,
        identity_file: Option<String>,
        key_passphrase: Option<String>,
        open_sftp: Option<bool>,
    }

    let envelope: Envelope = serde_json::from_str(raw_json)?;
    let target = ExternalSshTarget::new(
        envelope.host,
        envelope.port.unwrap_or(22),
        envelope.username,
    )?;
    let mut auth = ExternalSshAuth::default();
    if let Some(password) = envelope.password {
        auth.password = Some(ExternalSecretSlot::inline(
            ExternalSecretKind::Password,
            ExternalSecretSource::JsonEnvelope,
            password,
        )?);
    }
    auth.identity_file = envelope.identity_file;
    if let Some(passphrase) = envelope.key_passphrase {
        auth.key_passphrase = Some(ExternalSecretSlot::inline(
            ExternalSecretKind::KeyPassphrase,
            ExternalSecretSource::JsonEnvelope,
            passphrase,
        )?);
    }
    let options = ExternalSshLaunchOptions {
        open_sftp: envelope.open_sftp.unwrap_or(false),
        ..ExternalSshLaunchOptions::default()
    };
    let mut redacted = input.argv.clone();
    redacted[json_index + 1] = redact_kerminal_json_secrets(raw_json);
    Ok(build_request(
        input,
        ExternalLaunchSourceTool::KerminalNative,
        "kerminal-native-json",
        target,
        auth,
        options,
        redacted,
    ))
}

fn parse_kerminal_protocol_url(
    input: &ExternalLaunchParseInput,
    raw_url: &str,
    url_index: usize,
) -> AppResult<ExternalSshLaunchRequest> {
    let url = Url::parse(raw_url)
        .map_err(|error| AppError::InvalidInput(format!("invalid Kerminal SSH URL: {error}")))?;
    if url.scheme() != "kerminal" || url.host_str() != Some("ssh") {
        return Err(AppError::InvalidInput(
            "Kerminal external launch URL must start with kerminal://ssh".to_owned(),
        ));
    }

    validate_protocol_query(&url)?;

    let host = required_query_param(&url, "host")?;
    let port = query_param(&url, "port")
        .map(|value| parse_port(&value))
        .transpose()?
        .unwrap_or(22);
    let username = query_param(&url, "user").or_else(|| query_param(&url, "username"));
    let target = ExternalSshTarget::new(host, port, username)?;
    let auth = ExternalSshAuth::default();
    let options = ExternalSshLaunchOptions {
        display_name: query_param(&url, "displayName").or_else(|| Some(target.display_name())),
        open_sftp: query_param(&url, "openSftp")
            .or_else(|| query_param(&url, "open_sftp"))
            .is_some_and(|value| is_truthy_query_value(&value)),
        ..ExternalSshLaunchOptions::default()
    };
    let mut redacted = input.argv.clone();
    redacted[url_index] = redact_kerminal_protocol_url(&url);
    Ok(build_request(
        input,
        ExternalLaunchSourceTool::KerminalNative,
        "kerminal-native-protocol",
        target,
        auth,
        options,
        redacted,
    ))
}

fn validate_protocol_query(url: &Url) -> AppResult<()> {
    const ALLOWED: &[&str] = &[
        "host",
        "port",
        "user",
        "username",
        "displayName",
        "openSftp",
        "open_sftp",
    ];
    for (key, _) in url.query_pairs() {
        if !ALLOWED.contains(&key.as_ref()) {
            return Err(AppError::InvalidInput(format!(
                "unsupported or unsafe Kerminal protocol parameter: {key}"
            )));
        }
    }
    Ok(())
}

fn redact_kerminal_protocol_url(url: &Url) -> String {
    let mut redacted = url.clone();
    redacted.set_query(None);
    {
        let mut pairs = redacted.query_pairs_mut();
        for (key, value) in url.query_pairs() {
            if matches!(
                key.as_ref(),
                "password" | "keyPassphrase" | "key_passphrase"
            ) {
                pairs.append_pair(&key, "<redacted>");
            } else if matches!(key.as_ref(), "identityFile" | "identity_file") {
                pairs.append_pair(&key, "<path:fingerprint>");
            } else {
                pairs.append_pair(&key, &value);
            }
        }
    }
    redacted.to_string()
}
