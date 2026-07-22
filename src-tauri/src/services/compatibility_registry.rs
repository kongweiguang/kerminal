//! 跨运行时兼容清单、脱敏指标与退役门禁。
//!
//! @author kongweiguang

use std::{
    collections::{BTreeMap, HashSet},
    fmt,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};

const REGISTRY_MANIFEST: &str =
    include_str!("../../../src/architecture/compatibility/registry.json");

static REGISTRY: OnceLock<Result<Vec<CompatibilityEntry>, RegistryError>> = OnceLock::new();

/// 兼容项分类。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CompatibilityCategory {
    DiagnosticPolicy,
    PreviewAdapter,
    RuntimeFallback,
    RuntimePatch,
    SchemaCompatibility,
    SemanticCompatibility,
    StartupRecovery,
}

/// 兼容项生命周期。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CompatibilityLifecycle {
    Governance,
    Sunset,
    SupportedMode,
}

/// 待退役兼容项的静态门禁要求。
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RetirementPolicy {
    pub minimum_zero_windows: u32,
    pub review_by: String,
    pub target_task: String,
}

/// 单个兼容项的内部治理信息。
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityEntry {
    pub allowed_reasons: Vec<String>,
    pub category: CompatibilityCategory,
    pub id: String,
    pub implementation_refs: Vec<String>,
    pub lifecycle: CompatibilityLifecycle,
    pub owner: String,
    pub retirement: Option<RetirementPolicy>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryManifest {
    entries: Vec<CompatibilityEntry>,
    schema_version: u32,
}

/// 调用方提供的兼容命中计数；不接受 detail 或任意标签。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompatibilityMetric {
    pub activation_count: u64,
    pub failure_count: u64,
    pub id: String,
}

/// 可安全进入 runtime snapshot/tool help 的聚合指标。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityMetricSnapshot {
    pub entries: Vec<CompatibilityMetricSnapshotEntry>,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityMetricSnapshotEntry {
    pub activation_count: u64,
    pub category: CompatibilityCategory,
    pub failure_count: u64,
    pub id: String,
    pub lifecycle: CompatibilityLifecycle,
}

/// 进程内兼容指标收集器；只接受 registry ID/reason 与计数，不保存任意标签。
#[derive(Debug, Default)]
pub struct CompatibilityMetrics {
    counters: Mutex<BTreeMap<String, (u64, u64)>>,
}

impl CompatibilityMetrics {
    /// 记录一次启用尝试。允许时增加 activation，拒绝时增加 failure。
    pub fn record_activation(
        &self,
        id: &str,
        reason: &str,
    ) -> Result<ActivationDecision, RegistryError> {
        let decision = evaluate_activation(id, reason)?;
        let mut counters = self
            .counters
            .lock()
            .map_err(|_| RegistryError("兼容指标状态不可用"))?;
        let counter = counters.entry(id.to_owned()).or_default();
        if decision.allowed {
            counter.0 = counter.0.saturating_add(1);
        } else {
            counter.1 = counter.1.saturating_add(1);
        }
        Ok(decision)
    }

    /// 记录已进入兼容路径后的运行失败。
    pub fn record_failure(&self, id: &str) -> Result<(), RegistryError> {
        require_entry(id)?;
        let mut counters = self
            .counters
            .lock()
            .map_err(|_| RegistryError("兼容指标状态不可用"))?;
        let counter = counters.entry(id.to_owned()).or_default();
        counter.1 = counter.1.saturating_add(1);
        Ok(())
    }

    /// 返回脱敏聚合快照，不暴露调用 reason、owner 或实现路径。
    pub fn snapshot(&self) -> Result<CompatibilityMetricSnapshot, RegistryError> {
        let counters = self
            .counters
            .lock()
            .map_err(|_| RegistryError("兼容指标状态不可用"))?;
        let metrics = counters
            .iter()
            .map(
                |(id, (activation_count, failure_count))| CompatibilityMetric {
                    activation_count: *activation_count,
                    failure_count: *failure_count,
                    id: id.clone(),
                },
            )
            .collect::<Vec<_>>();
        build_metric_snapshot(&metrics)
    }
}

/// 启用决策只返回稳定 code，不回显调用方 reason。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActivationDecision {
    pub allowed: bool,
    pub code: &'static str,
}

/// 兼容项退役证据。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetirementEvidence {
    pub consecutive_zero_windows: u32,
    pub regression_tests_green: bool,
    pub rollback_documented: bool,
}

/// 退役门禁结论。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetirementDecision {
    Allowed,
    Blocked,
    NotEligible,
}

/// Registry 错误不包含输入值，避免未知 ID 或 reason 旁路进入日志。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryError(&'static str);

impl fmt::Display for RegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for RegistryError {}

