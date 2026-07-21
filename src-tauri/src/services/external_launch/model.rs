//! External SSH launch request model.
//!
//! @author kongweiguang

use std::{
    fmt,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::error::{AppError, AppResult};

/// Supported external terminal personas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalLaunchSourceTool {
    Putty,
    Mobaxterm,
    Xshell,
    Securecrt,
    Openssh,
    SftpClient,
    KerminalNative,
}

impl ExternalLaunchSourceTool {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Putty => "putty",
            Self::Mobaxterm => "mobaxterm",
            Self::Xshell => "xshell",
            Self::Securecrt => "securecrt",
            Self::Openssh => "openssh",
            Self::SftpClient => "sftp-client",
            Self::KerminalNative => "kerminal-native",
        }
    }

    pub fn from_external_name(value: &str) -> AppResult<Self> {
        match normalize_tool_name(value).as_str() {
            "putty" => Ok(Self::Putty),
            "mobaxterm" | "moba" => Ok(Self::Mobaxterm),
            "xshell" => Ok(Self::Xshell),
            "securecrt" => Ok(Self::Securecrt),
            "openssh" | "ssh" => Ok(Self::Openssh),
            "sftp-client" | "sftp" | "winscp" | "filezilla" | "flashfxp" => Ok(Self::SftpClient),
            "kerminal" | "kerminal-native" => Ok(Self::KerminalNative),
            other => Err(AppError::InvalidInput(format!(
                "unsupported external launch tool: {other}"
            ))),
        }
    }
}

/// Workspace behavior requested by an external launch.
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExternalLaunchIntent {
    SshTerminal,
    SftpTransfer {
        #[serde(default)]
        remote_path: Option<String>,
        #[serde(default)]
        selected_entry: Option<String>,
        /// Vendor fingerprint is an assertion only; it never grants trust.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        host_key_assertion: Option<String>,
    },
}

impl Default for ExternalLaunchIntent {
    fn default() -> Self {
        Self::SshTerminal
    }
}

impl fmt::Debug for ExternalLaunchIntent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SshTerminal => formatter.write_str("SshTerminal"),
            Self::SftpTransfer {
                remote_path,
                selected_entry,
                host_key_assertion,
            } => formatter
                .debug_struct("SftpTransfer")
                .field("remote_path_present", &remote_path.is_some())
                .field("selected_entry_present", &selected_entry.is_some())
                .field("host_key_assertion_present", &host_key_assertion.is_some())
                .finish(),
        }
    }
}

/// How Kerminal received the launch request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalLaunchEntrypoint {
    DirectArgv,
    SingleInstance,
    Protocol,
    SessionFile,
}

/// Parser input before it is normalized into an SSH launch request.
#[derive(Clone, PartialEq, Eq)]
pub struct ExternalLaunchParseInput {
    pub source_tool: Option<ExternalLaunchSourceTool>,
    pub entrypoint: ExternalLaunchEntrypoint,
    pub argv: Vec<String>,
    pub persona: Option<String>,
    pub parent_command_line: Option<String>,
}

impl ExternalLaunchParseInput {
    pub fn direct_argv(tool: ExternalLaunchSourceTool, argv: Vec<String>) -> Self {
        Self {
            source_tool: Some(tool),
            entrypoint: ExternalLaunchEntrypoint::DirectArgv,
            argv,
            persona: Some(tool.as_str().to_owned()),
            parent_command_line: None,
        }
    }

    pub fn inferred_direct_argv(argv: Vec<String>) -> Self {
        Self {
            source_tool: None,
            entrypoint: ExternalLaunchEntrypoint::DirectArgv,
            argv,
            persona: None,
            parent_command_line: None,
        }
    }

    pub fn from_args(
        entrypoint: ExternalLaunchEntrypoint,
        source_tool: Option<ExternalLaunchSourceTool>,
        persona: Option<String>,
        argv: Vec<String>,
    ) -> Self {
        Self {
            source_tool,
            entrypoint,
            argv,
            persona,
            parent_command_line: None,
        }
    }

    pub fn from_args_with_parent_command_line(
        entrypoint: ExternalLaunchEntrypoint,
        source_tool: Option<ExternalLaunchSourceTool>,
        persona: Option<String>,
        argv: Vec<String>,
        parent_command_line: Option<String>,
    ) -> Self {
        Self {
            source_tool,
            entrypoint,
            argv,
            persona,
            parent_command_line: parent_command_line
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
        }
    }
}

/// External launch source metadata.
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchSource {
    pub tool: ExternalLaunchSourceTool,
    pub entrypoint: ExternalLaunchEntrypoint,
    pub persona: Option<String>,
    pub argv0: Option<String>,
}

/// Normalized SSH target.
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSshTarget {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    #[serde(default)]
    pub route: Vec<ExternalSshRouteHop>,
}

