//! 应用设置 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

mod keybindings;
mod sftp_performance;

pub use self::keybindings::default_keybindings;
pub use self::sftp_performance::{
    SftpPerformanceSettings, DEFAULT_SFTP_GLOBAL_TRANSFERS, DEFAULT_SFTP_HOST_TRANSFERS,
    DEFAULT_SFTP_PACKET_BYTES, DEFAULT_SFTP_PIPELINE_DEPTH, DEFAULT_SFTP_TIMEOUT_SECONDS,
    MAX_SFTP_GLOBAL_TRANSFERS, MAX_SFTP_HOST_TRANSFERS, MAX_SFTP_PACKET_BYTES,
    MAX_SFTP_PIPELINE_DEPTH, MAX_SFTP_TIMEOUT_SECONDS, MIN_SFTP_GLOBAL_TRANSFERS,
    MIN_SFTP_HOST_TRANSFERS, MIN_SFTP_PACKET_BYTES, MIN_SFTP_PIPELINE_DEPTH,
    MIN_SFTP_TIMEOUT_SECONDS,
};

/// 终端 inline suggestion 诊断保留最小天数。
pub const MIN_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS: u32 = 1;
/// 终端 inline suggestion 诊断保留最大天数。
pub const MAX_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS: u32 = 3650;
/// 终端 inline suggestion 审计事件默认保留天数。
pub const DEFAULT_TERMINAL_INLINE_SUGGESTION_AUDIT_RETENTION_DAYS: u32 = 30;
/// 终端 inline suggestion 反馈事件默认保留天数。
pub const DEFAULT_TERMINAL_INLINE_SUGGESTION_FEEDBACK_RETENTION_DAYS: u32 = 365;
/// 桌面通知默认最小时长阈值，单位毫秒。
pub const DEFAULT_DESKTOP_NOTIFICATION_MIN_DURATION_MS: u32 = 10_000;
/// 桌面通知默认同类事件节流，单位毫秒。
pub const DEFAULT_DESKTOP_NOTIFICATION_THROTTLE_MS: u32 = 30_000;
/// 桌面通知最小时长阈值下限，单位毫秒。
pub const MIN_DESKTOP_NOTIFICATION_MIN_DURATION_MS: u32 = 1_000;
/// 桌面通知最小时长阈值上限，单位毫秒。
pub const MAX_DESKTOP_NOTIFICATION_MIN_DURATION_MS: u32 = 120_000;
/// 桌面通知同类事件节流上限，单位毫秒。
pub const MAX_DESKTOP_NOTIFICATION_THROTTLE_MS: u32 = 600_000;
/// 深浅色主题模式。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    /// 始终使用深色界面。
    #[default]
    Dark,
    /// 始终使用浅色界面。
    Light,
    /// 跟随系统深浅色偏好。
    System,
}

/// 工作台界面密度。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InterfaceDensity {
    /// 更紧凑的标签栏和终端间距。
    #[default]
    Compact,
    /// 舒适密度。
    Comfortable,
    /// 更宽松的阅读密度。
    Spacious,
}

/// 界面语言偏好。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InterfaceLanguage {
    /// 跟随系统或当前内置语言。
    #[default]
    System,
    /// 简体中文。
    ZhCn,
    /// 英文。
    EnUs,
}

/// 主页面背景图铺放方式。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundImageFit {
    /// 铺满工作台，可能裁切图片边缘。
    #[default]
    Cover,
    /// 完整显示图片，不裁切边缘。
    Contain,
    /// 重复平铺图片。
    Tile,
}

/// 终端内置配色方案。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalColorScheme {
    /// Kerminal 默认终端色盘。
    #[default]
    Kerminal,
    /// Tokyo Night 风格低亮度色盘。
    TokyoNight,
    /// Solarized 经典低对比色盘。
    Solarized,
    /// GitHub 代码区风格清晰色盘。
    Github,
}

/// xterm 光标形态。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalCursorStyle {
    /// 块状光标。
    #[default]
    Block,
    /// 竖线光标。
    Bar,
    /// 下划线光标。
    Underline,
}

/// 终端普通文本字重。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalFontWeight {
    /// 常规字重。
    #[default]
    Normal,
    /// 中等字重。
    Medium,
    /// 加粗字重。
    Bold,
}

