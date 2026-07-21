//! WinSCP, FileZilla and generic SFTP URL compatibility parser.
//!
//! @author kongweiguang

use percent_encoding::percent_decode_str;
use url::{Host, Url};

use crate::error::{AppError, AppResult};

use super::common::{build_request_with_intent, should_parse, RequestWithIntent};
use crate::services::external_launch::{
    model::{
        ExternalLaunchIntent, ExternalLaunchParseInput, ExternalLaunchSourceTool,
        ExternalSecretKind, ExternalSecretSlot, ExternalSecretSource, ExternalSshAuth,
        ExternalSshLaunchOptions, ExternalSshLaunchRequest, ExternalSshTarget,
    },
    parser::ExternalLaunchParser,
};

pub(crate) struct SftpClientParser;

impl ExternalLaunchParser for SftpClientParser {
    fn tool(&self) -> ExternalLaunchSourceTool {
        ExternalLaunchSourceTool::SftpClient
    }

    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>> {
        if !should_parse(input, self.tool()) {
            return Ok(None);
        }
        Ok(Some(parse_sftp_client(input)?))
    }
}

#[derive(Default)]
struct SftpClientArgs {
    url_index: Option<usize>,
    raw_url: Option<String>,
    username: Option<String>,
    password: Option<(String, usize)>,
    identity_file: Option<String>,
    passphrase: Option<(String, usize)>,
    passwords_from_files: bool,
    host_key_assertion: Option<String>,
    filezilla: bool,
    winscp: bool,
    redacted: Vec<String>,
}

