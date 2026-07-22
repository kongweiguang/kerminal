use super::*;
use crate::models::remote_host::RemoteHostAuthType;
use crate::services::ssh_runtime::{ManagedSshStreamingExecSession, SshRuntimeStreamingExecExit};
use tokio_util::sync::CancellationToken;

const DOCKER_CP_STDERR_BYTES: usize = 512 * 1024;
const DOCKER_CP_STDOUT_BYTES: usize = 64 * 1024;

pub(super) async fn upload_to_container(
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    host: &RemoteHost,
    request: DockerContainerTransferRequest,
) -> AppResult<()> {
    let local_path = PathBuf::from(&request.local_path);
    if !local_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "本地路径不存在: {}",
            request.local_path
        )));
    }
    let metadata = fs::metadata(&local_path)?;
    match request.kind {
        SftpTransferKind::File if !metadata.is_file() => {
            return Err(AppError::InvalidInput(
                "上传类型是文件，但本地路径不是文件".to_owned(),
            ));
        }
        SftpTransferKind::Directory if !metadata.is_dir() => {
            return Err(AppError::InvalidInput(
                "上传类型是目录，但本地路径不是目录".to_owned(),
            ));
        }
        _ => {}
    }

    let remote_parent = parent_remote_path(&request.remote_path).unwrap_or_else(|| "/".to_owned());
    let remote_name = remote_file_name(&request.remote_path)?;
    if let Some(session) = open_managed_docker_cp_session(
        paths,
        ssh_commands,
        host,
        request.runtime,
        &request.container_id,
        &remote_parent,
        DockerCpDirection::Upload,
    )
    .await?
    {
        return upload_to_container_with_managed_exec(
            session,
            local_path,
            remote_name,
            request.kind,
        )
        .await;
    }

    let mut child = spawn_docker_cp_process(
        host,
        request.runtime,
        &request.container_id,
        &remote_parent,
        DockerCpDirection::Upload,
    )?;
    let stdout = child.stdout.take().map(spawn_byte_reader);
    let stderr = child.stderr.take().map(spawn_byte_reader);
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Docker("无法打开 docker cp stdin".to_owned()))?;

    let write_result = write_tar_stream(stdin, &local_path, &remote_name, request.kind);
    if let Err(error) = write_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    let status = child
        .wait()
        .map_err(|error| AppError::Docker(format!("等待 docker cp 上传失败: {error}")))?;
    let stdout = join_byte_reader(stdout)?;
    let stderr = join_byte_reader(stderr)?;
    ensure_command_success(status.success(), "容器上传失败", &stdout, &stderr)
}

pub(super) async fn download_from_container(
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    host: &RemoteHost,
    request: DockerContainerTransferRequest,
) -> AppResult<()> {
    if let Some(session) = open_managed_docker_cp_session(
        paths,
        ssh_commands,
        host,
        request.runtime,
        &request.container_id,
        &request.remote_path,
        DockerCpDirection::Download,
    )
    .await?
    {
        return download_from_container_with_managed_exec(session, request).await;
    }

    let mut child = spawn_docker_cp_process(
        host,
        request.runtime,
        &request.container_id,
        &request.remote_path,
        DockerCpDirection::Download,
    )?;
    let stderr = child.stderr.take().map(spawn_byte_reader);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Docker("无法打开 docker cp stdout".to_owned()))?;

    let extract_result = extract_tar_stream(stdout, Path::new(&request.local_path), request.kind);
    let status = child
        .wait()
        .map_err(|error| AppError::Docker(format!("等待 docker cp 下载失败: {error}")))?;
    let stderr = join_byte_reader(stderr)?;
    extract_result?;
    ensure_command_success(status.success(), "容器下载失败", &[], &stderr)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DockerCpDirection {
    Upload,
    Download,
}

async fn open_managed_docker_cp_session(
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    host: &RemoteHost,
    runtime: ContainerRuntime,
    container_id: &str,
    remote_path: &str,
    direction: DockerCpDirection,
) -> AppResult<Option<ManagedSshStreamingExecSession>> {
    let remote_command =
        build_docker_cp_remote_command(runtime, container_id, remote_path, direction);
    ssh_commands
        .open_managed_streaming_exec(
            paths,
            &host.id,
            remote_command,
            CONTAINER_TRANSFER_TIMEOUT_SECONDS,
            CancellationToken::new(),
        )
        .await
}

