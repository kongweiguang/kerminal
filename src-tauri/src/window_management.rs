//! Kerminal 主窗口启动恢复与离屏保护。
//!
//! @author kongweiguang

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
#[cfg(not(test))]
use std::time::Duration;

#[cfg(not(test))]
use tauri::{App, AppHandle, Manager, PhysicalPosition, Runtime, WebviewWindow};

#[cfg(not(test))]
use crate::app_menu::MAIN_WINDOW_LABEL;

const OPERABLE_TITLE_BAR_HEIGHT: u32 = 48;
const MIN_OPERABLE_WIDTH: u32 = 128;
const MIN_OPERABLE_HEIGHT: u32 = 32;
#[cfg(not(test))]
const MAIN_WINDOW_SHOW_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(not(test))]
const MAIN_WINDOW_SHOW_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_millis(100),
    Duration::from_millis(300),
    Duration::from_secs(1),
];

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MainWindowStartupVisibility {
    Waiting = 0,
    Showing = 1,
    Shown = 2,
}

/// 主窗口冷启动显示门禁。
///
/// window-state 恢复和页面加载可能以不同顺序完成；只有两者都就绪时才显示窗口，
/// 同时保留超时兜底，避免页面加载事件缺失时窗口永久隐藏。
#[derive(Debug, Default)]
pub struct MainWindowStartupGate {
    activation_pending: AtomicBool,
    placement_ready: AtomicBool,
    page_ready: AtomicBool,
    visibility_state: AtomicU8,
}

impl MainWindowStartupGate {
    /// 记录托盘或 single-instance 在启动期间提出的窗口唤醒请求。
    pub fn request_activation(&self) {
        self.activation_pending.store(true, Ordering::Release);
    }

    /// 取消尚未完成的窗口唤醒请求，避免用户主动隐藏后被失败重试重新显示。
    pub fn cancel_activation(&self) {
        self.activation_pending.store(false, Ordering::Release);
    }

    /// 返回是否仍有托盘或 single-instance 唤醒请求等待处理。
    #[must_use]
    pub fn activation_pending(&self) -> bool {
        self.activation_pending.load(Ordering::Acquire)
    }

    /// 返回主窗口是否已经完成首次安全显示。
    #[must_use]
    pub fn startup_completed(&self) -> bool {
        self.visibility_state.load(Ordering::Acquire) == MainWindowStartupVisibility::Shown as u8
    }

    /// 标记 window-state 恢复与离屏校验已经完成。
    pub fn mark_placement_ready(&self) {
        self.placement_ready.store(true, Ordering::Release);
    }

    /// 标记主 WebView 页面已经完成加载。
    pub fn mark_page_ready(&self) {
        self.page_ready.store(true, Ordering::Release);
    }

    /// 尝试取得首次显示权；超时兜底可跳过页面就绪条件。
    #[must_use]
    pub fn try_claim_show(&self, allow_page_timeout: bool) -> bool {
        if !self.placement_ready.load(Ordering::Acquire)
            || (!allow_page_timeout && !self.page_ready.load(Ordering::Acquire))
        {
            return false;
        }

        self.visibility_state
            .compare_exchange(
                MainWindowStartupVisibility::Waiting as u8,
                MainWindowStartupVisibility::Showing as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    /// 标记首次窗口显示成功，并清理启动期间积累的唤醒请求。
    pub fn complete_show(&self) {
        self.visibility_state
            .store(MainWindowStartupVisibility::Shown as u8, Ordering::Release);
        self.activation_pending.store(false, Ordering::Release);
    }

    /// 显示失败时释放显示权，允许页面事件或超时兜底重试。
    pub fn release_show_claim(&self) {
        let _ = self.visibility_state.compare_exchange(
            MainWindowStartupVisibility::Showing as u8,
            MainWindowStartupVisibility::Waiting as u8,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }
}

/// 窗口在桌面物理坐标系中的外边界。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowBounds {
    /// 窗口左上角横坐标。
    pub x: i32,
    /// 窗口左上角纵坐标。
    pub y: i32,
    /// 窗口外宽度。
    pub width: u32,
    /// 窗口外高度。
    pub height: u32,
}

/// 显示器可工作区域在桌面物理坐标系中的边界。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorWorkArea {
    /// 工作区域左上角横坐标。
    pub x: i32,
    /// 工作区域左上角纵坐标。
    pub y: i32,
    /// 工作区域宽度。
    pub width: u32,
    /// 工作区域高度。
    pub height: u32,
}

/// 需要设置给窗口的物理坐标。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowPosition {
    /// 目标横坐标。
    pub x: i32,
    /// 目标纵坐标。
    pub y: i32,
}

