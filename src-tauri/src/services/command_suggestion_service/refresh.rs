// @author kongweiguang

use super::*;

impl CommandSuggestionService {
    pub async fn refresh_remote_paths(
        &self,
        storage: &CommandSqliteStore,
        paths: &KerminalPaths,
        sftp: &SftpService,
        inline_settings: TerminalInlineSuggestionSettings,
        request: CommandSuggestionRemotePathRefreshRequest,
    ) -> AppResult<CommandSuggestionRemotePathRefreshResult> {
        let request = NormalizedRemotePathRefreshRequest::try_from(request)?;
        let audit_host_id = request.host_id.clone();
        let audit_path = request.path.clone();
        let audit_max_entries = request.max_entries;
        let audit_ttl_seconds = request.ttl_seconds;
        if let Some(skip) = self.remote_probe_policy_skip(&inline_settings)? {
            self.record_remote_probe_schedule_skip_audit(
                Some(storage),
                SuggestionProviderKind::RemotePath,
                audit_host_id,
                None,
                Some(audit_path),
                &skip,
                audit_max_entries,
                audit_ttl_seconds,
            );
            return Ok(Self::skipped_remote_path_refresh_result(request));
        }
        let refresh_key = RemotePathCacheKey {
            directory: request.path.clone(),
            host_id: request.host_id.clone(),
        };
        let refresh_host_id = request.host_id.clone();
        let result = remote_refresh_result(
            self.remote_path_refresh
                .refresh_scoped(
                    refresh_key,
                    1,
                    &refresh_host_id,
                    std::time::Instant::now(),
                    move |_| async move {
                        let listing = sftp
                            .list_directory(
                                paths,
                                SftpListDirectoryRequest {
                                    host_id: request.host_id,
                                    path: request.path,
                                },
                            )
                            .await?;
                        self.cache_remote_path_listing(
                            Some(storage),
                            listing,
                            request.ttl_seconds,
                            request.max_entries,
                        )
                    },
                )
                .await,
            "远端路径",
        );
        if let Err(error) = result.as_ref() {
            self.record_refresh_failure(
                Some(storage),
                SuggestionProviderKind::RemotePath,
                error.to_string(),
            );
        }
        self.record_remote_probe_refresh_audit(
            Some(storage),
            SuggestionProviderKind::RemotePath,
            audit_host_id,
            None,
            Some(audit_path),
            result.is_ok(),
            audit_max_entries,
            audit_ttl_seconds,
        );
        result
    }

    /// 通过受控 SSH 命令刷新远端命令建议缓存。
    pub async fn refresh_remote_commands(
        &self,
        storage: &CommandSqliteStore,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        inline_settings: TerminalInlineSuggestionSettings,
        request: CommandSuggestionRemoteCommandRefreshRequest,
    ) -> AppResult<CommandSuggestionRemoteCommandRefreshResult> {
        let request = NormalizedRemoteCommandRefreshRequest::try_from(request)?;
        let audit_host_id = request.host_id.clone();
        let audit_max_entries = request.max_entries;
        let audit_ttl_seconds = request.ttl_seconds;
        if let Some(skip) = self.remote_probe_policy_skip(&inline_settings)? {
            self.record_remote_probe_schedule_skip_audit(
                Some(storage),
                SuggestionProviderKind::RemoteCommand,
                audit_host_id,
                None,
                None,
                &skip,
                audit_max_entries,
                audit_ttl_seconds,
            );
            return Ok(Self::skipped_remote_command_refresh_result(request));
        }
        let refresh_key = request.host_id.clone();
        let refresh_host_id = request.host_id.clone();
        let result = remote_refresh_result(
            self.remote_command_refresh
                .refresh_scoped(
                    refresh_key,
                    1,
                    &refresh_host_id,
                    std::time::Instant::now(),
                    move |_| async move {
                        let output = ssh_commands
                            .execute_native(
                                paths,
                                SshCommandRequest {
                                    command: REMOTE_COMMAND_DISCOVERY_SCRIPT.to_owned(),
                                    host_id: request.host_id.clone(),
                                    max_output_bytes: Some(REMOTE_COMMAND_DISCOVERY_OUTPUT_BYTES),
                                    timeout_seconds: Some(REMOTE_COMMAND_DISCOVERY_TIMEOUT_SECS),
                                },
                            )
                            .await?;
                        let commands = parse_remote_command_names(&output.stdout);
                        if commands.is_empty() && !output.success {
                            return Err(AppError::SshCommand(format!(
                                "远端命令探测失败: {}",
                                output.stderr.trim()
                            )));
                        }
                        self.cache_remote_commands(
                            Some(storage),
                            request.host_id,
                            commands,
                            request.ttl_seconds,
                            request.max_entries,
                        )
                    },
                )
                .await,
            "远端命令",
        );
        if let Err(error) = result.as_ref() {
            self.record_refresh_failure(
                Some(storage),
                SuggestionProviderKind::RemoteCommand,
                error.to_string(),
            );
        }
        self.record_remote_probe_refresh_audit(
            Some(storage),
            SuggestionProviderKind::RemoteCommand,
            audit_host_id,
            None,
            None,
            result.is_ok(),
            audit_max_entries,
            audit_ttl_seconds,
        );
        result
    }

