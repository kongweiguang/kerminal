// @author kongweiguang
export function conversationSignals(content) {
  const signals = [];
  if (/不是|不对|纠正|更正|我说的是|应该是|不要.*而是/i.test(content)) signals.push('correction');
  if (/说了很多遍|反复|重复|多次|每次都|老是|又出现|之前说过|一直/i.test(content)) signals.push('repeated-feedback');
  if (/agent.*错|总是.*错|容易出错|漏了|没做|瞎.*删|工作流.*问题/i.test(content)) signals.push('agent-error');
  if (/skill|技能|hook|updeng|metrics|沉淀|进化/i.test(content)) signals.push('workflow-feedback');
  return signals;
}

export function redact(value) {
  return String(value)
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[REDACTED_TOKEN]')
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED_TOKEN]')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[REDACTED_TOKEN]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1[REDACTED]@')
    .replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
}