/// 终端渲染器选择策略。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalRendererType {
    /// 自动优先使用 WebGL，失败时回退 xterm 默认渲染器。
    Auto,
    /// 使用 xterm 默认渲染器，作为兼容性最高的安全缺省。
    #[default]
    Cpu,
    /// 强制尝试 WebGL，失败时仍回退 xterm 默认渲染器。
    Gpu,
}

/// 终端右键行为。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalRightClickBehavior {
    /// 不执行终端动作。
    None,
    /// 右键直接粘贴。
    Paste,
    /// 打开终端上下文菜单。
    #[default]
    Menu,
}

/// 终端 inline suggestion 接受按键。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalInlineSuggestionAcceptKey {
    /// 不提供接受按键，只显示建议。
    Disabled,
    /// 使用右方向键接受灰色后缀。
    #[default]
    RightArrow,
}

/// 终端命令建议展示模式。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalCommandSuggestionPresentation {
    /// 关闭命令建议。
    Off,
    /// 仅显示 inline 灰色提示。
    Inline,
    /// 显示 inline 提示，并允许主动打开候选菜单。
    #[default]
    InlineAndMenu,
}

/// 终端命令建议菜单快捷键。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalCommandSuggestionMenuShortcut {
    /// 使用 Ctrl+Space 打开候选菜单。
    #[default]
    CtrlSpace,
}

/// 终端命令建议远端刷新策略。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalCommandSuggestionRemoteRefresh {
    /// 禁止主动刷新，只读取已有缓存。
    Off,
    /// 使用限流和退避的安全刷新。
    #[default]
    Safe,
}

/// 终端 inline suggestion provider 开关。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInlineSuggestionProviderSettings {
    /// 历史命令 provider。
    #[serde(default = "default_true")]
    pub history: bool,
    /// 远端路径 provider。
    #[serde(default = "default_true")]
    pub remote_path: bool,
    /// 远端 PATH 命令 provider。
    #[serde(default = "default_true")]
    pub remote_command: bool,
    /// Git refs provider。
    #[serde(default = "default_true")]
    pub git: bool,
    /// 离线 CLI spec provider。
    #[serde(default = "default_true")]
    pub spec: bool,
}

impl Default for TerminalInlineSuggestionProviderSettings {
    fn default() -> Self {
        Self {
            history: true,
            remote_path: true,
            remote_command: true,
            git: true,
            spec: true,
        }
    }
}

/// 终端 inline suggestion 设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInlineSuggestionSettings {
    /// 是否启用 inline suggestion。
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 接受建议的按键。
    #[serde(default)]
    pub accept_key: TerminalInlineSuggestionAcceptKey,
    /// 建议展示模式。
    #[serde(default)]
    pub presentation: TerminalCommandSuggestionPresentation,
    /// 菜单快捷键。
    #[serde(default)]
    pub menu_shortcut: TerminalCommandSuggestionMenuShortcut,
    /// 是否允许 Tab 主动打开菜单；默认让行给 shell。
    #[serde(default)]
    pub tab_opens_menu: bool,
    /// 是否允许 Alt+Right 分段接受。
    #[serde(default = "default_true")]
    pub partial_accept: bool,
    /// 远端缓存刷新策略。
    #[serde(default)]
    pub remote_refresh: TerminalCommandSuggestionRemoteRefresh,
    /// provider 开关。
    #[serde(default)]
    pub providers: TerminalInlineSuggestionProviderSettings,
    /// 是否允许远端只读探测预热。
    #[serde(default = "default_true")]
    pub remote_probe_enabled: bool,
    /// suggestion 审计事件保留天数。
    #[serde(default = "default_terminal_inline_suggestion_audit_retention_days")]
    pub audit_retention_days: u32,
    /// suggestion 反馈事件保留天数。
    #[serde(default = "default_terminal_inline_suggestion_feedback_retention_days")]
    pub feedback_retention_days: u32,
}

impl Default for TerminalInlineSuggestionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            accept_key: TerminalInlineSuggestionAcceptKey::RightArrow,
            presentation: TerminalCommandSuggestionPresentation::InlineAndMenu,
            menu_shortcut: TerminalCommandSuggestionMenuShortcut::CtrlSpace,
            tab_opens_menu: false,
            partial_accept: true,
            remote_refresh: TerminalCommandSuggestionRemoteRefresh::Safe,
            providers: TerminalInlineSuggestionProviderSettings::default(),
            remote_probe_enabled: true,
            audit_retention_days: DEFAULT_TERMINAL_INLINE_SUGGESTION_AUDIT_RETENTION_DAYS,
            feedback_retention_days: DEFAULT_TERMINAL_INLINE_SUGGESTION_FEEDBACK_RETENTION_DAYS,
        }
    }
}