    /// 通过受控 SSH 命令刷新远端 shell history 建议缓存。
    pub async fn refresh_remote_history(
        &self,
        storage: &CommandSqliteStore,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        inline_settings: TerminalInlineSuggestionSettings,
        request: CommandSuggestionRemoteHistoryRefreshRequest,
    ) -> AppResult<CommandSuggestionRemoteHistoryRefreshResult> {
        let request = NormalizedRemoteHistoryRefreshRequest::try_from(request)?;
        let audit_host_id = request.host_id.clone();
        let audit_max_entries = request.max_entries;
        let audit_ttl_seconds = request.ttl_seconds;
        if let Some(skip) = self.remote_probe_policy_skip(&inline_settings)? {
            self.record_remote_probe_schedule_skip_audit(
                Some(storage),
                SuggestionProviderKind::History,
                audit_host_id,
                None,
                None,
                &skip,
                audit_max_entries,
                audit_ttl_seconds,
            );
            return Ok(Self::skipped_remote_history_refresh_result(request));
        }
        let refresh_key = request.host_id.clone();
        let refresh_host_id = request.host_id.clone();
        let result = remote_refresh_result(
            self.remote_history_refresh
                .refresh_scoped(
                    refresh_key,
                    1,
                    &refresh_host_id,
                    std::time::Instant::now(),
                    move |_| async move {
                        let output = ssh_commands
                            .execute_native(
                                paths,
                                SshCommandRequest {
                                    command: REMOTE_HISTORY_DISCOVERY_SCRIPT.to_owned(),
                                    host_id: request.host_id.clone(),
                                    max_output_bytes: Some(REMOTE_HISTORY_DISCOVERY_OUTPUT_BYTES),
                                    timeout_seconds: Some(REMOTE_HISTORY_DISCOVERY_TIMEOUT_SECS),
                                },
                            )
                            .await?;
                        let commands =
                            parse_remote_history_commands(&output.stdout, request.max_entries);
                        if commands.is_empty() && !output.success {
                            return Err(AppError::SshCommand(format!(
                                "远端 shell history 探测失败: {}",
                                output.stderr.trim()
                            )));
                        }
                        self.cache_remote_history(
                            Some(storage),
                            request.host_id,
                            commands,
                            request.ttl_seconds,
                            request.max_entries,
                        )
                    },
                )
                .await,
            "远端历史",
        );
        if let Err(error) = result.as_ref() {
            self.record_refresh_failure(
                Some(storage),
                SuggestionProviderKind::History,
                error.to_string(),
            );
        }
        self.record_remote_probe_refresh_audit(
            Some(storage),
            SuggestionProviderKind::History,
            audit_host_id,
            None,
            None,
            result.is_ok(),
            audit_max_entries,
            audit_ttl_seconds,
        );
        result
    }

