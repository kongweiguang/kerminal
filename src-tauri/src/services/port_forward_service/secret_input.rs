use crate::models::terminal::{TerminalSecretInputEntry, TerminalSecretInputPlan};

pub(super) struct ForwardSecretInputResponder {
    entries: Vec<ForwardSecretInputResponderEntry>,
}

struct ForwardSecretInputResponderEntry {
    prompt_markers: Vec<String>,
    response: String,
    max_responses: usize,
    responses_sent: usize,
}

impl ForwardSecretInputResponder {
    pub(super) fn new(plan: TerminalSecretInputPlan) -> Self {
        Self {
            entries: plan
                .entries
                .into_iter()
                .filter_map(ForwardSecretInputResponderEntry::from_entry)
                .collect(),
        }
    }

    pub(super) fn can_respond(&self) -> bool {
        self.entries
            .iter()
            .any(ForwardSecretInputResponderEntry::can_respond)
    }

    pub(super) fn response_for(&mut self, buffer: &str) -> Option<String> {
        let lower = buffer.to_ascii_lowercase();
        let entry = self.entries.iter_mut().find(|entry| {
            entry.can_respond()
                && entry
                    .prompt_markers
                    .iter()
                    .any(|marker| lower.contains(marker))
        })?;
        entry.responses_sent = entry.responses_sent.saturating_add(1);
        Some(entry.response.clone())
    }
}

impl ForwardSecretInputResponderEntry {
    fn from_entry(entry: TerminalSecretInputEntry) -> Option<Self> {
        let prompt_markers = entry
            .prompt_markers
            .into_iter()
            .map(|marker| marker.to_ascii_lowercase())
            .filter(|marker| !marker.trim().is_empty())
            .collect::<Vec<_>>();
        if entry.response.is_empty() || entry.max_responses == 0 || prompt_markers.is_empty() {
            return None;
        }
        Some(Self {
            prompt_markers,
            response: entry.response,
            max_responses: entry.max_responses,
            responses_sent: 0,
        })
    }

    fn can_respond(&self) -> bool {
        self.responses_sent < self.max_responses
    }
}