impl ExternalSshTarget {
    pub fn new(host: impl Into<String>, port: u16, username: Option<String>) -> AppResult<Self> {
        let host = host.into();
        let host = host.trim();
        if host.is_empty() {
            return Err(AppError::InvalidInput(
                "external SSH launch target host is required".to_owned(),
            ));
        }
        if port == 0 {
            return Err(AppError::InvalidInput(
                "external SSH launch target port must be within 1..=65535".to_owned(),
            ));
        }
        Ok(Self {
            host: host.to_owned(),
            port,
            username: username
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
            route: Vec::new(),
        })
    }

    pub fn display_name(&self) -> String {
        match &self.username {
            Some(username) => format!("{}@{}", redacted_external_username(username), self.host),
            None => self.host.clone(),
        }
    }
}

impl fmt::Debug for ExternalSshTarget {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalSshTarget")
            .field("host", &"<redacted>")
            .field("port", &self.port)
            .field("username_present", &self.username.is_some())
            .field("route_hops", &self.route.len())
            .finish()
    }
}

/// One best-effort route hop parsed from an external launch request.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSshRouteHop {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
}

/// Authentication material discovered in the external launch request.
#[derive(Clone, PartialEq, Eq, Default)]
pub struct ExternalSshAuth {
    pub password: Option<ExternalSecretSlot>,
    pub identity_file: Option<String>,
    pub password_file: Option<String>,
    pub key_passphrase: Option<ExternalSecretSlot>,
    pub agent: bool,
}

impl ExternalSshAuth {
    pub fn has_password(&self) -> bool {
        self.password.is_some() || self.password_file.is_some()
    }

    pub fn has_secret_material(&self) -> bool {
        self.password.is_some() || self.key_passphrase.is_some()
    }
}

impl fmt::Debug for ExternalSshAuth {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalSshAuth")
            .field("has_password", &self.password.is_some())
            .field(
                "identity_file",
                &self.identity_file.as_ref().map(|_| "<redacted>"),
            )
            .field(
                "password_file",
                &self.password_file.as_ref().map(|_| "<redacted>"),
            )
            .field("has_key_passphrase", &self.key_passphrase.is_some())
            .field("agent", &self.agent)
            .finish()
    }
}

/// Secret category carried by the request before TASK-003 moves it into the broker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalSecretKind {
    Password,
    KeyPassphrase,
}

impl ExternalSecretKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::KeyPassphrase => "key-passphrase",
        }
    }
}

/// Source of a secret value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalSecretSource {
    CommandLine,
    PasswordFile,
    Url,
    JsonEnvelope,
}

/// Secret material state inside an external launch request.
#[derive(Clone, PartialEq, Eq)]
pub enum ExternalSecretSlot {
    Inline(ExternalSecretMaterial),
    SessionRef(ExternalSessionSecretRef),
}

impl ExternalSecretSlot {
    pub fn inline(
        kind: ExternalSecretKind,
        source: ExternalSecretSource,
        value: impl Into<String>,
    ) -> AppResult<Self> {
        Ok(Self::Inline(ExternalSecretMaterial::new(
            kind, source, value,
        )?))
    }

    pub fn session_ref(secret_ref: ExternalSessionSecretRef) -> Self {
        Self::SessionRef(secret_ref)
    }

    pub fn as_session_ref(&self) -> Option<&ExternalSessionSecretRef> {
        match self {
            Self::Inline(_) => None,
            Self::SessionRef(secret_ref) => Some(secret_ref),
        }
    }

    pub fn is_session_ref(&self) -> bool {
        self.as_session_ref().is_some()
    }
}

impl fmt::Debug for ExternalSecretSlot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Inline(material) => formatter.debug_tuple("Inline").field(material).finish(),
            Self::SessionRef(secret_ref) => formatter
                .debug_tuple("SessionRef")
                .field(secret_ref)
                .finish(),
        }
    }
}

/// Secret value wrapper. Debug output is intentionally redacted.
#[derive(Clone, PartialEq, Eq)]
pub struct ExternalSecretMaterial {
    pub kind: ExternalSecretKind,
    pub source: ExternalSecretSource,
    value: String,
}

impl ExternalSecretMaterial {
    pub fn new(
        kind: ExternalSecretKind,
        source: ExternalSecretSource,
        value: impl Into<String>,
    ) -> AppResult<Self> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "external SSH launch secret must not be empty".to_owned(),
            ));
        }
        Ok(Self {
            kind,
            source,
            value,
        })
    }

    pub fn expose_for_broker(&self) -> &str {
        &self.value
    }

    pub(crate) fn into_value(mut self) -> String {
        std::mem::take(&mut self.value)
    }
}

impl fmt::Debug for ExternalLaunchSource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchSource")
            .field("tool", &self.tool)
            .field("entrypoint", &self.entrypoint)
            .field("persona_present", &self.persona.is_some())
            .field("argv0_present", &self.argv0.is_some())
            .finish()
    }
}

