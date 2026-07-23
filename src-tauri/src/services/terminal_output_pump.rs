//! Local PTY output coalescing and terminal event ordering.
//!
//! @author kongweiguang

use crate::models::terminal::TerminalOutputEvent;

const DEFAULT_FLUSH_BYTES: usize = 64 * 1024;
const DEFAULT_MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_OVERFLOW_NOTICE: &str =
    "\r\n\x1b[0m\x1b[33m[Kerminal] terminal output backlog exceeded; stale output was dropped.\x1b[0m\r\n";

/// Receives already prepared terminal output events from the pump.
pub trait PtyOutputSink {
    /// Returns false when the downstream consumer is no longer available.
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool;
}

impl<F> PtyOutputSink for F
where
    F: FnMut(TerminalOutputEvent) -> bool,
{
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool {
        self(event)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtyOutputPumpConfig {
    /// Flush once pending output reaches this size. Time based idle flushing is
    /// owned by the reader/flusher adapter so the pump remains deterministic.
    pub flush_bytes: usize,
    /// Maximum bytes the pump may hold before dropping stale pending output.
    pub max_pending_bytes: usize,
    /// Notice inserted when stale pending output has to be dropped.
    pub overflow_notice: String,
}

impl Default for PtyOutputPumpConfig {
    fn default() -> Self {
        Self {
            flush_bytes: DEFAULT_FLUSH_BYTES,
            max_pending_bytes: DEFAULT_MAX_PENDING_BYTES,
            overflow_notice: DEFAULT_OVERFLOW_NOTICE.to_owned(),
        }
    }
}

impl PtyOutputPumpConfig {
    fn normalized(mut self) -> Self {
        self.flush_bytes = self.flush_bytes.max(1);
        self.max_pending_bytes = self
            .max_pending_bytes
            .max(1)
            .max(self.overflow_notice.len());
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PtyOutputPumpStats {
    pub buffered_chunks: u64,
    pub coalesced_chunks: u64,
    pub input_chunks: u64,
    pub input_bytes: u64,
    pub data_events: u64,
    pub closed_events: u64,
    pub error_events: u64,
    pub output_bytes: u64,
    pub flush_count: u64,
    pub final_tail_flush_count: u64,
    pub max_pending_bytes: usize,
    pub max_pending_hit_count: u64,
    pub dropped_bytes: u64,
    pub overflow_count: u64,
}

/// Stateful output pump for a single PTY session.
pub struct PtyOutputPump {
    config: PtyOutputPumpConfig,
    finished: bool,
    pending: String,
    session_id: String,
    stats: PtyOutputPumpStats,
}

impl PtyOutputPump {
    pub fn new(session_id: impl Into<String>, config: PtyOutputPumpConfig) -> Self {
        Self {
            config: config.normalized(),
            finished: false,
            pending: String::new(),
            session_id: session_id.into(),
            stats: PtyOutputPumpStats::default(),
        }
    }

    pub fn push_data(&mut self, data: &str, sink: &mut impl PtyOutputSink) -> bool {
        if self.finished {
            return false;
        }
        if data.is_empty() {
            return true;
        }

        self.stats.input_chunks = self.stats.input_chunks.saturating_add(1);
        self.stats.input_bytes = self.stats.input_bytes.saturating_add(data.len() as u64);
        self.push_pending(data);
        self.stats.buffered_chunks = self.stats.buffered_chunks.saturating_add(1);
        if self.pending.len() >= self.config.flush_bytes {
            return self.flush(sink);
        }
        true
    }

    pub fn flush(&mut self, sink: &mut impl PtyOutputSink) -> bool {
        self.flush_pending(sink, false)
    }

    fn flush_pending(&mut self, sink: &mut impl PtyOutputSink, final_tail: bool) -> bool {
        if self.finished {
            return false;
        }
        if self.pending.is_empty() {
            return true;
        }

        let data = std::mem::take(&mut self.pending);
        let flushed_chunks = self.stats.buffered_chunks;
        self.stats.buffered_chunks = 0;
        self.stats.data_events = self.stats.data_events.saturating_add(1);
        self.stats.flush_count = self.stats.flush_count.saturating_add(1);
        self.stats.coalesced_chunks = self.stats.coalesced_chunks.saturating_add(flushed_chunks);
        if final_tail {
            self.stats.final_tail_flush_count = self.stats.final_tail_flush_count.saturating_add(1);
        }
        self.stats.output_bytes = self.stats.output_bytes.saturating_add(data.len() as u64);
        let accepted = sink.on_terminal_output(TerminalOutputEvent::data(&self.session_id, data));
        if !accepted {
            self.finished = true;
        }
        accepted
    }

    pub fn finish_closed(&mut self, sink: &mut impl PtyOutputSink) -> bool {
        self.prepare_closed(sink) && self.emit_closed(sink)
    }

    /// 在发出 Closed 前完成尾部 flush 和状态更新，使适配层能先发布终态指标。
    pub(crate) fn prepare_closed(&mut self, sink: &mut impl PtyOutputSink) -> bool {
        if self.finished {
            return false;
        }
        if !self.flush_pending(sink, true) {
            return false;
        }
        self.finished = true;
        self.stats.closed_events = self.stats.closed_events.saturating_add(1);
        true
    }

    /// 把已经完成的 Closed 状态交给下游消费者。
    pub(crate) fn emit_closed(&self, sink: &mut impl PtyOutputSink) -> bool {
        sink.on_terminal_output(TerminalOutputEvent::closed(&self.session_id))
    }

    pub fn finish_error(
        &mut self,
        message: impl Into<String>,
        sink: &mut impl PtyOutputSink,
    ) -> bool {
        let message = message.into();
        self.prepare_error(sink) && self.emit_error(message, sink)
    }

    /// 在发出 Error 前完成尾部 flush 和状态更新，使适配层能先发布终态指标。
    pub(crate) fn prepare_error(&mut self, sink: &mut impl PtyOutputSink) -> bool {
        if self.finished {
            return false;
        }
        if !self.flush_pending(sink, true) {
            return false;
        }
        self.finished = true;
        self.stats.error_events = self.stats.error_events.saturating_add(1);
        true
    }

    /// 把已经完成的 Error 状态交给下游消费者。
    pub(crate) fn emit_error(
        &self,
        message: impl Into<String>,
        sink: &mut impl PtyOutputSink,
    ) -> bool {
        sink.on_terminal_output(TerminalOutputEvent::error(&self.session_id, message.into()))
    }

    pub fn pending_bytes(&self) -> usize {
        self.pending.len()
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }

    pub fn stats(&self) -> &PtyOutputPumpStats {
        &self.stats
    }

    fn push_pending(&mut self, data: &str) {
        if self.pending.len().saturating_add(data.len()) > self.config.max_pending_bytes {
            self.stats.overflow_count = self.stats.overflow_count.saturating_add(1);
            self.stats.max_pending_hit_count = self.stats.max_pending_hit_count.saturating_add(1);
            self.stats.dropped_bytes = self
                .stats
                .dropped_bytes
                .saturating_add(self.pending.len() as u64);
            self.pending.clear();
            self.stats.buffered_chunks = 0;
            self.pending.push_str(&self.config.overflow_notice);
        }

        let remaining = self
            .config
            .max_pending_bytes
            .saturating_sub(self.pending.len());
        if data.len() > remaining {
            let tail_start = tail_start_by_bytes(data, remaining);
            self.stats.dropped_bytes = self.stats.dropped_bytes.saturating_add(tail_start as u64);
            self.pending.push_str(&data[tail_start..]);
        } else {
            self.pending.push_str(data);
        }
        self.record_pending_high_water();
    }

    fn record_pending_high_water(&mut self) {
        let pending_bytes = self.pending.len();
        self.stats.max_pending_bytes = self.stats.max_pending_bytes.max(pending_bytes);
        if pending_bytes >= self.config.max_pending_bytes {
            self.stats.max_pending_hit_count = self.stats.max_pending_hit_count.saturating_add(1);
        }
    }
}

fn tail_start_by_bytes(data: &str, max_bytes: usize) -> usize {
    if data.len() <= max_bytes {
        return 0;
    }
    let mut index = data.len() - max_bytes;
    while index < data.len() && !data.is_char_boundary(index) {
        index += 1;
    }
    index
}
