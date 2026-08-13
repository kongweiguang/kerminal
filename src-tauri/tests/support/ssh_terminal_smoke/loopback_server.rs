// @author kongweiguang

#[derive(Clone)]
struct LoopbackInteractiveSshServer;

struct LoopbackInteractiveSshSession {
    channels: HashMap<ChannelId, Channel<Msg>>,
    escape_sequence_channels: HashSet<ChannelId>,
    interrupt_wait_channels: HashSet<ChannelId>,
    line_buffers: HashMap<ChannelId, String>,
}

impl russh::server::Server for LoopbackInteractiveSshServer {
    type Handler = LoopbackInteractiveSshSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackInteractiveSshSession {
            channels: HashMap::new(),
            escape_sequence_channels: HashSet::new(),
            interrupt_wait_channels: HashSet::new(),
            line_buffers: HashMap::new(),
        }
    }
}

impl russh::server::Handler for LoopbackInteractiveSshSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == LOOPBACK_USER && password == LOOPBACK_PASSWORD {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    /// 显式接受会话通道，使 loopback fixture 与 russh 0.62 的真实服务端握手语义一致。
    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(
            channel,
            format!("{LOOPBACK_READY_MARKER}\r\n$ ").into_bytes(),
        )?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        channel: ChannelId,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let text = String::from_utf8_lossy(data);
        for character in text.chars() {
            if self.consume_escape_sequence_character(channel, character) {
                continue;
            }
            match character {
                '\u{0003}' => {
                    self.line_buffers.entry(channel).or_default().clear();
                    let output = if self.interrupt_wait_channels.remove(&channel) {
                        format!("^C\r\n{LOOPBACK_INTERRUPT_MARKER}\r\n$ ")
                    } else {
                        "^C\r\n$ ".to_owned()
                    };
                    session.data(channel, output.into_bytes())?;
                }
                '\u{0004}' => {
                    self.line_buffers.entry(channel).or_default().clear();
                    self.interrupt_wait_channels.remove(&channel);
                    session.exit_status_request(channel, 0)?;
                    session.eof(channel)?;
                    session.close(channel)?;
                }
                '\u{001b}' => {
                    self.escape_sequence_channels.insert(channel);
                }
                '\r' | '\n' => {
                    let line = self.line_buffers.entry(channel).or_default();
                    if line.is_empty() {
                        continue;
                    }
                    let command = std::mem::take(line);
                    self.handle_command(channel, &command, session)?;
                }
                '\u{0008}' | '\u{007f}' => {
                    self.line_buffers.entry(channel).or_default().pop();
                }
                _ if !character.is_control() => {
                    self.line_buffers
                        .entry(channel)
                        .or_default()
                        .push(character);
                }
                _ => {}
            }
        }
        Ok(())
    }
}
impl LoopbackInteractiveSshSession {
    fn consume_escape_sequence_character(&mut self, channel: ChannelId, character: char) -> bool {
        if !self.escape_sequence_channels.contains(&channel) {
            return false;
        }
        if character.is_ascii_alphabetic() || character == '~' {
            self.escape_sequence_channels.remove(&channel);
        }
        true
    }

    fn handle_command(
        &mut self,
        channel: ChannelId,
        command: &str,
        session: &mut Session,
    ) -> Result<(), russh::Error> {
        let command = command.trim();
        if command == "exit" {
            session.exit_status_request(channel, 0)?;
            session.eof(channel)?;
            session.close(channel)?;
            return Ok(());
        }
        if command.contains(LOOPBACK_INTERRUPT_COMMAND) {
            self.interrupt_wait_channels.insert(channel);
            session.data(channel, b"interrupt-armed\r\n".to_vec())?;
            return Ok(());
        }
        if command.contains(LOOPBACK_HIGH_OUTPUT_COMMAND) {
            let filler = "0123456789abcdef".repeat(32);
            session.data(
                channel,
                format!("{LOOPBACK_HIGH_OUTPUT_START}\r\n").into_bytes(),
            )?;
            for index in 0..LOOPBACK_HIGH_OUTPUT_LINES {
                session.data(
                    channel,
                    format!("{LOOPBACK_HIGH_OUTPUT_LINE}-{index:03}-{filler}\r\n").into_bytes(),
                )?;
            }
            session.data(
                channel,
                format!("{LOOPBACK_HIGH_OUTPUT_END}\r\n$ ").into_bytes(),
            )?;
            return Ok(());
        }
        if command.contains(LOOPBACK_TUI_COMMAND) {
            session.data(
                channel,
                format!("\u{1b}[?1049h\u{1b}[2J{LOOPBACK_TUI_MARKER}\r\n\u{1b}[?1049l$ ")
                    .into_bytes(),
            )?;
            return Ok(());
        }
        if command.contains(LOOPBACK_AGENT_SIGNAL_COMMAND) {
            session.data(
                channel,
                format!("{LOOPBACK_AGENT_OSC_MARKER}{LOOPBACK_AGENT_SIGNAL_VISIBLE_MARKER}\r\n$ ")
                    .into_bytes(),
            )?;
            return Ok(());
        }

        let mut output = Vec::new();
        if command.contains(COMMAND_MARKER) {
            output.push(COMMAND_MARKER);
        }
        let unicode_marker_escape = posix_printf_octal_escape(UNICODE_COMMAND_MARKER);
        if command.contains(UNICODE_COMMAND_MARKER)
            || command.contains(&unicode_marker_escape)
            || command.contains(LOOPBACK_UNICODE_REQUEST_MARKER)
        {
            output.push(UNICODE_COMMAND_MARKER);
        }
        let output = if output.is_empty() {
            "ok".to_owned()
        } else {
            output.join("\r\n")
        };
        session.data(channel, format!("{output}\r\n$ ").into_bytes())?;
        Ok(())
    }
}