/// 窗口恢复后的几何修正决策。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowPlacementDecision {
    /// 当前窗口仍保留可拖拽的标题栏区域，不修改用户保存的位置。
    Keep,
    /// 当前窗口完全不可操作，需要移动到给定安全位置。
    MoveTo(WindowPosition),
}

/// 根据恢复后的窗口边界和显示器工作区决定是否修正窗口位置。
///
/// 只要窗口顶部标题栏区域与任一显示器仍有足够交集，就保留原位置；
/// 否则优先回退到主显示器居中位置，主显示器缺失时使用首个可用显示器。
/// 当系统没有报告任何显示器时保持原位置，让平台窗口管理器继续处理。
#[must_use]
pub fn resolve_window_placement(
    window: WindowBounds,
    monitors: &[MonitorWorkArea],
    primary_monitor: Option<MonitorWorkArea>,
) -> WindowPlacementDecision {
    if monitors
        .iter()
        .copied()
        .chain(primary_monitor)
        .any(|monitor| has_operable_intersection(window, monitor))
    {
        return WindowPlacementDecision::Keep;
    }

    primary_monitor
        .or_else(|| monitors.first().copied())
        .map(|monitor| WindowPlacementDecision::MoveTo(centered_safe_position(window, monitor)))
        .unwrap_or(WindowPlacementDecision::Keep)
}

fn has_operable_intersection(window: WindowBounds, monitor: MonitorWorkArea) -> bool {
    let title_bar_height = window.height.min(OPERABLE_TITLE_BAR_HEIGHT);
    if window.width == 0 || title_bar_height == 0 || monitor.width == 0 || monitor.height == 0 {
        return false;
    }

    // 只评估窗口顶部可拖拽区域，避免“内容还露出一点但标题栏无法操作”的假可见状态。
    let window_left = i64::from(window.x);
    let window_top = i64::from(window.y);
    let window_right = window_left + i64::from(window.width);
    let window_bottom = window_top + i64::from(title_bar_height);

    let monitor_left = i64::from(monitor.x);
    let monitor_top = i64::from(monitor.y);
    let monitor_right = monitor_left + i64::from(monitor.width);
    let monitor_bottom = monitor_top + i64::from(monitor.height);

    let intersection_width = window_right.min(monitor_right) - window_left.max(monitor_left);
    let intersection_height = window_bottom.min(monitor_bottom) - window_top.max(monitor_top);
    let required_width = i64::from(window.width.min(MIN_OPERABLE_WIDTH));
    let required_height = i64::from(title_bar_height.min(MIN_OPERABLE_HEIGHT));

    intersection_width >= required_width && intersection_height >= required_height
}

fn centered_safe_position(window: WindowBounds, monitor: MonitorWorkArea) -> WindowPosition {
    let horizontal_space = i64::from(monitor.width) - i64::from(window.width);
    let vertical_space = i64::from(monitor.height) - i64::from(window.height);

    // 窗口大于工作区时贴齐工作区左上角，确保标题栏和窗口控制仍然可操作。
    WindowPosition {
        x: clamp_i64_to_i32(i64::from(monitor.x) + horizontal_space.max(0) / 2),
        y: clamp_i64_to_i32(i64::from(monitor.y) + vertical_space.max(0) / 2),
    }
}

fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

#[cfg(not(test))]
fn monitor_work_area(monitor: &tauri::Monitor) -> MonitorWorkArea {
    let work_area = monitor.work_area();
    MonitorWorkArea {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width,
        height: work_area.size.height,
    }
}

#[cfg(not(test))]
fn current_window_bounds<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<WindowBounds> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    Ok(WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

#[cfg(not(test))]
fn correct_offscreen_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let bounds = current_window_bounds(window)?;
    let monitors = window
        .available_monitors()?
        .iter()
        .map(monitor_work_area)
        .collect::<Vec<_>>();
    let primary_monitor = window.primary_monitor()?.as_ref().map(monitor_work_area);

    if monitors.is_empty() && primary_monitor.is_none() {
        tauri_plugin_log::log::warn!(
            target: "desktop.window",
            "no monitor was reported; keeping restored main window position"
        );
    }

    if let WindowPlacementDecision::MoveTo(position) =
        resolve_window_placement(bounds, &monitors, primary_monitor)
    {
        window.set_position(PhysicalPosition::new(position.x, position.y))?;
        tauri_plugin_log::log::info!(
            target: "desktop.window",
            "restored main window was offscreen and moved to a safe monitor position"
        );
    }

    Ok(())
}

/// 在 window-state 恢复完成后修正主窗口位置，并等待页面加载完成后显示。
///
/// 几何读取或位置修正失败只记录日志，不能让主窗口永久停留在隐藏状态；
/// 页面加载事件缺失时由超时任务兜底显示。
#[cfg(not(test))]
pub fn prepare_main_window_after_state_restore<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        tauri_plugin_log::log::warn!(
            target: "desktop.window",
            "main window was unavailable after window-state restore"
        );
        return Ok(());
    };

    if let Err(error) = correct_offscreen_window(&window) {
        tauri_plugin_log::log::warn!(
            target: "desktop.window",
            "failed to validate restored main window bounds: {error}"
        );
    }

    let startup_gate = app.state::<MainWindowStartupGate>();
    startup_gate.mark_placement_ready();
    show_main_window_if_ready(app.handle(), false, 0);

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(MAIN_WINDOW_SHOW_TIMEOUT).await;
        show_main_window_if_ready(&app_handle, true, 0);
    });

    Ok(())
}

/// 接收主页面加载完成事件，并在恢复门禁就绪后显示窗口。
#[cfg(not(test))]
pub fn notify_main_window_page_ready<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.state::<MainWindowStartupGate>().mark_page_ready();
    show_main_window_if_ready(app, false, 0);
    Ok(())
}

/// 统一处理托盘与 single-instance 的主窗口唤醒请求。
///
/// 首次安全显示完成前只记录请求并复用启动门禁；完成后才直接执行显示、取消最小化
/// 和聚焦。这样慢启动时不会绕过 window-state 恢复、离屏校验和页面加载门禁。
#[cfg(not(test))]
pub fn request_main_window_activation<R: Runtime>(app: &AppHandle<R>) {
    let startup_gate = app.state::<MainWindowStartupGate>();
    startup_gate.request_activation();
    if startup_gate.startup_completed() {
        activate_main_window_with_retry(app, 0);
    } else {
        show_main_window_if_ready(app, false, 0);
    }
}

/// 取消仍在等待或重试的主窗口唤醒请求。
#[cfg(not(test))]
pub fn cancel_main_window_activation<R: Runtime>(app: &AppHandle<R>) {
    app.state::<MainWindowStartupGate>().cancel_activation();
}

