use super::*;

pub(super) struct SmokeHarness {
    _home: TempDir,
    pub(super) history: CommandHistoryService,
    pub(super) paths: KerminalPaths,
    pub(super) remote_hosts: RemoteHostService,
    pub(super) sftp: SftpService,
    pub(super) ssh_commands: SshCommandService,
    pub(super) storage: CommandSqliteStore,
    pub(super) suggestions: CommandSuggestionService,
}

impl SmokeHarness {
    pub(super) fn new() -> Self {
        let home = tempdir().expect("create temporary Kerminal home");
        let paths = KerminalPaths::from_home_dir(home.path());
        let storage = CommandSqliteStore::open(&paths).expect("open temporary SQLite store");
        let config_files = ConfigFileStore::new(paths.root.clone());
        Self {
            _home: home,
            history: CommandHistoryService::new(),
            paths,
            remote_hosts: RemoteHostService::new(config_files),
            sftp: SftpService::new(),
            ssh_commands: SshCommandService::new(),
            storage,
            suggestions: CommandSuggestionService::new(),
        }
    }

    pub(super) fn create_remote_host(
        &self,
        config: &SmokeConfig,
    ) -> kerminal_lib::models::remote_host::RemoteHost {
        self.create_remote_host_with_production(config, false)
    }

    pub(super) fn create_remote_host_with_production(
        &self,
        config: &SmokeConfig,
        production: bool,
    ) -> kerminal_lib::models::remote_host::RemoteHost {
        self.remote_hosts
            .create_host(RemoteHostCreateRequest {
                auth_type: config.auth_type,
                credential_ref: config.credential_ref.clone(),
                credential_secret: config.credential_secret.clone(),
                group_id: None,
                host: config.host.clone(),
                name: "SSH suggestion smoke".to_owned(),
                port: config.port,
                production,
                ssh_options: Default::default(),
                tags: vec!["smoke".to_owned(), "command-suggestion".to_owned()],
                username: config.username.clone(),
                protocol: Default::default(),
            })
            .expect("create temporary remote host")
    }

    pub(super) fn list(
        &self,
        host_id: &str,
        cwd: &str,
        input: &str,
        provider: SuggestionProviderKind,
    ) -> Vec<kerminal_lib::models::command_suggestion::CommandSuggestionCandidate> {
        self.list_from(&self.suggestions, host_id, cwd, input, provider)
    }

    pub(super) fn list_from(
        &self,
        suggestions: &CommandSuggestionService,
        host_id: &str,
        cwd: &str,
        input: &str,
        provider: SuggestionProviderKind,
    ) -> Vec<kerminal_lib::models::command_suggestion::CommandSuggestionCandidate> {
        suggestions
            .list_suggestions(
                &self.storage,
                &self.history,
                CommandSuggestionRequest {
                    context_key: None,
                    generation: None,
                    mode: Default::default(),
                    cursor: input.chars().count(),
                    cwd: Some(cwd.to_owned()),
                    input: input.to_owned(),
                    limit: Some(8),
                    pane_id: Some("smoke-pane".to_owned()),
                    profile_id: None,
                    providers: Some(vec![provider]),
                    remote_host_id: Some(host_id.to_owned()),
                    session_id: Some("smoke-session".to_owned()),
                    shell: Some("sh".to_owned()),
                    target: CommandHistoryTarget::Ssh,
                },
            )
            .expect("list cached command suggestions")
    }

    pub(super) fn inline_settings(&self) -> TerminalInlineSuggestionSettings {
        TerminalInlineSuggestionSettings::default()
    }
}

pub(super) struct SmokeConfig {
    pub(super) auth_type: RemoteHostAuthType,
    pub(super) builtin_command: String,
    pub(super) builtin_prefix: String,
    pub(super) command_prefix: String,
    pub(super) credential_ref: Option<String>,
    pub(super) credential_secret: Option<String>,
    pub(super) cwd: String,
    pub(super) git_prefix: String,
    pub(super) history_prefix: Option<String>,
    pub(super) host: String,
    pub(super) path: String,
    pub(super) path_prefix: String,
    pub(super) port: u16,
    pub(super) username: String,
}

