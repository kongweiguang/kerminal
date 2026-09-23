//! 任务拥有的 SFTP stream：丢弃任务时唤醒并中止库内部读写，避免残留后台写入。
//! @author kongweiguang

use futures::task::AtomicWaker;
use std::{
    io,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

#[derive(Default)]
struct ShutdownState {
    stopped: AtomicBool,
    reader: AtomicWaker,
    writer: AtomicWaker,
}

pub(super) struct StreamOwner(Arc<ShutdownState>);
pub(super) struct OwnedStream<S> {
    inner: S,
    state: Arc<ShutdownState>,
}

impl StreamOwner {
    /// owner 与底层库分离，future drop 也能唤醒库里正在 pending 的 write_all。
    pub(super) fn wrap<S>(inner: S) -> (Self, OwnedStream<S>) {
        let state = Arc::new(ShutdownState::default());
        (Self(state.clone()), OwnedStream { inner, state })
    }
}
impl Drop for StreamOwner {
    /// 两个半流均被唤醒，不依赖库 close 消息排在阻塞写之后才被处理。
    fn drop(&mut self) {
        self.0.stopped.store(true, Ordering::SeqCst);
        self.0.reader.wake();
        self.0.writer.wake();
    }
}
impl<S: AsyncRead + Unpin> AsyncRead for OwnedStream<S> {
    /// 先注册再检查关闭位，消除丢唤醒；停止后返回 EOF，令 SFTP 库退出读循环而非反复重试错误占满 runtime。
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.state.reader.register(cx.waker());
        if self.state.stopped.load(Ordering::SeqCst) {
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for OwnedStream<S> {
    /// 中止返回硬错误，禁止已取消任务继续排入远端写请求。
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.state.writer.register(cx.waker());
        if self.state.stopped.load(Ordering::SeqCst) {
            return Poll::Ready(Err(io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    /// flush 同样必须可中止，不能让后台任务卡在最后一次缓冲区写出。
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.state.writer.register(cx.waker());
        if self.state.stopped.load(Ordering::SeqCst) {
            return Poll::Ready(Err(io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    /// 已停止的 stream 不再等待远端完成 shutdown 握手。
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.state.stopped.load(Ordering::SeqCst) {
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::StreamOwner;
    use std::{io::ErrorKind, time::Duration};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        time::timeout,
    };

    /// 取消时读端必须以 EOF 结束第三方库的循环，而写端仍禁止排入任何新数据。
    #[tokio::test]
    async fn owner_drop_ends_reader_and_rejects_writer() {
        let (stream, _peer) = tokio::io::duplex(8);
        let (owner, mut stream) = StreamOwner::wrap(stream);
        drop(owner);
        let mut byte = [0_u8; 1];
        assert_eq!(
            timeout(Duration::from_secs(1), stream.read(&mut byte))
                .await
                .expect("cancelled read must wake")
                .expect("cancelled read is EOF"),
            0
        );
        assert_eq!(
            stream
                .write_all(b"blocked")
                .await
                .expect_err("cancelled writer must stop")
                .kind(),
            ErrorKind::ConnectionAborted
        );
    }
}
