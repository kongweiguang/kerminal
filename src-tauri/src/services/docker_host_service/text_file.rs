use super::*;

use crate::models::file_preview::{file_preview_response_encoding, is_binary_file_preview_content};

const CONTAINER_TEXT_PREVIEW_PROBE_BYTES: usize = 4 * 1024;

pub struct ContainerTextMetadata {
    pub modified: Option<String>,
    pub permissions: Option<String>,
    pub permissions_mode: Option<u32>,
    pub preview_probe: Vec<u8>,
    pub size: u64,
}

pub(super) async fn read_container_text_file(
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    request: DockerContainerReadTextFileRequest,
) -> AppResult<DockerContainerReadTextFileResponse> {
    let max_bytes = request.max_bytes.unwrap_or(DEFAULT_TEXT_FILE_BYTES);
    let read_limit = max_bytes.saturating_add(1);
    let read_args = [request.path.clone(), read_limit.to_string()];
    let output = execute_container_script(
        paths,
        ssh_commands,
        ContainerScriptRequest {
            host_id: &request.host_id,
            runtime: request.runtime,
            container_id: &request.container_id,
            inner_script: r#"target=$1
max_bytes=$2
if [ ! -f "$target" ]; then
  echo "not a regular file: $target" >&2
  exit 66
fi
bytes=$(wc -c < "$target" | tr -d ' ')
mode=$(stat -c '%a' "$target" 2>/dev/null || printf '')
mtime=$(stat -c '%Y' "$target" 2>/dev/null || printf '')
perms=$(ls -ld "$target" 2>/dev/null | awk '{print $1}' || printf '')
probe=$(dd if="$target" bs=1 count=4096 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]')
printf '__KERMINAL_TEXT:%s:%s:%s:%s:%s__\n' "$bytes" "$mode" "$mtime" "$perms" "$probe"
dd if="$target" bs=1 count="$max_bytes" 2>/dev/null
"#,
            args: &read_args,
            timeout_seconds: CONTAINER_FILE_TIMEOUT_SECONDS,
            max_output_bytes: read_limit
                .saturating_add(CONTAINER_TEXT_PREVIEW_PROBE_BYTES.saturating_mul(2))
                .saturating_add(1024)
                .min(
                    MAX_TEXT_FILE_BYTES
                        .saturating_add(CONTAINER_TEXT_PREVIEW_PROBE_BYTES.saturating_mul(2))
                        .saturating_add(1024),
                ),
        },
    )
    .await?;
    let (metadata, captured_content) = split_text_output(&output.stdout)?;
    // SSH 命令输出会先做 UTF-8 lossy 展示，因此优先使用容器内生成的原始字节探针；
    // raw 内容判断仅作为旧输出或探针工具不可用时的兼容兜底。
    let binary = is_binary_file_preview_content(&metadata.preview_probe)
        || is_binary_file_preview_content(captured_content.as_bytes());
    let (visible_content, content_limited) = limit_text_content(&captured_content, max_bytes);
    let visible_bytes_read = visible_content.len();
    let truncated =
        content_limited || output.stdout_truncated || metadata.size > visible_bytes_read as u64;
    let revision_sha256 = sha256_hex(visible_content.as_bytes());
    // 二进制响应只保留元数据和 revision，禁止把远端命令的 lossy 输出传给编辑器。
    let content = if binary {
        String::new()
    } else {
        visible_content
    };

    Ok(DockerContainerReadTextFileResponse {
        host_id: request.host_id,
        container_id: request.container_id,
        path: request.path,
        bytes_read: if binary { 0 } else { visible_bytes_read },
        max_bytes,
        truncated,
        encoding: file_preview_response_encoding(binary).to_owned(),
        line_ending: detect_line_ending(&content),
        revision: SftpFileRevision {
            size: metadata.size,
            modified: metadata.modified,
            permissions: metadata.permissions,
            permissions_mode: metadata.permissions_mode,
            content_sha256: Some(revision_sha256),
        },
        binary,
        readonly: binary,
        content,
    })
}