    /// 通过受控 SSH 命令刷新 Git refs 建议缓存。
    pub async fn refresh_git_refs(
        &self,
        storage: &CommandSqliteStore,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        inline_settings: TerminalInlineSuggestionSettings,
        request: CommandSuggestionGitRefreshRequest,
    ) -> AppResult<CommandSuggestionGitRefreshResult> {
        let request = NormalizedGitRefreshRequest::try_from(request)?;
        let audit_host_id = request.host_id.clone();
        let audit_cwd = request.cwd.clone();
        let audit_max_entries = request.max_entries;
        let audit_ttl_seconds = request.ttl_seconds;
        if let Some(skip) = self.remote_probe_policy_skip(&inline_settings)? {
            self.record_remote_probe_schedule_skip_audit(
                Some(storage),
                SuggestionProviderKind::Git,
                audit_host_id,
                Some(audit_cwd),
                None,
                &skip,
                audit_max_entries,
                audit_ttl_seconds,
            );
            return Ok(Self::skipped_git_refresh_result(request));
        }
        let refresh_key = GitCacheKey {
            cwd: request.cwd.clone(),
            host_id: request.host_id.clone(),
        };
        let refresh_host_id = request.host_id.clone();
        let result = remote_refresh_result(
            self.git_refresh
                .refresh_scoped(
                    refresh_key,
                    1,
                    &refresh_host_id,
                    std::time::Instant::now(),
                    move |_| async move {
                        let output = ssh_commands
                            .execute_native(
                                paths,
                                SshCommandRequest {
                                    command: git_discovery_script(&request.cwd)?,
                                    host_id: request.host_id.clone(),
                                    max_output_bytes: Some(GIT_DISCOVERY_OUTPUT_BYTES),
                                    timeout_seconds: Some(GIT_DISCOVERY_TIMEOUT_SECS),
                                },
                            )
                            .await?;
                        let discovery = parse_git_discovery_output(&output.stdout);
                        if discovery.entries.is_empty()
                            && discovery.repo_root.is_none()
                            && !output.success
                        {
                            return Err(AppError::SshCommand(format!(
                                "Git refs 探测失败: {}",
                                output.stderr.trim()
                            )));
                        }
                        self.cache_git_refs(
                            Some(storage),
                            request.host_id,
                            request.cwd,
                            discovery.repo_root,
                            discovery.entries,
                            request.ttl_seconds,
                            request.max_entries,
                        )
                    },
                )
                .await,
            "Git refs",
        );
        if let Err(error) = result.as_ref() {
            self.record_refresh_failure(
                Some(storage),
                SuggestionProviderKind::Git,
                error.to_string(),
            );
        }
        self.record_remote_probe_refresh_audit(
            Some(storage),
            SuggestionProviderKind::Git,
            audit_host_id,
            Some(audit_cwd),
            None,
            result.is_ok(),
            audit_max_entries,
            audit_ttl_seconds,
        );
        result
    }

    /// 将已采集的远端命令列表写入建议缓存。
    pub fn cache_remote_commands(
        &self,
        storage: Option<&CommandSqliteStore>,
        host_id: String,
        commands: Vec<String>,
        ttl_seconds: u64,
        max_entries: usize,
    ) -> AppResult<CommandSuggestionRemoteCommandRefreshResult> {
        let host_id = normalize_required_text("SSH 主机 id", host_id, MAX_CONTEXT_CHARS)?;
        let ttl_seconds = ttl_seconds.clamp(1, MAX_REMOTE_COMMAND_TTL_SECS);
        let max_entries = max_entries.clamp(1, MAX_REMOTE_COMMAND_MAX_ENTRIES);
        let cached_at = SystemTime::now();
        let expires_at = cached_at + Duration::from_secs(ttl_seconds);
        let mut builtin_commands = POSIX_SHELL_BUILTINS
            .iter()
            .filter(|command| is_cacheable_remote_command(command))
            .map(|command| (*command).to_owned())
            .collect::<Vec<_>>();
        builtin_commands.sort();
        builtin_commands.dedup();
        let builtin_set = builtin_commands
            .iter()
            .cloned()
            .collect::<HashSet<String>>();
        let mut path_command_set = HashSet::new();
        for command in commands {
            let command = command.trim().to_owned();
            if is_cacheable_remote_command(&command) && !builtin_set.contains(&command) {
                path_command_set.insert(command);
            }
        }
        let mut path_commands = path_command_set.into_iter().collect::<Vec<_>>();
        path_commands.sort();

        let path_capacity = max_entries.saturating_sub(builtin_commands.len());
        let mut commands = Vec::with_capacity(max_entries);
        commands.extend(builtin_commands.into_iter().take(max_entries));
        commands.extend(path_commands.into_iter().take(path_capacity));
        commands.sort();
        let command_count = commands.len();
        let payload_json = serde_json::to_string(&commands)?;

        let cache_entry = RemoteCommandCacheEntry {
            cached_at,
            commands,
            expires_at,
            ttl_seconds,
        };
        let mut cache = self.remote_command_cache()?;
        prune_remote_command_cache(&mut cache, cached_at);
        cache.insert(host_id.clone(), cache_entry);
        drop(cache);

        if let Some(storage) = storage {
            upsert_provider_cache(
                storage,
                SuggestionProviderKind::RemoteCommand,
                &host_id,
                REMOTE_COMMAND_CACHE_SCOPE_KEY,
                None,
                payload_json,
                cached_at,
                expires_at,
                ttl_seconds,
            )?;
        }

        self.record_refresh_success(storage, SuggestionProviderKind::RemoteCommand);

        Ok(CommandSuggestionRemoteCommandRefreshResult {
            cached_at_unix_ms: unix_time_millis(cached_at),
            command_count,
            host_id,
            ttl_seconds,
        })
    }

