//! External SSH launch compatibility layer.
//!
//! @author kongweiguang

pub mod classifier;
pub mod deep_link;
pub(crate) mod destination;
pub mod host_identity;
pub mod intake;
pub mod materializer;
pub mod model;
mod parent_process;
pub mod parser;
pub(crate) mod parsers;
pub(crate) mod redaction;
pub mod secret;
pub(crate) mod ssh_url;
pub mod task_registry;

pub use deep_link::{
    accept_external_launch_protocol_args, accept_external_launch_protocol_args_bounded,
    external_launch_protocol_url_from_args, EXTERNAL_LAUNCH_DEEP_LINK_SCHEME,
};
pub use host_identity::{
    inspect_external_host_key, inspection_for_key, inspection_for_preprovisioned_route,
    trust_external_host_key, ExternalHostKeyInspection, ExternalHostKeyStatus,
};
pub use intake::{
    ExternalLaunchAcceptOutcome, ExternalLaunchEventKind, ExternalLaunchEventPayload,
    ExternalLaunchIntake, ExternalLaunchIntakeSnapshot, ExternalLaunchNoop, ExternalLaunchPolicy,
    ExternalLaunchQueued, ExternalLaunchRejected, ExternalLaunchTargetSummary,
    EXTERNAL_SSH_LAUNCH_EVENT,
};
pub use materializer::{
    external_launch_id_from_target_id, external_target_id, external_target_safety_for_saved_hosts,
    is_external_target_id, ExternalMaterializeOutcome, ExternalMaterializedTarget,
    ExternalMaterializerSnapshot, ExternalSessionMaterializer, ExternalTargetSafety,
};
pub use model::{
    ExternalLaunchEntrypoint, ExternalLaunchIntent, ExternalLaunchParseInput,
    ExternalLaunchRequestDiagnostics, ExternalLaunchSource, ExternalLaunchSourceTool,
    ExternalSecretKind, ExternalSecretMaterial, ExternalSecretSlot, ExternalSecretSource,
    ExternalSessionSecretRef, ExternalSshAuth, ExternalSshLaunchOptions, ExternalSshLaunchRequest,
    ExternalSshRouteHop, ExternalSshTarget,
};
pub use parser::{ExternalLaunchParser, ExternalLaunchParserRegistry};
pub use secret::{ExternalLaunchSecretBroker, ExternalLaunchSecretBrokerSnapshot};
pub use task_registry::{
    ExternalLaunchTaskCancellation, ExternalLaunchTaskRegistry, ExternalLaunchTaskSnapshot,
    ExternalLaunchTaskStage,
};
