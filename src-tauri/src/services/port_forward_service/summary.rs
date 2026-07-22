//! 端口转发运行时摘要派生规则。
//!
//! @author kongweiguang

use crate::models::port_forward::{
    PortForwardCreateRequest, PortForwardKind, PortForwardProxyProtocol,
    PortForwardRuntimeDiagnostics, PortForwardRuntimeMode, PortForwardStatus, PortForwardSummary,
};

use super::runtime_process::ManagedForwardProcess;

pub(super) fn restored_summary(mut summary: PortForwardSummary) -> PortForwardSummary {
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

pub(super) fn runtime_diagnostics_for_process(
    process: &ManagedForwardProcess,
    request: &PortForwardCreateRequest,
) -> PortForwardRuntimeDiagnostics {
    let mut diagnostics = PortForwardRuntimeDiagnostics {
        backend: "native-russh".to_owned(),
        cleanup_status: "active".to_owned(),
        mode: PortForwardRuntimeMode::ManagedSshRuntime,
        tunnel_kind: tunnel_kind_for_request(request),
        ..Default::default()
    };
    if let Some(tunnel) = process.0.as_ref() {
        diagnostics.managed_session_id = Some(tunnel.session_id().to_owned());
        diagnostics.managed_channel_kind = Some(tunnel.kind().as_str().to_owned());
        diagnostics.managed_tunnel_id = tunnel.id();
    }
    diagnostics
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
