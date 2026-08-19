//! Kerminal Tauri 入口。
//!
//! @author kongweiguang

#[cfg(not(test))]
pub mod app_menu;
#[cfg(not(test))]
pub mod app_tray;
pub mod commands;
#[cfg(all(not(test), any(target_os = "macos", windows, target_os = "linux")))]
mod desktop_plugins;
pub mod error;
pub mod models;
pub mod paths;
pub mod security;
pub mod services;
pub mod state;
pub mod storage;
#[cfg(all(not(test), target_os = "windows"))]
mod window_frame;
pub mod window_management;

#[cfg(not(test))]
use state::AppState;
#[cfg(not(test))]
use tauri::{webview::PageLoadEvent, Emitter, Manager};
#[cfg(not(test))]
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let desktop_log_dir = match paths::KerminalPaths::from_environment_or_current_home() {
            Ok(paths) => paths.logs,
            Err(_) => {
                eprintln!("failed to resolve Kerminal log directory");
                return;
            }
        };
        builder = desktop_plugins::apply_desktop_plugins(builder, desktop_log_dir);
    }

    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .manage(window_management::MainWindowStartupGate::default())
        .on_page_load(|webview, payload| {
            if webview.label() != app_menu::MAIN_WINDOW_LABEL
                || payload.event() != PageLoadEvent::Finished
            {
                return;
            }
            if let Err(error) =
                window_management::notify_main_window_page_ready(webview.app_handle())
            {
                tauri_plugin_log::log::error!(
                    target: "desktop.window",
                    "failed to show main window after page load: {error}"
                );
            }
        })
        .setup(|app| {
            tauri_plugin_log::log::info!(
                target: "desktop.lifecycle",
                "starting Kerminal desktop setup"
            );
            let app_state = AppState::initialize()?;
            for diagnostic in &app_state.startup_recovery().diagnostics {
                tauri_plugin_log::log::warn!(
                    target: "desktop.startup_recovery",
                    "config recovery domain={:?} path={} message={} recovery={}",
                    diagnostic.domain,
                    diagnostic.path,
                    diagnostic.message,
                    diagnostic.recovery
                );
            }
            if !app.manage(app_state) {
                return Err("AppState was already managed during Kerminal setup".into());
            }
            let reconnect_service = app.state::<AppState>().terminal_reconnect().clone();
            let app_handle = app.handle().clone();
            reconnect_service.set_emitter(move |request| {
                app_handle
                    .emit(
                        services::terminal_reconnect_service::TERMINAL_RECONNECT_REQUEST_EVENT,
                        request,
                    )
                    .map_err(|error| {
                        error::AppError::InvalidInput(format!(
                            "terminal reconnect event emission failed: {error}"
                        ))
                    })
            })?;
            if commands::connection::cleanup_stale_rdp_artifacts().is_err() {
                // 清扫失败不阻断主窗口；日志只记录固定诊断，避免暴露本机临时路径。
                tauri_plugin_log::log::warn!(
                    target: "desktop.lifecycle",
                    "failed to clean stale managed RDP artifacts"
                );
            }
            start_application_runtime(app)?;
            start_external_deep_link_handler(app);
            let cold_start_args = std::env::args().collect::<Vec<_>>();
            tauri_plugin_log::log::info!(
                target: "desktop.lifecycle",
                "AppState initialized and managed"
            );
            let cwd = std::env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().into_owned());
            dispatch_external_launch_args(
                app.handle().clone(),
                cold_start_args,
                cwd,
                services::external_launch::ExternalLaunchEntrypoint::DirectArgv,
            );
            #[cfg(target_os = "windows")]
            window_frame::apply_windows_main_window_frame(app)?;
            app_tray::apply_default_window_icon(app)?;
            app_tray::setup_close_to_tray(app)?;
            app_tray::setup_app_tray(app)?;
            window_management::prepare_main_window_after_state_restore(app)?;
            tauri_plugin_log::log::info!(
                target: "desktop.lifecycle",
                "Kerminal desktop setup completed"
            );
            Ok(())
        });

    let app = match commands::registry::register_kerminal_commands(builder)
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(_) => {
            eprintln!("failed to build Kerminal application");
            return;
        }
    };
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let Some(state) = app_handle.try_state::<AppState>() else {
                return;
            };
            if let Err(error) =
                tauri::async_runtime::block_on(state.application_runtime().shutdown())
            {
                tauri_plugin_log::log::error!(
                    target: "desktop.lifecycle",
                    "application runtime shutdown failed: {error}"
                );
            }
            if commands::connection::process::shutdown_detached_clients().is_err() {
                // 子进程回收错误可能包含平台路径，退出日志保持脱敏固定文案。
                tauri_plugin_log::log::error!(
                    target: "desktop.lifecycle",
                    "managed RDP client shutdown failed"
                );
            }
        }
    });
}

#[cfg(not(test))]
fn start_external_deep_link_handler<R: tauri::Runtime>(app: &tauri::App<R>) {
    let app_handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        // 插件回调不可执行 parser 或文件 I/O；每个 URL 都交给有界后台 intake。
        for url in event.urls() {
            let app_handle = app_handle.clone();
            dispatch_external_launch_args(
                app_handle,
                vec!["kerminal".to_owned(), url.to_string()],
                None,
                services::external_launch::ExternalLaunchEntrypoint::Protocol,
            );
        }
    });
}

/// 窗口生命周期入口只捕获有界参数；父进程发现、文件读取和 parser 全部在后台执行。
#[cfg(not(test))]
pub(crate) fn dispatch_external_launch_args<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    argv: Vec<String>,
    cwd: Option<String>,
    entrypoint: services::external_launch::ExternalLaunchEntrypoint,
) {
    let intake = app.state::<AppState>().external_launch_intake().clone();
    tauri::async_runtime::spawn(async move {
        let result =
            if services::external_launch::external_launch_protocol_url_from_args(&argv).is_some() {
                services::external_launch::accept_external_launch_protocol_args_bounded(
                    &intake, argv, cwd,
                )
                .await
            } else {
                intake.accept_args_bounded(argv, cwd, entrypoint).await
            };
        match result {
            Ok(outcome) => emit_external_launch_outcome(&app, &outcome),
            Err(error) => tauri_plugin_log::log::warn!(
                target: "desktop.lifecycle",
                "external launch intake rejected a request: {error}"
            ),
        }
    });
}

#[cfg(not(test))]
fn start_application_runtime<R: tauri::Runtime>(app: &tauri::App<R>) -> error::AppResult<()> {
    let state = app.state::<AppState>();
    match state.application_runtime().start(app.handle().clone()) {
        Ok(outcome) => {
            if !outcome.config_observer_started {
                tauri_plugin_log::log::warn!(
                    target: "desktop.lifecycle",
                    "config watcher failed to start"
                );
            }
            Ok(())
        }
        Err(error) => {
            tauri_plugin_log::log::warn!(
                target: "desktop.lifecycle",
                "application runtime failed to start"
            );
            Err(error)
        }
    }
}

#[cfg(not(test))]
fn emit_external_launch_outcome<R: tauri::Runtime, M: tauri::Manager<R> + tauri::Emitter<R>>(
    app: &M,
    outcome: &services::external_launch::ExternalLaunchAcceptOutcome,
) {
    let Some(payload) = outcome.event_payload() else {
        return;
    };
    if let Err(error) = app.emit(
        services::external_launch::EXTERNAL_SSH_LAUNCH_EVENT,
        payload,
    ) {
        tauri_plugin_log::log::warn!(
            target: "desktop.lifecycle",
            "failed to emit external SSH launch event: {error}"
        );
    }
}