impl SmokeConfig {
    pub(super) fn from_env() -> Option<Self> {
        if env::var(RUN_FLAG).ok().as_deref() != Some("1") {
            return None;
        }

        let host = required_env("KERMINAL_SSH_SMOKE_HOST");
        let username = required_env("KERMINAL_SSH_SMOKE_USER");
        let port = env::var("KERMINAL_SSH_SMOKE_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(22);
        let cwd = env::var("KERMINAL_SSH_SMOKE_CWD").unwrap_or_else(|_| "~".to_owned());
        let path = env::var("KERMINAL_SSH_SMOKE_PATH").unwrap_or_else(|_| cwd.clone());
        let command_prefix =
            env::var("KERMINAL_SSH_SMOKE_COMMAND_PREFIX").unwrap_or_else(|_| "ec".to_owned());
        let builtin_prefix =
            env::var("KERMINAL_SSH_SMOKE_BUILTIN_PREFIX").unwrap_or_else(|_| "umas".to_owned());
        let builtin_command =
            env::var("KERMINAL_SSH_SMOKE_BUILTIN_COMMAND").unwrap_or_else(|_| "umask".to_owned());
        let path_prefix = env::var("KERMINAL_SSH_SMOKE_PATH_PREFIX")
            .unwrap_or_else(|_| default_path_prefix(&path));
        let git_prefix = env::var("KERMINAL_SSH_SMOKE_GIT_PREFIX")
            .unwrap_or_else(|_| "git checkout ".to_owned());
        let history_prefix = env::var("KERMINAL_SSH_SMOKE_HISTORY_PREFIX")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());

        let key_path = env::var("KERMINAL_SSH_SMOKE_KEY_PATH")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from);

        let password = env::var("KERMINAL_SSH_SMOKE_PASSWORD")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let inline_key = env::var("KERMINAL_SSH_SMOKE_PRIVATE_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty());

        let (auth_type, credential_ref, credential_secret) = if let Some(password) = password {
            (RemoteHostAuthType::Password, None, Some(password))
        } else if let Some(private_key) = inline_key {
            (RemoteHostAuthType::Key, None, Some(private_key))
        } else if let Some(key_path) = key_path {
            (
                RemoteHostAuthType::Key,
                Some(key_path.to_string_lossy().to_string()),
                None,
            )
        } else if env::var("KERMINAL_SSH_SMOKE_AUTH")
            .ok()
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case("agent"))
        {
            (RemoteHostAuthType::Agent, None, None)
        } else {
            panic!(
                "set one of KERMINAL_SSH_SMOKE_PASSWORD, KERMINAL_SSH_SMOKE_PRIVATE_KEY, \
                 KERMINAL_SSH_SMOKE_KEY_PATH, or KERMINAL_SSH_SMOKE_AUTH=agent"
            );
        };

        Some(Self {
            auth_type,
            builtin_command,
            builtin_prefix,
            command_prefix,
            credential_ref,
            credential_secret,
            cwd,
            git_prefix,
            history_prefix,
            host,
            path,
            path_prefix,
            port,
            username,
        })
    }
}

fn required_env(name: &str) -> String {
    env::var(name)
        .unwrap_or_else(|_| panic!("{name} must be set when RUN_KERMINAL_SSH_SMOKE=1"))
        .trim()
        .to_owned()
}

fn default_path_prefix(path: &str) -> String {
    let normalized = path.trim_end_matches('/');
    if normalized.is_empty() || normalized == "~" {
        return "ls ".to_owned();
    }
    let parent = normalized
        .rsplit_once('/')
        .map(|(parent, _)| {
            if parent.is_empty() {
                "/".to_owned()
            } else {
                format!("{parent}/")
            }
        })
        .unwrap_or_default();
    format!("ls {parent}")
}

#[test]
fn smoke_test_is_explicitly_gated() {
    assert_ne!(
        env::var(RUN_FLAG).ok().as_deref(),
        Some("1"),
        "run the ignored smoke test explicitly instead of the unit gate test"
    );
    let _ = std_fs::metadata("Cargo.toml").expect("smoke gate should run from src-tauri");
}