impl fmt::Debug for ExternalLaunchParseInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchParseInput")
            .field("source_tool", &self.source_tool)
            .field("entrypoint", &self.entrypoint)
            .field("arg_count", &self.argv.len())
            .field("persona_present", &self.persona.is_some())
            .field(
                "parent_command_line_present",
                &self.parent_command_line.is_some(),
            )
            .finish()
    }
}

impl Drop for ExternalSecretMaterial {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

impl fmt::Debug for ExternalSecretMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalSecretMaterial")
            .field("kind", &self.kind)
            .field("source", &self.source)
            .field("value", &"<redacted>")
            .finish()
    }
}

/// Session-only secret ref returned by the external launch secret broker.
#[derive(Clone, PartialEq, Eq)]
pub struct ExternalSessionSecretRef {
    pub ref_id: String,
    pub launch_id: String,
    pub kind: ExternalSecretKind,
    pub source: ExternalSecretSource,
}

impl fmt::Debug for ExternalSessionSecretRef {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalSessionSecretRef")
            .field("ref_id", &"<redacted>")
            .field(
                "request_hash",
                &super::redaction::opaque_id_hash(&self.launch_id),
            )
            .field("kind", &self.kind)
            .field("source", &self.source)
            .finish()
    }
}

/// Options that influence the initial workspace tab or future materialization.
#[derive(Clone, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSshLaunchOptions {
    pub display_name: Option<String>,
    pub remote_command: Option<String>,
    pub remote_command_file: Option<String>,
    pub open_sftp: bool,
    pub session_name: Option<String>,
}

impl fmt::Debug for ExternalSshLaunchOptions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalSshLaunchOptions")
            .field("display_name_present", &self.display_name.is_some())
            .field("remote_command_present", &self.remote_command.is_some())
            .field(
                "remote_command_file_present",
                &self.remote_command_file.is_some(),
            )
            .field("open_sftp", &self.open_sftp)
            .field("session_name_present", &self.session_name.is_some())
            .finish()
    }
}

/// Redacted parser diagnostics.
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchRequestDiagnostics {
    pub parser: String,
    pub argv_redacted: Vec<String>,
    pub raw_hash: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

impl fmt::Debug for ExternalLaunchRequestDiagnostics {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchRequestDiagnostics")
            .field("parser", &self.parser)
            .field("arg_count", &self.argv_redacted.len())
            .field("raw_hash", &self.raw_hash)
            .field("warning_count", &self.warnings.len())
            .finish()
    }
}

/// Normalized external SSH launch request.
#[derive(Clone, PartialEq, Eq)]
pub struct ExternalSshLaunchRequest {
    pub id: String,
    pub source: ExternalLaunchSource,
    pub received_at: String,
    pub target: ExternalSshTarget,
    pub intent: ExternalLaunchIntent,
    pub auth: ExternalSshAuth,
    pub options: ExternalSshLaunchOptions,
    pub diagnostics: ExternalLaunchRequestDiagnostics,
}

impl fmt::Debug for ExternalSshLaunchRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalSshLaunchRequest")
            .field("request_hash", &super::redaction::opaque_id_hash(&self.id))
            .field("source", &self.source)
            .field("received_at", &self.received_at)
            .field("target", &self.target)
            .field("intent", &self.intent)
            .field("auth", &self.auth)
            .field("options", &self.options)
            .field("diagnostics", &self.diagnostics)
            .finish()
    }
}

impl ExternalSshLaunchRequest {
    pub fn new(
        source: ExternalLaunchSource,
        target: ExternalSshTarget,
        auth: ExternalSshAuth,
        mut options: ExternalSshLaunchOptions,
        diagnostics: ExternalLaunchRequestDiagnostics,
    ) -> Self {
        if options.display_name.is_none() {
            options.display_name = Some(target.display_name());
        }
        Self {
            id: Uuid::new_v4().to_string(),
            source,
            received_at: unix_timestamp(),
            target,
            intent: ExternalLaunchIntent::SshTerminal,
            auth,
            options,
            diagnostics,
        }
    }

    pub fn with_intent(mut self, intent: ExternalLaunchIntent) -> Self {
        self.intent = intent;
        self
    }
}

fn normalize_tool_name(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .replace(' ', "")
}

fn redacted_external_username(username: &str) -> String {
    if username
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("b64>>"))
    {
        "b64>><redacted>".to_owned()
    } else if looks_like_opaque_external_username(username) {
        "<redacted-external-user>".to_owned()
    } else {
        username.to_owned()
    }
}

fn looks_like_opaque_external_username(username: &str) -> bool {
    let username = username.trim();
    if username.len() < 32 || username.contains('@') {
        return false;
    }
    let token_chars = username
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '+' | '/' | '='))
        .count();
    token_chars * 100 / username.len() >= 80
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