async fn upload_to_container_with_managed_exec(
    mut session: ManagedSshStreamingExecSession,
    local_path: PathBuf,
    remote_name: String,
    kind: SftpTransferKind,
) -> AppResult<()> {
    let stdout = Some(spawn_limited_byte_reader(
        session.take_stdout()?,
        DOCKER_CP_STDOUT_BYTES,
    ));
    let stderr = Some(spawn_limited_byte_reader(
        session.take_stderr()?,
        DOCKER_CP_STDERR_BYTES,
    ));
    let stdin = session.take_stdin()?;
    let write_result = tokio::task::spawn_blocking(move || {
        write_tar_stream(stdin, &local_path, &remote_name, kind)
    })
    .await
    .map_err(|error| AppError::Docker(format!("容器上传打包线程失败: {error}")))?;
    if let Err(error) = write_result {
        let _ = session.kill();
        let _ = wait_streaming_exec(session).await;
        return Err(error);
    }

    let exit = wait_streaming_exec(session).await?;
    let stdout = join_byte_reader(stdout)?;
    let stderr = join_byte_reader(stderr)?;
    ensure_command_success(exit.exit_code == Some(0), "容器上传失败", &stdout, &stderr)
}

async fn download_from_container_with_managed_exec(
    mut session: ManagedSshStreamingExecSession,
    request: DockerContainerTransferRequest,
) -> AppResult<()> {
    let stderr = Some(spawn_limited_byte_reader(
        session.take_stderr()?,
        DOCKER_CP_STDERR_BYTES,
    ));
    let stdout = session.take_stdout()?;
    session.close_stdin()?;
    let local_path = PathBuf::from(request.local_path);
    let kind = request.kind;
    let extract_task =
        tokio::task::spawn_blocking(move || extract_tar_stream(stdout, &local_path, kind));
    let exit = wait_streaming_exec(session).await?;
    let stderr = join_byte_reader(stderr)?;
    let extract_result = extract_task
        .await
        .map_err(|error| AppError::Docker(format!("容器下载解包线程失败: {error}")))?;
    extract_result?;
    ensure_command_success(exit.exit_code == Some(0), "容器下载失败", &[], &stderr)
}

async fn wait_streaming_exec(
    session: ManagedSshStreamingExecSession,
) -> AppResult<SshRuntimeStreamingExecExit> {
    tokio::task::spawn_blocking(move || {
        let mut session = session;
        session.wait()
    })
    .await
    .map_err(|error| AppError::Docker(format!("等待受管 docker cp 流失败: {error}")))?
}

fn build_docker_cp_remote_command(
    runtime: ContainerRuntime,
    container_id: &str,
    remote_path: &str,
    direction: DockerCpDirection,
) -> String {
    let remote_ref = format!("{container_id}:{remote_path}");
    match direction {
        DockerCpDirection::Upload => {
            format!("{} cp - {}", runtime.as_str(), shell_quote(&remote_ref))
        }
        DockerCpDirection::Download => {
            format!("{} cp {} -", runtime.as_str(), shell_quote(&remote_ref))
        }
    }
}

pub(super) fn spawn_docker_cp_process(
    host: &RemoteHost,
    runtime: ContainerRuntime,
    container_id: &str,
    remote_path: &str,
    direction: DockerCpDirection,
) -> AppResult<std::process::Child> {
    let ssh = resolve_legacy_docker_cp_ssh_executable()?;
    let remote_command =
        build_docker_cp_remote_command(runtime, container_id, remote_path, direction);
    let mut args = vec![
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ];
    args.extend(legacy_docker_cp_auth_args(host.auth_type));
    args.push(format!("{}@{}", host.username, host.host));
    args.push(remote_command);

    let mut command = Command::new(ssh);
    command.args(args).stderr(Stdio::piped());
    match direction {
        DockerCpDirection::Upload => {
            command.stdin(Stdio::piped()).stdout(Stdio::piped());
        }
        DockerCpDirection::Download => {
            command.stdin(Stdio::null()).stdout(Stdio::piped());
        }
    }
    command
        .spawn()
        .map_err(|error| AppError::Docker(format!("无法启动 docker cp SSH 进程: {error}")))
}