fn parse_sftp_client(input: &ExternalLaunchParseInput) -> AppResult<ExternalSshLaunchRequest> {
    let mut parsed = SftpClientArgs {
        redacted: input.argv.clone(),
        ..SftpClientArgs::default()
    };
    let mut index = 1;
    while index < input.argv.len() {
        let token = &input.argv[index];
        let normalized = token.trim().trim_matches(['\'', '"']);
        let lower = normalized.to_ascii_lowercase();
        if lower.starts_with("sftp://") || lower.contains("://") {
            if parsed.raw_url.is_some() {
                return Err(invalid("multiple SFTP URLs are not supported"));
            }
            parsed.url_index = Some(index);
            parsed.raw_url = Some(normalized.to_owned());
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "/newinstance" | "/browse") {
            parsed.winscp = true;
            index += 1;
            continue;
        }
        if lower == "/passwordsfromfiles" {
            parsed.winscp = true;
            parsed.passwords_from_files = true;
            index += 1;
            continue;
        }
        if lower == "--logontype" || lower.starts_with("--logontype=") {
            parsed.filezilla = true;
            if lower == "--logontype" {
                let _ = required_next(&input.argv, index, "--logontype")?;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if lower == "-l" {
            parsed.filezilla = true;
            let _ = required_next(&input.argv, index, "-l")?;
            index += 2;
            continue;
        }
        if lower == "--site" || lower.starts_with("--site=") {
            return Err(invalid(
                "unsupported or unsafe FileZilla option --site; private site stores are not read",
            ));
        }
        if let Some((name, value, consumed)) = winscp_value_option(&input.argv, index)? {
            parsed.winscp = true;
            match name {
                "/username" => parsed.username = Some(value),
                "/password" => {
                    redact_value(&mut parsed.redacted, index, consumed, "/password");
                    parsed.password = Some((value, index));
                }
                "/privatekey" => parsed.identity_file = Some(value),
                "/passphrase" => {
                    redact_value(&mut parsed.redacted, index, consumed, "/passphrase");
                    parsed.passphrase = Some((value, index));
                }
                "/hostkey" => parsed.host_key_assertion = Some(value),
                _ => unreachable!(),
            }
            index += consumed;
            continue;
        }
        if lower.starts_with('/') || lower.starts_with('-') {
            return Err(invalid(format!(
                "unsupported or unsafe SFTP client option: {}",
                option_name(token)
            )));
        }
        return Err(invalid("unexpected positional SFTP client argument"));
    }

    let raw_url = parsed
        .raw_url
        .as_deref()
        .ok_or_else(|| invalid("SFTP client launch requires an sftp:// URL"))?;
    let mut url =
        Url::parse(raw_url).map_err(|error| invalid(format!("invalid SFTP URL: {error}")))?;
    if !url.scheme().eq_ignore_ascii_case("sftp") {
        return Err(invalid(
            "SFTP client launch only accepts the sftp:// scheme",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(invalid(
            "SFTP launch URL query and fragment are not supported",
        ));
    }
    let host = match url.host() {
        Some(Host::Domain(value)) => value.to_owned(),
        Some(Host::Ipv4(value)) => value.to_string(),
        Some(Host::Ipv6(value)) => value.to_string(),
        None => return Err(invalid("SFTP URL host is required")),
    };
    let port = url.port().unwrap_or(22);
    let url_username = decode(url.username())?;
    let username = parsed
        .username
        .or_else(|| (!url_username.is_empty()).then_some(url_username));
    let mut auth = ExternalSshAuth {
        identity_file: parsed.identity_file,
        ..ExternalSshAuth::default()
    };
    let url_password = url.password().map(decode).transpose()?;
    if parsed.passwords_from_files {
        if parsed.passphrase.is_some() {
            return Err(invalid(
                "WinSCP /passwordsfromfiles with /passphrase is not supported safely",
            ));
        }
        auth.password_file = parsed.password.map(|(value, _)| value);
    } else {
        if let Some(password) = parsed.password.map(|(value, _)| value).or(url_password) {
            auth.password = Some(ExternalSecretSlot::inline(
                ExternalSecretKind::Password,
                ExternalSecretSource::Url,
                password,
            )?);
        }
        if let Some((passphrase, _)) = parsed.passphrase {
            auth.key_passphrase = Some(ExternalSecretSlot::inline(
                ExternalSecretKind::KeyPassphrase,
                ExternalSecretSource::CommandLine,
                passphrase,
            )?);
        }
    }
    let (remote_path, selected_entry) = initial_location(&url)?;
    if url.password().is_some() {
        let _ = url.set_password(Some("<redacted>"));
    }
    if let Some(url_index) = parsed.url_index {
        parsed.redacted[url_index] = url.to_string();
    }
    let parser = if parsed.winscp {
        "winscp-sftp-url"
    } else if parsed.filezilla {
        "filezilla-sftp-url"
    } else {
        "generic-sftp-url"
    };
    let target = ExternalSshTarget::new(host, port, username)?;
    Ok(build_request_with_intent(
        input,
        ExternalLaunchSourceTool::SftpClient,
        parser,
        RequestWithIntent {
            target,
            auth,
            options: ExternalSshLaunchOptions::default(),
            intent: ExternalLaunchIntent::SftpTransfer {
                remote_path,
                selected_entry,
                host_key_assertion: parsed.host_key_assertion,
            },
            argv_redacted: parsed.redacted,
        },
    ))
}

fn initial_location(url: &Url) -> AppResult<(Option<String>, Option<String>)> {
    let path = decode(url.path())?;
    // 堡垒机对 WinSCP、FileZilla 和 FlashFXP 使用不带尾斜杠的
    // `sftp://user:password@host:port`，URL parser 会把它表示为空 path。
    if path.is_empty() {
        return Ok((Some("/".to_owned()), None));
    }
    if !path.starts_with('/') || path.chars().any(char::is_control) {
        return Err(invalid(
            "SFTP URL path must be absolute and must not contain control characters",
        ));
    }
    if path == "/" {
        return Ok((Some("/".to_owned()), None));
    }
    if path.ends_with('/') {
        return Ok((Some(path), None));
    }
    let (parent, selected) = path.rsplit_once('/').unwrap_or(("", path.as_str()));
    let parent = if parent.is_empty() {
        "/".to_owned()
    } else {
        format!("{parent}/")
    };
    Ok((Some(parent), Some(selected.to_owned())))
}

fn decode(value: &str) -> AppResult<String> {
    percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| invalid("SFTP URL contains invalid UTF-8 percent encoding"))
}

fn winscp_value_option(
    argv: &[String],
    index: usize,
) -> AppResult<Option<(&'static str, String, usize)>> {
    const OPTIONS: &[&str] = &[
        "/username",
        "/password",
        "/privatekey",
        "/passphrase",
        "/hostkey",
    ];
    let token = &argv[index];
    for option in OPTIONS {
        if token.eq_ignore_ascii_case(option) {
            return Ok(Some((
                option,
                required_next(argv, index, option)?.to_owned(),
                2,
            )));
        }
        if let Some((left, value)) = token.split_once('=') {
            if left.eq_ignore_ascii_case(option) {
                if value.is_empty() {
                    return Err(invalid(format!(
                        "SFTP client option {option} needs a value"
                    )));
                }
                return Ok(Some((option, value.to_owned(), 1)));
            }
        }
    }
    Ok(None)
}

fn required_next<'a>(argv: &'a [String], index: usize, option: &str) -> AppResult<&'a str> {
    argv.get(index + 1)
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("SFTP client option {option} needs a value")))
}

fn redact_value(redacted: &mut [String], index: usize, consumed: usize, name: &str) {
    if consumed == 1 {
        redacted[index] = format!("{name}=<redacted>");
    } else if let Some(value) = redacted.get_mut(index + 1) {
        *value = "<redacted>".to_owned();
    }
}

fn option_name(token: &str) -> &str {
    token.split_once('=').map(|(name, _)| name).unwrap_or(token)
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::InvalidInput(message.into())
}