    /// 将已采集的远端 shell history 列表写入建议缓存。
    pub fn cache_remote_history(
        &self,
        storage: Option<&CommandSqliteStore>,
        host_id: String,
        commands: Vec<String>,
        ttl_seconds: u64,
        max_entries: usize,
    ) -> AppResult<CommandSuggestionRemoteHistoryRefreshResult> {
        let host_id = normalize_required_text("SSH 主机 id", host_id, MAX_CONTEXT_CHARS)?;
        let ttl_seconds = ttl_seconds.clamp(1, MAX_REMOTE_HISTORY_TTL_SECS);
        let max_entries = max_entries.clamp(1, MAX_REMOTE_HISTORY_MAX_ENTRIES);
        let cached_at = SystemTime::now();
        let expires_at = cached_at + Duration::from_secs(ttl_seconds);
        let commands = normalize_remote_history_commands(commands, max_entries);
        let command_count = commands.len();
        let payload_json = serde_json::to_string(&commands)?;

        let cache_entry = RemoteHistoryCacheEntry {
            cached_at,
            commands,
            expires_at,
            ttl_seconds,
        };
        let mut cache = self.remote_history_cache()?;
        prune_remote_history_cache(&mut cache, cached_at);
        cache.insert(host_id.clone(), cache_entry);
        drop(cache);

        if let Some(storage) = storage {
            upsert_provider_cache(
                storage,
                SuggestionProviderKind::History,
                &host_id,
                REMOTE_HISTORY_CACHE_SCOPE_KEY,
                None,
                payload_json,
                cached_at,
                expires_at,
                ttl_seconds,
            )?;
        }

        self.record_refresh_success(storage, SuggestionProviderKind::History);

        Ok(CommandSuggestionRemoteHistoryRefreshResult {
            cached_at_unix_ms: unix_time_millis(cached_at),
            command_count,
            host_id,
            ttl_seconds,
        })
    }

    /// 将已采集的 Git refs/remote 列表写入建议缓存。
    #[allow(clippy::too_many_arguments)]
    pub fn cache_git_refs(
        &self,
        storage: Option<&CommandSqliteStore>,
        host_id: String,
        cwd: String,
        repo_root: Option<String>,
        entries: Vec<GitRefEntry>,
        ttl_seconds: u64,
        max_entries: usize,
    ) -> AppResult<CommandSuggestionGitRefreshResult> {
        let host_id = normalize_required_text("SSH 主机 id", host_id, MAX_CONTEXT_CHARS)?;
        let cwd = normalize_remote_cache_path(&normalize_required_text(
            "远程工作目录",
            cwd,
            MAX_CONTEXT_CHARS,
        )?);
        let repo_root = repo_root
            .map(|value| normalize_remote_cache_path(&value))
            .filter(|value| !value.trim().is_empty());
        let ttl_seconds = ttl_seconds.clamp(1, MAX_GIT_TTL_SECS);
        let max_entries = max_entries.clamp(1, MAX_GIT_MAX_ENTRIES);
        let cached_at = SystemTime::now();
        let expires_at = cached_at + Duration::from_secs(ttl_seconds);
        let mut seen = HashSet::new();
        let mut entries = entries
            .into_iter()
            .filter(|entry| is_cacheable_git_ref_name(&entry.name))
            .filter(|entry| seen.insert((entry.kind, entry.name.clone())))
            .collect::<Vec<_>>();
        entries.sort_by(compare_git_ref_entries);
        entries.truncate(max_entries);
        let entry_count = entries.len();
        let payload_json = serde_json::to_string(&entries)?;
        let cache_entry = GitCacheEntry {
            cached_at,
            cwd: cwd.clone(),
            entries,
            expires_at,
            repo_root: repo_root.clone(),
            ttl_seconds,
        };
        let key = GitCacheKey {
            cwd: cwd.clone(),
            host_id: host_id.clone(),
        };
        let mut cache = self.git_ref_cache()?;
        prune_git_cache(&mut cache, cached_at);
        if !cache.contains_key(&key) && cache.len() >= MAX_GIT_CACHE_REPOSITORIES {
            remove_oldest_git_cache_entry(&mut cache);
        }
        cache.insert(key, cache_entry);
        drop(cache);

        if let Some(storage) = storage {
            upsert_provider_cache(
                storage,
                SuggestionProviderKind::Git,
                &host_id,
                &cwd,
                repo_root.as_deref(),
                payload_json,
                cached_at,
                expires_at,
                ttl_seconds,
            )?;
        }

        self.record_refresh_success(storage, SuggestionProviderKind::Git);

        Ok(CommandSuggestionGitRefreshResult {
            cached_at_unix_ms: unix_time_millis(cached_at),
            cwd,
            entry_count,
            host_id,
            repo_root,
            ttl_seconds,
        })
    }