#[cfg(not(test))]
fn show_main_window_if_ready<R: Runtime>(
    app: &AppHandle<R>,
    allow_page_timeout: bool,
    retry_index: usize,
) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        tauri_plugin_log::log::warn!(
            target: "desktop.window",
            "main window was unavailable when startup visibility gate opened"
        );
        return;
    };

    let startup_gate = app.state::<MainWindowStartupGate>();
    if !startup_gate.try_claim_show(allow_page_timeout) {
        return;
    }

    match show_main_window_after_startup_restore(&window, allow_page_timeout) {
        Ok(()) => startup_gate.complete_show(),
        Err(error) => {
            startup_gate.release_show_claim();
            tauri_plugin_log::log::error!(
                target: "desktop.window",
                "failed to show main window after startup restore: {error}"
            );
            schedule_startup_show_retry(app, allow_page_timeout, retry_index);
        }
    }
}

#[cfg(not(test))]
fn schedule_startup_show_retry<R: Runtime>(
    app: &AppHandle<R>,
    allow_page_timeout: bool,
    retry_index: usize,
) {
    let Some(delay) = MAIN_WINDOW_SHOW_RETRY_DELAYS.get(retry_index).copied() else {
        tauri_plugin_log::log::error!(
            target: "desktop.window",
            "main window remained hidden after bounded startup show retries"
        );
        return;
    };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        show_main_window_if_ready(&app_handle, allow_page_timeout, retry_index + 1);
    });
}

#[cfg(not(test))]
fn activate_main_window_with_retry<R: Runtime>(app: &AppHandle<R>, retry_index: usize) {
    let startup_gate = app.state::<MainWindowStartupGate>();
    if !startup_gate.startup_completed() || !startup_gate.activation_pending() {
        return;
    }

    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        tauri_plugin_log::log::warn!(
            target: "desktop.window",
            "main window activation requested but window was unavailable"
        );
        schedule_activation_retry(app, retry_index);
        return;
    };

    match reveal_main_window(&window) {
        Ok(()) => {
            startup_gate.cancel_activation();
            tauri_plugin_log::log::info!(
                target: "desktop.window",
                "main window shown and focused after activation request"
            );
        }
        Err(error) => {
            tauri_plugin_log::log::error!(
                target: "desktop.window",
                "failed to activate main window: {error}"
            );
            schedule_activation_retry(app, retry_index);
        }
    }
}

#[cfg(not(test))]
fn schedule_activation_retry<R: Runtime>(app: &AppHandle<R>, retry_index: usize) {
    let Some(delay) = MAIN_WINDOW_SHOW_RETRY_DELAYS.get(retry_index).copied() else {
        tauri_plugin_log::log::error!(
            target: "desktop.window",
            "main window activation failed after bounded retries"
        );
        return;
    };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        activate_main_window_with_retry(&app_handle, retry_index + 1);
    });
}

#[cfg(not(test))]
fn show_main_window_after_startup_restore<R: Runtime>(
    window: &WebviewWindow<R>,
    used_page_timeout: bool,
) -> tauri::Result<()> {
    reveal_main_window(window)?;
    tauri_plugin_log::log::info!(
        target: "desktop.window",
        "main window shown after startup restore (page timeout fallback: {used_page_timeout})"
    );
    Ok(())
}

#[cfg(not(test))]
fn reveal_main_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    window.show()?;
    // unminimize 保持 best-effort：最小化态在交互前可由调用链补救，不应阻塞后续激活。
    if let Err(error) = window.unminimize() {
        tauri_plugin_log::log::warn!(
            target: "desktop.window",
            "failed to unminimize main window after restore: {error}"
        );
    }
    // set_focus 失败必须冒泡：macOS 未激活窗口可能吞掉首击，导致确认弹层的关闭/取消按钮
    // 无法命中；聚焦失败向上传播，让调用方既有 activation retry 接管有界重试。
    window.set_focus().map_err(|error| {
        tauri_plugin_log::log::warn!(
            target: "desktop.window",
            "failed to focus main window after restore: {error}"
        );
        error
    })
}
