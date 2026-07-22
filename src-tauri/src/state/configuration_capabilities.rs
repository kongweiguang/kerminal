//! AppState 的配置与工作空间能力组合。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::{config_change::ConfigDomain, settings::AppSettings},
    paths::KerminalPaths,
    services::{
        config_change_observer_service::ConfigChangeObserverService,
        profile_service::ProfileService, settings_service::SettingsService,
        snippet_service::SnippetService, workflow_service::WorkflowService,
        workspace_sync_service::WorkspaceSyncService,
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};

use super::StartupRecoverySnapshot;

/// 配置文件和其派生工作空间服务的能力组合。
#[derive(Debug)]
pub(super) struct ConfigurationCapabilities {
    pub(super) config_change_observer: ConfigChangeObserverService,
    pub(super) profiles: ProfileService,
    pub(super) settings: SettingsService,
    pub(super) snippets: SnippetService,
    pub(super) workflows: WorkflowService,
    pub(super) workspace_sync: WorkspaceSyncService,
}

impl ConfigurationCapabilities {
    /// 初始化配置域，并把损坏 settings/profile 的只读恢复状态显式返回给组合根。
    pub(super) fn initialize(
        paths: &KerminalPaths,
        config_files: ConfigFileStore,
    ) -> AppResult<(Self, AppSettings, StartupRecoverySnapshot)> {
        let workspace_sync = WorkspaceSyncService::new(paths.clone());
        workspace_sync.ensure_bootstrap()?;

        let mut startup_recovery = StartupRecoverySnapshot::default();
        match config_files.migrate_remote_host_schema_v1() {
            Ok(_) => {}
            Err(FileStoreError::TomlParse(_) | FileStoreError::InvalidPath(_)) => {
                startup_recovery.record_invalid(
                    ConfigDomain::Hosts,
                    "hosts/*.toml",
                    "旧主机配置无法安全升级，原文件已保留且未部分写入。",
                );
            }
            Err(FileStoreError::Io(error)) => return Err(error.into()),
            Err(_) => {
                return Err(AppError::InvalidInput(
                    "主机配置升级事务失败，原文件未被覆盖。".to_owned(),
                ))
            }
        }
        let settings = SettingsService::new(config_files.clone());
        let persisted_settings = match settings
            .ensure_seed_settings()
            .and_then(|_| settings.load_settings())
        {
            Ok(settings) => settings,
            Err(AppError::InvalidInput(_)) => {
                startup_recovery.record_invalid(
                    ConfigDomain::Settings,
                    "settings.toml",
                    "应用设置无效，已使用本次进程的安全默认值。",
                );
                let fallback = AppSettings::default();
                settings.enter_read_only_recovery(fallback.clone())?;
                fallback
            }
            Err(error) => return Err(error),
        };

        let profiles = ProfileService::new(config_files.clone());
        match profiles.ensure_seed_profiles() {
            Ok(()) => {}
            Err(AppError::InvalidInput(_)) => {
                startup_recovery.record_invalid(
                    ConfigDomain::Profiles,
                    "profiles/*.toml",
                    "终端 Profile 无效，已进入只读恢复且保留原文件。",
                );
                profiles.enter_read_only_recovery()?;
            }
            Err(error) => return Err(error),
        }

        Ok((
            Self {
                config_change_observer: ConfigChangeObserverService::new(config_files.clone()),
                profiles,
                settings,
                snippets: SnippetService::new(config_files.clone()),
                workflows: WorkflowService::new(config_files),
                workspace_sync,
            },
            persisted_settings,
            startup_recovery,
        ))
    }
}