    /// 将已获得的 SFTP 目录列表写入建议缓存。
    pub fn cache_remote_path_listing(
        &self,
        storage: Option<&CommandSqliteStore>,
        listing: SftpDirectoryListing,
        ttl_seconds: u64,
        max_entries: usize,
    ) -> AppResult<CommandSuggestionRemotePathRefreshResult> {
        let host_id = normalize_required_text("SSH 主机 id", listing.host_id, MAX_CONTEXT_CHARS)?;
        let path = normalize_remote_cache_path(&normalize_required_text(
            "远程目录",
            listing.path,
            MAX_CONTEXT_CHARS,
        )?);
        let ttl_seconds = ttl_seconds.clamp(1, MAX_REMOTE_PATH_TTL_SECS);
        let max_entries = max_entries.clamp(1, MAX_REMOTE_PATH_MAX_ENTRIES);
        let cached_at = SystemTime::now();
        let expires_at = cached_at + Duration::from_secs(ttl_seconds);
        let mut entries = listing.entries;
        entries.retain(is_cacheable_remote_entry);
        entries.sort_by(compare_sftp_entries);
        entries.truncate(max_entries);
        let entry_count = entries.len();
        let payload_json = serde_json::to_string(&entries)?;

        let key = RemotePathCacheKey {
            directory: path.clone(),
            host_id: host_id.clone(),
        };
        let cache_entry = RemotePathCacheEntry {
            cached_at,
            entries,
            expires_at,
            ttl_seconds,
        };
        let mut cache = self.remote_path_cache()?;
        prune_remote_path_cache(&mut cache, cached_at);
        if !cache.contains_key(&key) && cache.len() >= MAX_REMOTE_PATH_CACHE_DIRECTORIES {
            remove_oldest_remote_path_cache_entry(&mut cache);
        }
        cache.insert(key, cache_entry);
        drop(cache);

        if let Some(storage) = storage {
            upsert_provider_cache(
                storage,
                SuggestionProviderKind::RemotePath,
                &host_id,
                &path,
                None,
                payload_json,
                cached_at,
                expires_at,
                ttl_seconds,
            )?;
        }

        self.record_refresh_success(storage, SuggestionProviderKind::RemotePath);

        Ok(CommandSuggestionRemotePathRefreshResult {
            cached_at_unix_ms: unix_time_millis(cached_at),
            entry_count,
            host_id,
            path,
            ttl_seconds,
        })
    }
}

fn remote_refresh_result<V: Clone>(outcome: RemoteRefreshOutcome<V>, label: &str) -> AppResult<V> {
    match outcome {
        RemoteRefreshOutcome::Fresh(value)
        | RemoteRefreshOutcome::Refreshed(value)
        | RemoteRefreshOutcome::Coalesced(value) => Ok((*value).clone()),
        RemoteRefreshOutcome::Backoff {
            stale: Some(value), ..
        }
        | RemoteRefreshOutcome::Cancelled { stale: Some(value) }
        | RemoteRefreshOutcome::Superseded { stale: Some(value) } => Ok((*value).clone()),
        RemoteRefreshOutcome::Failed { error, .. } => Err(AppError::RemoteSuggestion(format!(
            "{label}刷新失败: {error}"
        ))),
        RemoteRefreshOutcome::Backoff { retry_after, .. } => {
            Err(AppError::RemoteSuggestion(format!(
                "{label}刷新处于退避窗口，约 {}ms 后重试",
                retry_after.as_millis()
            )))
        }
        RemoteRefreshOutcome::Cancelled { .. } => {
            Err(AppError::RemoteSuggestion(format!("{label}刷新已取消")))
        }
        RemoteRefreshOutcome::Superseded { .. } => {
            Err(AppError::RemoteSuggestion(format!("{label}刷新结果已过期")))
        }
    }
}
