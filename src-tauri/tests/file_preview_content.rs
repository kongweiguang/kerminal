//! 文件预览内容分类策略测试。
//!
//! @author kongweiguang

use kerminal_lib::models::file_preview::{
    classify_file_preview_bytes, file_preview_response_encoding, FilePreviewBinaryReason,
    FilePreviewContentKind,
};

#[test]
fn recognizes_known_binary_signatures() {
    let cases: &[(&str, &[u8])] = &[
        ("pdf", b"%PDF-1.7\n1 0 obj"),
        ("png", b"\x89PNG\r\n\x1a\nheader"),
        ("zip", b"PK\x03\x04archive"),
        ("ole", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1payload"),
        ("sqlite", b"SQLite format 3\x00payload"),
        ("webassembly", b"\x00asm\x01\x00\x00\x00"),
        ("riff-wave", b"RIFF\x10\x00\x00\x00WAVEpayload"),
        ("mp4", b"\x00\x00\x00\x18ftypisompayload"),
    ];

    for (name, bytes) in cases {
        assert_eq!(
            classify_file_preview_bytes(bytes),
            FilePreviewContentKind::Binary(FilePreviewBinaryReason::KnownSignature),
            "{name} should be binary"
        );
    }
}

#[test]
fn reports_a_distinct_encoding_for_binary_safety_responses() {
    assert_eq!(file_preview_response_encoding(true), "binary");
    assert_eq!(file_preview_response_encoding(false), "utf-8-lossy");
}

#[test]
fn recognizes_nul_without_requiring_valid_utf8() {
    assert_eq!(
        classify_file_preview_bytes(b"plain prefix\x00plain suffix"),
        FilePreviewContentKind::Binary(FilePreviewBinaryReason::NullByte)
    );
}

#[test]
fn recognizes_dense_disallowed_ascii_controls() {
    assert_eq!(
        classify_file_preview_bytes(b"prefix\x01\x02\x03\x04\x05suffix"),
        FilePreviewContentKind::Binary(FilePreviewBinaryReason::DisallowedControlBytes)
    );
}

#[test]
fn accepts_utf8_chinese_and_common_whitespace() {
    let content = "中文配置\tvalue\r\n下一行\u{000b}\u{000c}emoji: \u{1f680}\n";

    assert_eq!(
        classify_file_preview_bytes(content.as_bytes()),
        FilePreviewContentKind::Text
    );
}

#[test]
fn accepts_lossy_legacy_text_and_sparse_controls() {
    let gbk_like = [
        0xc4, 0xe3, 0xba, 0xc3, b',', b' ', 0xca, 0xc0, 0xbd, 0xe7, b'\r', b'\n',
    ];
    assert_eq!(
        classify_file_preview_bytes(&gbk_like),
        FilePreviewContentKind::Text
    );

    let ansi_log = b"\x1b[31merror\x1b[0m: retry completed after a transient failure\n";
    assert_eq!(
        classify_file_preview_bytes(ansi_log),
        FilePreviewContentKind::Text
    );
}

#[test]
fn does_not_treat_short_plain_magic_fragments_as_executables() {
    assert_eq!(
        classify_file_preview_bytes(b"MZ is also ordinary text without a PE header\n"),
        FilePreviewContentKind::Text
    );
    assert_eq!(
        classify_file_preview_bytes(b"ID3 is a textual identifier, not an audio tag\n"),
        FilePreviewContentKind::Text
    );
}