/// 终端渲染外观设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAppearance {
    /// 连接异常断开后是否自动重连。
    #[serde(default = "default_true")]
    pub auto_reconnect: bool,
    /// 终端配色方案。
    #[serde(default)]
    pub color_scheme: TerminalColorScheme,
    /// 浅色界面下的终端配色方案。
    #[serde(default)]
    pub light_color_scheme: TerminalColorScheme,
    /// 深色界面下的终端配色方案。
    #[serde(default)]
    pub dark_color_scheme: TerminalColorScheme,
    /// xterm 使用的等宽字体族。
    pub font_family: String,
    /// 终端字号，单位 px。
    pub font_size: u16,
    /// 普通文本字重。
    #[serde(default)]
    pub font_weight: TerminalFontWeight,
    /// macOS Option 键是否作为 Meta 键处理。
    #[serde(default)]
    pub mac_option_is_meta: bool,
    /// 终端渲染器选择策略。
    #[serde(default)]
    pub renderer_type: TerminalRendererType,
    /// 行高倍率。
    pub line_height: f64,
    /// xterm 光标形态。
    #[serde(default)]
    pub cursor_style: TerminalCursorStyle,
    /// 光标是否闪烁。
    pub cursor_blink: bool,
    /// 终端右键行为。
    #[serde(default)]
    pub right_click_behavior: TerminalRightClickBehavior,
    /// 选中文本后是否自动复制到剪贴板。
    #[serde(default)]
    pub selection_copy: bool,
    /// 是否显示终端左侧命令块色条。
    #[serde(default = "default_true")]
    pub show_command_block_rail: bool,
    /// 是否在标签标题前显示序号。
    #[serde(default)]
    pub show_tab_numbers: bool,
    /// 关闭终端标签前是否确认。
    #[serde(default = "default_true")]
    pub confirm_close_tab: bool,
    /// 终端 inline suggestion 设置。
    #[serde(default)]
    pub inline_suggestion: TerminalInlineSuggestionSettings,
    /// xterm 滚屏缓冲行数。
    pub scrollback: u32,
}

impl Default for TerminalAppearance {
    fn default() -> Self {
        Self {
            auto_reconnect: true,
            color_scheme: TerminalColorScheme::Kerminal,
            light_color_scheme: TerminalColorScheme::Kerminal,
            dark_color_scheme: TerminalColorScheme::Kerminal,
            font_family: r#""JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, monospace"#
                .to_string(),
            font_size: 15,
            font_weight: TerminalFontWeight::Normal,
            mac_option_is_meta: false,
            renderer_type: TerminalRendererType::Cpu,
            line_height: 1.35,
            cursor_style: TerminalCursorStyle::Block,
            cursor_blink: true,
            right_click_behavior: TerminalRightClickBehavior::Menu,
            selection_copy: false,
            show_command_block_rail: true,
            show_tab_numbers: false,
            confirm_close_tab: true,
            inline_suggestion: TerminalInlineSuggestionSettings::default(),
            scrollback: 5000,
        }
    }
}

/// 应用界面外观设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    /// 界面语言偏好。
    #[serde(default)]
    pub interface_language: InterfaceLanguage,
    /// 是否启用主页面背景图。
    #[serde(default)]
    pub background_enabled: bool,
    /// 背景图铺放方式。
    #[serde(default)]
    pub background_fit: BackgroundImageFit,
    /// 主页面背景图路径。
    #[serde(default)]
    pub background_image_path: String,
    /// 背景图层不透明度百分比。
    #[serde(default = "default_background_opacity")]
    pub background_opacity: u8,
    /// 应用窗口材料不透明度百分比。
    #[serde(default = "default_window_opacity")]
    pub window_opacity: u8,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            interface_language: InterfaceLanguage::System,
            background_enabled: false,
            background_fit: BackgroundImageFit::Cover,
            background_image_path: String::new(),
            background_opacity: default_background_opacity(),
            window_opacity: default_window_opacity(),
        }
    }
}

/// 桌面系统通知设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationSettings {
    /// 是否启用桌面通知。
    #[serde(default)]
    pub enabled: bool,
    /// 是否优先通知后台和耗时事件。
    #[serde(default = "default_true")]
    pub background_only: bool,
    /// 是否只通知重要事件。
    #[serde(default)]
    pub important_only: bool,
    /// 前台任务低于该时长不发通知，单位毫秒。
    #[serde(default = "default_desktop_notification_min_duration_ms")]
    pub min_duration_ms: u32,
    /// 同类事件在该时间内只发一次，单位毫秒。
    #[serde(default = "default_desktop_notification_throttle_ms")]
    pub throttle_ms: u32,
}