fn legacy_docker_cp_auth_args(auth_type: RemoteHostAuthType) -> Vec<String> {
    let preferred = match auth_type {
        RemoteHostAuthType::Password => "password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey,keyboard-interactive,password",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

fn resolve_legacy_docker_cp_ssh_executable() -> AppResult<String> {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| {
            AppError::Docker("未找到 OpenSSH 客户端，无法使用 docker cp legacy fallback".to_owned())
        })
}

pub fn write_tar_stream<W: Write>(
    writer: W,
    local_path: &Path,
    remote_name: &str,
    kind: SftpTransferKind,
) -> AppResult<()> {
    let mut builder = Builder::new(writer);
    match kind {
        SftpTransferKind::File => builder
            .append_path_with_name(local_path, remote_name)
            .map_err(|error| AppError::Docker(format!("打包上传文件失败: {error}")))?,
        SftpTransferKind::Directory => builder
            .append_dir_all(remote_name, local_path)
            .map_err(|error| AppError::Docker(format!("打包上传目录失败: {error}")))?,
    }
    builder
        .finish()
        .map_err(|error| AppError::Docker(format!("结束上传归档失败: {error}")))
}

pub(super) fn extract_tar_stream<R: Read>(
    reader: R,
    local_path: &Path,
    kind: SftpTransferKind,
) -> AppResult<()> {
    match kind {
        SftpTransferKind::File => extract_first_file(reader, local_path),
        SftpTransferKind::Directory => {
            let parent = local_path.parent().unwrap_or_else(|| Path::new("."));
            fs::create_dir_all(parent)?;
            let mut archive = Archive::new(reader);
            archive
                .unpack(parent)
                .map_err(|error| AppError::Docker(format!("解包下载目录失败: {error}")))
        }
    }
}

pub fn extract_first_file<R: Read>(reader: R, local_path: &Path) -> AppResult<()> {
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut archive = Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|error| AppError::Docker(format!("读取下载归档失败: {error}")))?;
    for entry in entries {
        let mut entry =
            entry.map_err(|error| AppError::Docker(format!("读取下载条目失败: {error}")))?;
        if entry.header().entry_type().is_dir() {
            continue;
        }
        let mut target = StdFile::create(local_path)?;
        std::io::copy(&mut entry, &mut target)
            .map_err(|error| AppError::Docker(format!("写入下载文件失败: {error}")))?;
        return Ok(());
    }
    Err(AppError::Docker("下载归档中没有文件条目".to_owned()))
}

pub(super) fn spawn_byte_reader<R>(mut reader: R) -> thread::JoinHandle<std::io::Result<Vec<u8>>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = Vec::new();
        reader.read_to_end(&mut output)?;
        Ok(output)
    })
}

pub(super) fn spawn_limited_byte_reader<R>(
    mut reader: R,
    max_bytes: usize,
) -> thread::JoinHandle<std::io::Result<Vec<u8>>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let read = reader.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            let remaining = max_bytes.saturating_sub(output.len());
            if remaining > 0 {
                output.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
        Ok(output)
    })
}

pub(super) fn join_byte_reader(
    handle: Option<thread::JoinHandle<std::io::Result<Vec<u8>>>>,
) -> AppResult<Vec<u8>> {
    match handle {
        Some(handle) => handle
            .join()
            .map_err(|_| AppError::Docker("读取 docker cp 输出线程异常退出".to_owned()))?
            .map_err(|error| AppError::Docker(format!("读取 docker cp 输出失败: {error}"))),
        None => Ok(Vec::new()),
    }
}

pub(super) fn ensure_command_success(
    success: bool,
    context: &str,
    stdout: &[u8],
    stderr: &[u8],
) -> AppResult<()> {
    if success {
        return Ok(());
    }
    let message = if !stderr.is_empty() {
        String::from_utf8_lossy(stderr).trim().to_owned()
    } else {
        String::from_utf8_lossy(stdout).trim().to_owned()
    };
    Err(AppError::Docker(format!("{context}: {message}")))
}
