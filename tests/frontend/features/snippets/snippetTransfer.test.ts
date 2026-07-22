import { describe, expect, it } from "vitest";
import {
  dryRunSnippetImport,
  serializeSnippetExport,
} from "../../../../src/features/snippets/snippetTransfer";

describe("snippetTransfer", () => {
  it("round trips file metadata without runtime preferences", () => {
    const source = serializeSnippetExport([
      {
        category: "network",
        command: "curl {{ url }}",
        contextBindings: [{ kind: "global" }],
        createdAt: "1",
        defaultAction: "insert",
        description: "请求 URL",
        id: "sample",
        risk: "inspect",
        scope: "any",
        sortOrder: 1,
        tags: ["http"],
        title: "HTTP",
        updatedAt: "1",
        variables: [
          {
            description: "",
            kind: "url",
            label: "URL",
            name: "url",
            renderStrategy: "shellArg",
            required: true,
            sensitive: false,
            suggestions: [],
          },
        ],
      },
    ]);

    expect(source).not.toContain("favorite");
    expect(source).not.toContain("useCount");
    expect(dryRunSnippetImport(source)).toMatchObject({
      candidates: [expect.objectContaining({ category: "network", title: "HTTP" })],
      errors: [],
    });
  });

  it("rejects invalid versions and literal secrets without returning values", () => {
    expect(dryRunSnippetImport('{"schemaVersion":2,"snippets":[]}').errors).toHaveLength(1);
    const result = dryRunSnippetImport(
      JSON.stringify({
        schemaVersion: 1,
        snippets: [
          {
            command: "password=super-secret",
            defaultAction: "insert",
            risk: "change",
            scope: "any",
            title: "bad",
          },
        ],
      }),
    );
    expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("rejects sensitive defaults regardless of variable kind", () => {
    const result = dryRunSnippetImport(
      JSON.stringify({
        schemaVersion: 1,
        snippets: [{
          command: "echo {{ value }}",
          contextBindings: [],
          defaultAction: "insert",
          risk: "inspect",
          scope: "any",
          title: "sensitive default",
          variables: [{
            defaultValue: "must-not-persist",
            description: "",
            kind: "text",
            label: "Value",
            name: "value",
            renderStrategy: "shellArg",
            required: true,
            sensitive: true,
            suggestions: [],
          }],
        }],
      }),
    );
    expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("must-not-persist");
  });

});
