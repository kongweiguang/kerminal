//! SSH 端口转发运行态 JSON 文件访问层。
//!
//! @author kongweiguang

use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    models::port_forward::PortForwardSummary,
    storage::RuntimeFileStore,
};

const PORT_FORWARD_STATE_FILE: &str = "data/port-forwards/sessions.json";
const PORT_FORWARD_STATE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PortForwardStateFile {
    schema_version: u32,
    sessions: Vec<PortForwardSummary>,
}

impl RuntimeFileStore {
    /// 保存或更新一条脱敏端口转发摘要。
    pub fn upsert_port_forward_summary(&self, summary: &PortForwardSummary) -> AppResult<()> {
        self.with_file_io(|root| {
            let mut state = read_port_forward_state(root)?;
            if let Some(existing) = state
                .sessions
                .iter_mut()
                .find(|session| session.id == summary.id)
            {
                *existing = summary.clone();
            } else {
                state.sessions.push(summary.clone());
            }
            sort_port_forward_summaries(&mut state.sessions);
            write_port_forward_state(root, &state)?;
            Ok(())
        })
    }

    /// 返回全部已保存端口转发摘要。
    pub fn list_port_forward_summaries(&self) -> AppResult<Vec<PortForwardSummary>> {
        self.with_file_io(|root| {
            let mut summaries = read_port_forward_state(root)?.sessions;
            sort_port_forward_summaries(&mut summaries);
            Ok(summaries)
        })
    }

    /// 根据 id 返回已保存端口转发摘要。
    pub fn port_forward_summary_by_id(
        &self,
        forward_id: &str,
    ) -> AppResult<Option<PortForwardSummary>> {
        self.with_file_io(|root| {
            Ok(read_port_forward_state(root)?
                .sessions
                .into_iter()
                .find(|summary| summary.id == forward_id))
        })
    }

    /// 删除一条已保存端口转发摘要。
    pub fn delete_port_forward_summary(&self, forward_id: &str) -> AppResult<bool> {
        self.with_file_io(|root| {
            let mut state = read_port_forward_state(root)?;
            let before_len = state.sessions.len();
            state.sessions.retain(|summary| summary.id != forward_id);
            let deleted = state.sessions.len() != before_len;
            if deleted {
                write_port_forward_state(root, &state)?;
            }
            Ok(deleted)
        })
    }
}

fn read_port_forward_state(root: &Path) -> AppResult<PortForwardStateFile> {
    let path = port_forward_state_path(root);
    if !path.exists() {
        return Ok(empty_port_forward_state());
    }
    let file = File::open(path)?;
    let state: PortForwardStateFile = serde_json::from_reader(file)?;
    if state.schema_version != PORT_FORWARD_STATE_SCHEMA_VERSION {
        return Err(AppError::InvalidInput(format!(
            "unsupported port forward state schema version: {}",
            state.schema_version
        )));
    }
    Ok(state)
}

fn write_port_forward_state(root: &Path, state: &PortForwardStateFile) -> AppResult<()> {
    let path = port_forward_state_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp_path = temp_state_path(&path);
    {
        let mut file = File::create(&temp_path)?;
        serde_json::to_writer_pretty(&mut file, state)?;
        file.write_all(b"\n")?;
        file.flush()?;
        file.sync_all()?;
    }
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temp_path, path)?;
    Ok(())
}

fn empty_port_forward_state() -> PortForwardStateFile {
    PortForwardStateFile {
        schema_version: PORT_FORWARD_STATE_SCHEMA_VERSION,
        sessions: Vec::new(),
    }
}

fn port_forward_state_path(root: &Path) -> PathBuf {
    root.join(PORT_FORWARD_STATE_FILE)
}

fn temp_state_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

fn sort_port_forward_summaries(summaries: &mut [PortForwardSummary]) {
    summaries.sort_by(|left, right| {
        left.created_at
            .parse::<u64>()
            .unwrap_or(0)
            .cmp(&right.created_at.parse::<u64>().unwrap_or(0))
            .then_with(|| left.id.cmp(&right.id))
    });
}
