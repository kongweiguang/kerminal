#!/usr/bin/env python3
# @author kongweiguang
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Audit Apple-inspired UI implementation details."""

from __future__ import annotations

import re
import sys
from pathlib import Path

for _stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

EXTENSIONS = {".css", ".scss", ".sass", ".less", ".html", ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte"}
CHECKS = [
    ("neon-or-glow", "warn", re.compile(r"\b(neon|cyberpunk|glow-\w+|drop-shadow-\[0_0|shadow-\[[^\]]*0_0|text-shadow)\b", re.I), "Avoid neon/glow/cyberpunk styling in Apple-inspired UI unless explicitly required."),
    ("heavy-gradient", "info", re.compile(r"\b(bg-gradient-to|linear-gradient|radial-gradient)\b", re.I), "Review gradients. Subtle glass highlights are acceptable; large decorative gradients usually are not."),
    ("raw-white-black", "info", re.compile(r"\b(bg-white|bg-black|text-white|text-black|border-white|border-black|#[Ff]{6}|#000(?:000)?\b|white\b|black\b)"), "Prefer semantic theme tokens over raw white/black values for production theming."),
    ("strong-shadow", "warn", re.compile(r"\b(shadow-2xl|shadow-\[[^\]]*(?:0_25|0_30|0_40|0_50)|box-shadow:\s*[^;]*(?:40px|50px|60px|80px))\b", re.I), "Check heavy shadows. Apple-inspired depth should be soft, layered, and purposeful."),
    ("negative-letter-spacing", "error", re.compile(r"(letter-spacing\s*:\s*-\d|tracking-\[-|-\[.*letter-spacing)", re.I), "Avoid negative letter spacing for ordinary app UI."),
    ("viewport-font-size", "warn", re.compile(r"font-size\s*:\s*(?:clamp\([^;]*(?:vw|dvw|svw|lvw)|[0-9.]+(?:vw|dvw|svw|lvw))", re.I), "Do not scale app UI font size directly with viewport width."),
    ("backdrop-filter", "info", re.compile(r"backdrop-filter|-webkit-backdrop-filter|backdrop-blur", re.I), "Backdrop filters need readable fill, border, fallback, reduced transparency, and performance review."),
]
SKIP_DIRS = {"node_modules", ".git", "dist", "build"}
SEVERITY_RANK = {"error": 0, "warn": 1, "info": 2}


def collect_files(target: Path, output: list[Path]) -> None:
    if not target.exists():
        print(f"Path not found: {target}", file=sys.stderr)
        raise SystemExit(2)
    if target.is_file():
        if target.suffix in EXTENSIONS:
            output.append(target)
        return
    if not target.is_dir():
        return
    for entry in sorted(target.iterdir(), key=lambda item: item.name):
        if entry.name in SKIP_DIRS:
            continue
        collect_files(entry, output)


def read_text(file_path: Path) -> str:
    return file_path.read_text(encoding="utf-8", errors="replace")


def has_reduced_transparency(scanned_files: list[Path]) -> bool:
    return any(re.search(r"reduced-transparency|prefers-contrast|@supports\s+not\s+\(\(?backdrop-filter", read_text(file_path), re.I) for file_path in scanned_files)


def print_report(findings: list[dict], count: int) -> None:
    print(f"Apple UI audit scanned {count} file(s).")
    if not findings:
        print("No issues found.")
        return
    findings.sort(key=lambda item: (SEVERITY_RANK[item["severity"]], item["file"], item["line"]))
    for finding in findings:
        location = f"{finding['file']}:{finding['line']}" if finding["line"] > 0 else finding["file"]
        print(f"[{finding['severity']}] {finding['id']} {location}")
        print(f"  {finding['message']}")
        if finding["sample"]:
            print(f"  {finding['sample']}")


def main(argv: list[str]) -> int:
    usage = "Usage: uv run --managed-python --python 3.12 --script apple_ui_audit.py [--strict] <file-or-directory>..."
    if "--help" in argv or "-h" in argv:
        print(usage)
        return 0
    strict = "--strict" in argv
    roots = [arg for arg in argv if arg != "--strict"]
    if not roots:
        print(usage, file=sys.stderr)
        return 2

    files: list[Path] = []
    for root in roots:
        collect_files(Path(root).resolve(), files)

    findings: list[dict] = []
    files_with_backdrop = 0
    files_with_reduced_motion = 0
    files_with_focus_visible = 0
    files_with_tokens = 0

    for file_path in files:
        text = read_text(file_path)
        if re.search(r"backdrop-filter|-webkit-backdrop-filter|backdrop-blur", text, re.I):
            files_with_backdrop += 1
        if re.search(r"prefers-reduced-motion", text, re.I):
            files_with_reduced_motion += 1
        if re.search(r"focus-visible", text, re.I):
            files_with_focus_visible += 1
        if re.search(r"--(?:surface|text|border|accent|glass)-|var\(--(?:surface|text|border|accent|glass)-", text, re.I):
            files_with_tokens += 1
        for line_number, line in enumerate(text.splitlines(), start=1):
            for check_id, severity, pattern, message in CHECKS:
                if pattern.search(line):
                    findings.append({"file": str(file_path), "line": line_number, "id": check_id, "severity": severity, "message": message, "sample": line.strip()[:180]})

    if files_with_backdrop > 0 and files_with_reduced_motion == 0:
        findings.append({"file": "(scanned set)", "line": 0, "id": "missing-reduced-motion", "severity": "error", "message": "Backdrop/glass styling was found, but no prefers-reduced-motion handling was found in the scanned files.", "sample": ""})
    if files_with_backdrop > 0 and not has_reduced_transparency(files):
        findings.append({"file": "(scanned set)", "line": 0, "id": "missing-reduced-transparency", "severity": "warn", "message": "Backdrop/glass styling was found, but no reduced-transparency or @supports fallback was detected.", "sample": ""})
    if files_with_focus_visible == 0:
        findings.append({"file": "(scanned set)", "line": 0, "id": "missing-focus-visible", "severity": "warn", "message": "No focus-visible styling was found in the scanned files.", "sample": ""})
    if files_with_tokens == 0:
        findings.append({"file": "(scanned set)", "line": 0, "id": "missing-semantic-tokens", "severity": "warn", "message": "No Apple-style semantic surface/text/border/accent tokens were detected.", "sample": ""})

    print_report(findings, len(files))
    has_errors = any(item["severity"] == "error" for item in findings)
    has_warnings = any(item["severity"] == "warn" for item in findings)
    return 1 if has_errors or (strict and has_warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