impl Default for DesktopNotificationSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            background_only: true,
            important_only: false,
            min_duration_ms: DEFAULT_DESKTOP_NOTIFICATION_MIN_DURATION_MS,
            throttle_ms: DEFAULT_DESKTOP_NOTIFICATION_THROTTLE_MS,
        }
    }
}

impl DesktopNotificationSettings {
    fn normalized(mut self) -> Self {
        self.min_duration_ms = self.min_duration_ms.clamp(
            MIN_DESKTOP_NOTIFICATION_MIN_DURATION_MS,
            MAX_DESKTOP_NOTIFICATION_MIN_DURATION_MS,
        );
        self.throttle_ms = self.throttle_ms.min(MAX_DESKTOP_NOTIFICATION_THROTTLE_MS);
        self
    }
}

/// External SSH launch compatibility tool selector.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalLaunchToolSetting {
    /// PuTTY-compatible command line.
    Putty,
    /// MobaXterm-compatible command line.
    Mobaxterm,
    /// Xshell-compatible command line or URL.
    Xshell,
    /// SecureCRT-compatible command line.
    Securecrt,
    /// OpenSSH-compatible command line.
    Openssh,
    /// WinSCP, FileZilla or generic SFTP URL parameters.
    SftpClient,
    /// Kerminal native flags, JSON envelope, or protocol URL.
    KerminalNative,
}

/// External SSH launch compatibility settings.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchSettings {
    /// Whether any external SSH launch request is accepted.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Whether third-party terminal argument formats are accepted.
    #[serde(default = "default_true")]
    pub accept_vendor_args: bool,
    /// Whether accepted external launches should open SFTP automatically.
    #[serde(default)]
    pub auto_open_sftp: bool,
    /// Per-tool deny list for parser/persona rollback.
    #[serde(default)]
    pub disabled_tools: Vec<ExternalLaunchToolSetting>,
}

impl Default for ExternalLaunchSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            accept_vendor_args: true,
            auto_open_sftp: false,
            disabled_tools: Vec::new(),
        }
    }
}

impl ExternalLaunchSettings {
    fn normalized(mut self) -> Self {
        let disabled_tools = std::mem::take(&mut self.disabled_tools);
        let mut deduped = Vec::with_capacity(disabled_tools.len());
        for tool in disabled_tools {
            if !deduped.contains(&tool) {
                deduped.push(tool);
            }
        }
        self.disabled_tools = deduped;
        self
    }
}

/// 快捷键生效范围。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KeybindingScope {
    /// 全局窗口或工作台级快捷键。
    Global,
    /// 终端获得焦点时的快捷键。
    Terminal,
    /// 工作区布局和工具面板快捷键。
    Workspace,
}

/// 单个快捷键默认配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingSetting {
    /// 稳定 action id，后续与 tool registry / command palette 对齐。
    pub action: String,
    /// 中文用户可见名称。
    pub label: String,
    /// 用户可见说明，描述来源、用途和限制。
    #[serde(default)]
    pub description: String,
    /// 用户可见快捷键组合。
    #[serde(default)]
    pub binding: String,
    /// Windows / Linux 默认快捷键组合。
    #[serde(default)]
    pub windows_binding: String,
    /// macOS 默认快捷键组合。
    #[serde(default)]
    pub mac_binding: String,
    /// 快捷键生效范围。
    pub scope: KeybindingScope,
    /// 当前版本是否支持在 UI 中编辑。
    pub editable: bool,
}

/// Kerminal 应用设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// 应用界面外观设置。
    #[serde(default)]
    pub appearance: AppearanceSettings,
    /// 工作台界面密度。
    #[serde(default)]
    pub interface_density: InterfaceDensity,
    /// 应用主题模式。
    #[serde(default)]
    pub theme_mode: ThemeMode,
    /// 终端外观设置。
    #[serde(default)]
    pub terminal: TerminalAppearance,
    /// 快捷键设置。
    #[serde(default = "default_keybindings")]
    pub keybindings: Vec<KeybindingSetting>,
    /// SFTP 传输和连接性能设置。
    #[serde(default)]
    pub sftp: SftpPerformanceSettings,
    /// 桌面系统通知设置。
    #[serde(default)]
    pub desktop_notifications: DesktopNotificationSettings,
    /// 外部跳板机 / 堡垒机 SSH 启动兼容设置。
    #[serde(default)]
    pub external_launch: ExternalLaunchSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings::default(),
            interface_density: InterfaceDensity::default(),
            theme_mode: ThemeMode::Dark,
            terminal: TerminalAppearance::default(),
            keybindings: default_keybindings(),
            sftp: SftpPerformanceSettings::default(),
            desktop_notifications: DesktopNotificationSettings::default(),
            external_launch: ExternalLaunchSettings::default(),
        }
    }
}

