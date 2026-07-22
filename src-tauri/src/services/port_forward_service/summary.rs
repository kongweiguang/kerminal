//! 端口转发运行时摘要派生规则。
//!
//! @author kongweiguang

use crate::models::port_forward::{
    PortForwardCreateRequest, PortForwardKind, PortForwardProxyProtocol,
    PortForwardRuntimeDiagnostics, PortForwardRuntimeMode, PortForwardStatus, PortForwardSummary,
};

use super::runtime_process::ManagedForwardProcess;

pub(super) fn restored_summary(mut summary: PortForwardSummary) -> PortForwardSummary {
    normalize_legacy_summary(&mut summary);
    if summary.status != PortForwardStatus::Running {
        return summary;
    }
    summary.last_error = Some(
        summary
            .last_error
            .unwrap_or_else(|| "应用重启后隧道不会自动重连。".to_owned()),
    );
    let mut summary = stopped_summary(summary, None);
    mark_summary_runtime_restored(&mut summary);
    summary
}

pub(super) fn stopped_summary(
    mut summary: PortForwardSummary,
    last_error: Option<String>,
) -> PortForwardSummary {
    if let Some(last_error) = last_error {
        summary.last_error = Some(last_error.clone());
        mark_summary_runtime_cleanup(&mut summary, "stopped", Some(last_error));
    } else {
        mark_summary_runtime_cleanup(&mut summary, "stopped", None);
    }
    summary.status = PortForwardStatus::Exited;
    summary.pid = None;
    summary
}

/// 旧 remote + SOCKS 且无 target 的持久化记录等价于新的显式 RemoteDynamic。
fn normalize_legacy_summary(summary: &mut PortForwardSummary) {
    if summary.kind == PortForwardKind::Remote
        && summary.proxy_protocol == Some(PortForwardProxyProtocol::Socks5)
        && summary.target_host.is_none()
        && summary.target_port.is_none()
    {
        summary.kind = PortForwardKind::RemoteDynamic;
    }
}

pub(super) fn runtime_diagnostics_for_process(
    process: &ManagedForwardProcess,
    request: &PortForwardCreateRequest,
    fallback_reason: Option<String>,
) -> PortForwardRuntimeDiagnostics {
    match process {
        ManagedForwardProcess::Managed(tunnel) => {
            let mut diagnostics = PortForwardRuntimeDiagnostics {
                backend: "native-russh".to_owned(),
                cleanup_status: "active".to_owned(),
                mode: PortForwardRuntimeMode::ManagedSshRuntime,
                tunnel_kind: tunnel_kind_for_request(request),
                ..Default::default()
            };
            if let Some(tunnel) = tunnel.as_ref().as_ref() {
                diagnostics.managed_session_id = Some(tunnel.session_id().to_owned());
                diagnostics.managed_channel_kind = Some(tunnel.kind().as_str().to_owned());
                diagnostics.managed_tunnel_id = tunnel.id();
            }
            diagnostics
        }
        ManagedForwardProcess::Process(_) => PortForwardRuntimeDiagnostics {
            backend: "openssh".to_owned(),
            cleanup_status: "active".to_owned(),
            fallback_reason,
            mode: PortForwardRuntimeMode::OpenSshProcess,
            tunnel_kind: tunnel_kind_for_request(request),
            ..Default::default()
        },
        ManagedForwardProcess::Pty(_) => PortForwardRuntimeDiagnostics {
            backend: "openssh".to_owned(),
            cleanup_status: "active".to_owned(),
            fallback_reason,
            mode: PortForwardRuntimeMode::OpenSshPty,
            tunnel_kind: tunnel_kind_for_request(request),
            ..Default::default()
        },
    }
}

pub(super) fn mark_summary_runtime_cleanup(
    summary: &mut PortForwardSummary,
    cleanup_status: &str,
    recent_failure: Option<String>,
) {
    if let Some(runtime) = &mut summary.runtime {
        runtime.cleanup_status = cleanup_status.to_owned();
        if let Some(recent_failure) = recent_failure {
            runtime.recent_failure = Some(recent_failure);
        }
    }
}

fn mark_summary_runtime_restored(summary: &mut PortForwardSummary) {
    let recent_failure = summary.last_error.clone();
    if let Some(runtime) = &mut summary.runtime {
        runtime.cleanup_status = "restoredAfterAppRestart".to_owned();
        runtime.mode = PortForwardRuntimeMode::Restored;
        runtime.recent_failure = recent_failure;
        return;
    }
    summary.runtime = Some(PortForwardRuntimeDiagnostics {
        backend: "restored".to_owned(),
        cleanup_status: "restoredAfterAppRestart".to_owned(),
        mode: PortForwardRuntimeMode::Restored,
        recent_failure,
        tunnel_kind: tunnel_kind_for_summary(summary),
        ..Default::default()
    });
}

pub(super) fn tunnel_kind_for_request(request: &PortForwardCreateRequest) -> String {
    tunnel_kind_for_kind(request.kind, request.proxy_protocol)
}

fn tunnel_kind_for_summary(summary: &PortForwardSummary) -> String {
    tunnel_kind_for_kind(summary.kind, summary.proxy_protocol)
}

pub(super) fn tunnel_kind_for_kind(
    kind: PortForwardKind,
    proxy_protocol: Option<PortForwardProxyProtocol>,
) -> String {
    if proxy_protocol == Some(PortForwardProxyProtocol::Http) {
        return "legacyHttp".to_owned();
    }
    match kind {
        PortForwardKind::Local => "local",
        PortForwardKind::Remote if proxy_protocol == Some(PortForwardProxyProtocol::Socks5) => {
            "remoteDynamic"
        }
        PortForwardKind::Remote => "remote",
        PortForwardKind::RemoteDynamic => "remoteDynamic",
        PortForwardKind::Dynamic => "dynamic",
    }
    .to_owned()
}

pub(super) fn is_managed_forward_candidate(request: &PortForwardCreateRequest) -> bool {
    request.proxy_protocol != Some(PortForwardProxyProtocol::Http)
}

pub(super) fn is_remote_dynamic_forward_request(request: &PortForwardCreateRequest) -> bool {
    matches!(
        request.kind,
        PortForwardKind::Remote | PortForwardKind::RemoteDynamic
    ) && request.proxy_protocol == Some(PortForwardProxyProtocol::Socks5)
}