/// 加载并校验唯一 manifest。
pub fn registry_entries() -> Result<&'static [CompatibilityEntry], RegistryError> {
    match REGISTRY.get_or_init(load_registry) {
        Ok(entries) => Ok(entries),
        Err(error) => Err(error.clone()),
    }
}

fn load_registry() -> Result<Vec<CompatibilityEntry>, RegistryError> {
    let manifest: RegistryManifest =
        serde_json::from_str(REGISTRY_MANIFEST).map_err(|_| RegistryError("兼容清单无法解析"))?;
    if manifest.schema_version != 1 {
        return Err(RegistryError("兼容清单版本不受支持"));
    }
    validate_registry(&manifest.entries)?;
    Ok(manifest.entries)
}

/// 校验 ID、owner、启用原因和退役元数据。
pub fn validate_registry(entries: &[CompatibilityEntry]) -> Result<(), RegistryError> {
    let mut ids = HashSet::new();
    for entry in entries {
        if !valid_stable_token(&entry.id) || !ids.insert(entry.id.as_str()) {
            return Err(RegistryError("兼容清单包含无效或重复 ID"));
        }
        if entry.owner.trim().is_empty()
            || entry.allowed_reasons.is_empty()
            || entry.implementation_refs.is_empty()
        {
            return Err(RegistryError("兼容项缺少治理元数据"));
        }
        let mut reasons = HashSet::new();
        if entry
            .allowed_reasons
            .iter()
            .any(|reason| !valid_stable_token(reason) || !reasons.insert(reason.as_str()))
        {
            return Err(RegistryError("兼容项包含无效或重复启用原因"));
        }
        match (entry.lifecycle, entry.retirement.as_ref()) {
            (CompatibilityLifecycle::Sunset, Some(policy))
                if policy.minimum_zero_windows > 0
                    && !policy.target_task.trim().is_empty()
                    && valid_date(&policy.review_by) => {}
            (CompatibilityLifecycle::Sunset, _) => {
                return Err(RegistryError("待退役兼容项缺少完整门禁"));
            }
            (_, Some(_)) => return Err(RegistryError("长期兼容项不得声明退役任务")),
            (_, None) => {}
        }
    }
    Ok(())
}

/// 判断指定 reason 是否允许进入兼容路径；未知项与未知原因默认拒绝。
pub fn evaluate_activation(id: &str, reason: &str) -> Result<ActivationDecision, RegistryError> {
    let entry = require_entry(id)?;
    let allowed = entry.allowed_reasons.iter().any(|value| value == reason);
    Ok(ActivationDecision {
        allowed,
        code: if allowed {
            "allowed-by-registry"
        } else {
            "reason-not-registered"
        },
    })
}

/// 构建可公开的聚合快照，丢弃 owner、源码路径和退役细节。
pub fn build_metric_snapshot(
    metrics: &[CompatibilityMetric],
) -> Result<CompatibilityMetricSnapshot, RegistryError> {
    let mut aggregates = BTreeMap::<&str, (u64, u64)>::new();
    for metric in metrics {
        require_entry(&metric.id)?;
        let current = aggregates.entry(&metric.id).or_default();
        current.0 = current.0.saturating_add(metric.activation_count);
        current.1 = current.1.saturating_add(metric.failure_count);
    }
    let mut entries = Vec::with_capacity(aggregates.len());
    for (id, (activation_count, failure_count)) in aggregates {
        let registry_entry = require_entry(id)?;
        entries.push(CompatibilityMetricSnapshotEntry {
            activation_count,
            category: registry_entry.category,
            failure_count,
            id: id.to_owned(),
            lifecycle: registry_entry.lifecycle,
        });
    }
    Ok(CompatibilityMetricSnapshot {
        entries,
        schema_version: 1,
    })
}

/// 根据静态策略和本轮证据判断兼容项是否可退役。
pub fn evaluate_retirement(
    id: &str,
    evidence: &RetirementEvidence,
) -> Result<RetirementDecision, RegistryError> {
    let entry = require_entry(id)?;
    let Some(policy) = entry.retirement.as_ref() else {
        return Ok(RetirementDecision::NotEligible);
    };
    Ok(
        if evidence.consecutive_zero_windows >= policy.minimum_zero_windows
            && evidence.regression_tests_green
            && evidence.rollback_documented
        {
            RetirementDecision::Allowed
        } else {
            RetirementDecision::Blocked
        },
    )
}

fn require_entry(id: &str) -> Result<&'static CompatibilityEntry, RegistryError> {
    registry_entries()?
        .iter()
        .find(|entry| entry.id == id)
        .ok_or(RegistryError("兼容项未登记"))
}

fn valid_stable_token(value: &str) -> bool {
    value
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
        && value.split(['.', '-']).all(|segment| !segment.is_empty())
}

fn valid_date(value: &str) -> bool {
    value.len() == 10
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 4 | 7) {
                byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        })
}