pub(super) async fn container_file_revision(
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    request: &DockerContainerWriteTextFileRequest,
) -> AppResult<SftpFileRevision> {
    let response = read_container_text_file(
        paths,
        ssh_commands,
        DockerContainerReadTextFileRequest {
            host_id: request.host_id.clone(),
            container_id: request.container_id.clone(),
            runtime: request.runtime,
            path: request.path.clone(),
            max_bytes: Some(MAX_TEXT_FILE_BYTES),
        },
    )
    .await?;
    Ok(response.revision)
}

pub fn split_text_output(output: &str) -> AppResult<(ContainerTextMetadata, String)> {
    let marker_prefix = "__KERMINAL_TEXT:";
    let Some((marker, content)) = output.split_once('\n') else {
        return Err(AppError::Docker(
            "容器文本文件读取输出缺少元数据标记".to_owned(),
        ));
    };
    let marker = marker
        .strip_prefix(marker_prefix)
        .and_then(|value| value.strip_suffix("__"))
        .ok_or_else(|| AppError::Docker("容器文本文件元数据格式无效".to_owned()))?;
    let mut fields = marker.splitn(5, ':');
    let size = fields
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| AppError::Docker("容器文本文件缺少大小元数据".to_owned()))?;
    let permissions_mode = fields.next().and_then(parse_octal_permissions);
    let modified = fields
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let permissions = fields
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let preview_probe = decode_preview_probe_hex(fields.next().unwrap_or_default())?;

    Ok((
        ContainerTextMetadata {
            modified,
            permissions,
            permissions_mode,
            preview_probe,
            size,
        },
        content.to_owned(),
    ))
}

fn decode_preview_probe_hex(value: &str) -> AppResult<Vec<u8>> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(Vec::new());
    }
    if !value.len().is_multiple_of(2) {
        return Err(AppError::Docker("容器文本文件字节探针长度无效".to_owned()));
    }

    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let digits = std::str::from_utf8(pair)
                .map_err(|_| AppError::Docker("容器文本文件字节探针不是有效十六进制".to_owned()))?;
            u8::from_str_radix(digits, 16)
                .map_err(|_| AppError::Docker("容器文本文件字节探针不是有效十六进制".to_owned()))
        })
        .collect()
}

pub(super) fn parse_octal_permissions(value: &str) -> Option<u32> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    u32::from_str_radix(value, 8).ok()
}

pub(super) fn limit_text_content(content: &str, max_bytes: usize) -> (String, bool) {
    if content.len() <= max_bytes {
        return (content.to_owned(), false);
    }
    let bytes = content.as_bytes();
    (
        String::from_utf8_lossy(&bytes[..max_bytes]).into_owned(),
        true,
    )
}

pub(super) fn validate_text_encoding(encoding: &str) -> AppResult<()> {
    match encoding {
        "utf-8" | "utf-8-lossy" => Ok(()),
        _ => Err(AppError::InvalidInput(format!(
            "暂不支持的文本编码: {encoding}"
        ))),
    }
}

pub fn same_revision(expected: &SftpFileRevision, current: &SftpFileRevision) -> bool {
    match (&expected.content_sha256, &current.content_sha256) {
        (Some(expected_hash), Some(current_hash)) => expected_hash == current_hash,
        _ => expected.size == current.size && expected.modified == current.modified,
    }
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn detect_line_ending(content: &str) -> String {
    let crlf = content.matches("\r\n").count();
    let lf = content.matches('\n').count().saturating_sub(crlf);
    match (crlf > 0, lf > 0) {
        (true, true) => "mixed",
        (true, false) => "crlf",
        _ => "lf",
    }
    .to_owned()
}

pub(super) fn write_temp_container_text_file(content: &str) -> AppResult<PathBuf> {
    let temp_path =
        std::env::temp_dir().join(format!("kerminal-container-text-{}.tmp", Uuid::new_v4()));
    fs::write(&temp_path, content.as_bytes())?;
    Ok(temp_path)
}