impl AppSettings {
    /// 返回经过业务范围校验后的设置。
    pub fn validated(mut self) -> AppResult<Self> {
        self.appearance.background_image_path =
            self.appearance.background_image_path.trim().to_string();
        if self.appearance.background_image_path.len() > 1024 {
            return Err(AppError::InvalidInput(
                "背景图路径不能超过 1024 个字符".to_string(),
            ));
        }
        self.appearance.background_opacity = self.appearance.background_opacity.min(100);
        self.appearance.window_opacity = self.appearance.window_opacity.clamp(35, 100);
        self.terminal.font_family = self.terminal.font_family.trim().to_string();

        if self.terminal.font_family.is_empty() {
            return Err(AppError::InvalidInput("终端字体不能为空".to_string()));
        }
        if self.terminal.font_family.len() > 160 {
            return Err(AppError::InvalidInput("终端字体配置过长".to_string()));
        }
        if !(10..=24).contains(&self.terminal.font_size) {
            return Err(AppError::InvalidInput(
                "终端字号需要在 10 到 24 之间".to_string(),
            ));
        }
        if !(1.0..=1.8).contains(&self.terminal.line_height) {
            return Err(AppError::InvalidInput(
                "终端行高需要在 1.0 到 1.8 之间".to_string(),
            ));
        }
        if !(1_000..=50_000).contains(&self.terminal.scrollback) {
            return Err(AppError::InvalidInput(
                "滚屏缓冲需要在 1000 到 50000 行之间".to_string(),
            ));
        }
        self.terminal.inline_suggestion.audit_retention_days =
            self.terminal.inline_suggestion.audit_retention_days.clamp(
                MIN_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
                MAX_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
            );
        self.terminal.inline_suggestion.feedback_retention_days = self
            .terminal
            .inline_suggestion
            .feedback_retention_days
            .clamp(
                MIN_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
                MAX_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
            );
        if !self.terminal.inline_suggestion.enabled {
            self.terminal.inline_suggestion.presentation =
                TerminalCommandSuggestionPresentation::Off;
        }
        if self.terminal.inline_suggestion.presentation
            == TerminalCommandSuggestionPresentation::Off
        {
            self.terminal.inline_suggestion.enabled = false;
        }
        if !self.terminal.inline_suggestion.remote_probe_enabled {
            self.terminal.inline_suggestion.remote_refresh =
                TerminalCommandSuggestionRemoteRefresh::Off;
        }
        if self.terminal.inline_suggestion.remote_refresh
            == TerminalCommandSuggestionRemoteRefresh::Off
        {
            self.terminal.inline_suggestion.remote_probe_enabled = false;
        }

        if self.keybindings.is_empty() {
            self.keybindings = default_keybindings();
        }
        self.sftp = self.sftp.normalized();
        self.desktop_notifications = self.desktop_notifications.normalized();
        self.external_launch = self.external_launch.normalized();

        Ok(self)
    }
}

fn default_true() -> bool {
    true
}

fn default_terminal_inline_suggestion_audit_retention_days() -> u32 {
    DEFAULT_TERMINAL_INLINE_SUGGESTION_AUDIT_RETENTION_DAYS
}

fn default_terminal_inline_suggestion_feedback_retention_days() -> u32 {
    DEFAULT_TERMINAL_INLINE_SUGGESTION_FEEDBACK_RETENTION_DAYS
}

fn default_desktop_notification_min_duration_ms() -> u32 {
    DEFAULT_DESKTOP_NOTIFICATION_MIN_DURATION_MS
}

fn default_desktop_notification_throttle_ms() -> u32 {
    DEFAULT_DESKTOP_NOTIFICATION_THROTTLE_MS
}

fn default_background_opacity() -> u8 {
    100
}

fn default_window_opacity() -> u8 {
    100
}
