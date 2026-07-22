import { describe, expect, it } from "vitest";
import {
  renderSnippetTemplate,
  SnippetVariableError,
  type SnippetVariableDefinition,
} from "../../../../src/features/snippets/snippetTemplate";

function variable(
  overrides: Partial<SnippetVariableDefinition> = {},
): SnippetVariableDefinition {
  return {
    kind: "text",
    label: "值",
    name: "value",
    renderStrategy: "shellArg",
    required: true,
    ...overrides,
  };
}

describe("snippetTemplate", () => {
  it("quotes POSIX and PowerShell arguments without breaking out", () => {
    expect(
      renderSnippetTemplate({
        shell: "posix",
        template: "printf %s {{ value }}",
        values: { value: "a'b; $(id)" },
        variables: [variable()],
      }).command,
    ).toBe(`printf %s 'a'"'"'b; $(id)'`);
    expect(
      renderSnippetTemplate({
        shell: "powershell",
        template: "Write-Output {{ value }}",
        values: { value: "a'b; Get-Process" },
        variables: [variable()],
      }).command,
    ).toBe("Write-Output 'a''b; Get-Process'");
  });

  it("accepts validated ports and rejects shell syntax", () => {
    const port = variable({ kind: "port", name: "port", renderStrategy: "validatedRaw" });
    expect(
      renderSnippetTemplate({ shell: "posix", template: "ss -ltn sport = :{{ port }}", values: { port: "443" }, variables: [port] }).command,
    ).toBe("ss -ltn sport = :443");
    expect(() =>
      renderSnippetTemplate({ shell: "posix", template: "echo {{ port }}", values: { port: "443;id" }, variables: [port] }),
    ).toThrow(SnippetVariableError);
  });

  it("validates host, url, enum and service boundaries", () => {
    const cases: Array<[SnippetVariableDefinition, string]> = [
      [variable({ kind: "host" }), "example.com"],
      [variable({ kind: "url" }), "https://example.com/a?q=1"],
      [variable({ kind: "service" }), "nginx.service"],
      [variable({ kind: "enum", suggestions: ["json", "text"] }), "json"],
    ];
    for (const [definition, value] of cases) {
      expect(
        renderSnippetTemplate({ shell: "posix", template: "echo {{ value }}", values: { value }, variables: [definition] }).command,
      ).toContain(value);
    }
  });

  it("rejects undeclared, unused, duplicate and missing variables", () => {
    expect(() => renderSnippetTemplate({ shell: "posix", template: "echo {{ missing }}", values: {}, variables: [] })).toThrow(/undeclared/);
    expect(() => renderSnippetTemplate({ shell: "posix", template: "echo ok", values: {}, variables: [variable()] })).toThrow(/unused/);
    expect(() => renderSnippetTemplate({ shell: "posix", template: "echo {{ value }}", values: {}, variables: [variable()] })).toThrow(/missing/);
    expect(() => renderSnippetTemplate({ shell: "posix", template: "echo {{ value }}", values: { value: "x" }, variables: [variable(), variable()] })).toThrow(/invalid/);
  });

  it("never includes secret values in validation errors", () => {
    const secret = "token-should-not-appear\nnext";
    try {
      renderSnippetTemplate({
        shell: "posix",
        template: "login {{ value }}",
        values: { value: secret },
        variables: [variable({ kind: "secret", sensitive: true })],
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("marks sensitive and legacy raw plans for policy escalation", () => {
    expect(
      renderSnippetTemplate({
        shell: "posix",
        template: "echo {{ value }}",
        values: { value: "secret" },
        variables: [variable({ kind: "raw", sensitive: true, renderStrategy: "literal" })],
      }),
    ).toMatchObject({ containsSensitiveValue: true, legacyRaw: true });
    expect(
      renderSnippetTemplate({
        shell: "posix",
        template: "echo {{ value }}",
        values: { value: "; id" },
        variables: [variable({ kind: "text", renderStrategy: "literal" })],
      }).legacyRaw,
    ).toBe(true);
  });

  it("rejects unsafe validation patterns and oversized values before regex execution", () => {
    expect(() =>
      renderSnippetTemplate({
        shell: "posix",
        template: "echo {{ value }}",
        values: { value: `${"a".repeat(10_000)}!` },
        variables: [variable({ validation: "(a+)+$" })],
      }),
    ).toThrow(SnippetVariableError);
  });

  it("keeps unknown shells to a conservative safe subset", () => {
    expect(
      renderSnippetTemplate({ shell: "unknown", template: "echo {{ value }}", values: { value: "alpha-1" }, variables: [variable()] }).command,
    ).toBe("echo alpha-1");
    expect(() =>
      renderSnippetTemplate({ shell: "unknown", template: "echo {{ value }}", values: { value: "a b" }, variables: [variable()] }),
    ).toThrow(/unsupported-shell/);
  });

  it("property-checks ten thousand hostile variable inputs without secret leakage", () => {
    const secretVariable = variable({
      kind: "secret",
      required: false,
      sensitive: true,
    });
    for (let index = 0; index < 10_000; index += 1) {
      const value = `secret-${index}-${generatedHostileValue(index)}`;
      for (const shell of ["posix", "powershell", "cmd", "unknown"] as const) {
        try {
          const plan = renderSnippetTemplate({
            shell,
            template: "echo {{ value }}",
            values: { value },
            variables: [secretVariable],
          });
          expect(plan.containsSensitiveValue).toBe(Boolean(value));
          if (shell === "posix" || shell === "powershell") {
            expect(plan.command.startsWith("echo '")).toBe(true);
            expect(plan.command.endsWith("'")).toBe(true);
          } else if (shell === "cmd") {
            expect(plan.command.startsWith('echo "')).toBe(true);
            expect(plan.command.endsWith('"')).toBe(true);
            expect(value).not.toMatch(/[&|<>^%!\r\n\0]/u);
          } else {
            expect(value).toMatch(/^[A-Za-z0-9_@%+=:,./-]*$/u);
          }
        } catch (error) {
          expect(String(error)).not.toContain(value);
          expect(error).toBeInstanceOf(SnippetVariableError);
        }
      }
    }
  });
});

function generatedHostileValue(seed: number): string {
  const alphabet = [
    "a", "Z", "0", " ", "'", '"', ";", "&", "|", "<", ">", "^", "%", "!",
    "$", "(", ")", "`", "\\", "/", "-", "_", ".", ":", "@", "中", "文", "\n", "\0",
  ];
  let state = (seed + 1) >>> 0;
  const length = seed % 41;
  let value = "";
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    value += alphabet[state % alphabet.length];
  }
  return value;
}
