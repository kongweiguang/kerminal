import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SnippetEditorDialogV2 } from "../../../../src/features/snippets/SnippetEditorDialogV2";

const initial = {
  category: "custom",
  command: "echo ok",
  contextBindings: [{ kind: "global" as const }],
  defaultAction: "insert" as const,
  description: "",
  risk: "change" as const,
  scope: "any" as const,
  sortOrder: 10,
  tags: [],
  title: "示例",
  variables: [],
};

describe("SnippetEditorDialogV2", () => {
  it("derives typed variables from placeholders and submits metadata", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SnippetEditorDialogV2
        initial={initial}
        onClose={vi.fn()}
        onSave={onSave}
        open
        saving={false}
        title="编辑命令片段"
      />,
    );

    fireEvent.change(screen.getByLabelText("命令模板"), {
      target: { value: "curl -H 'Authorization: Bearer {{ token }}' {{ url }}" },
    });
    expect(screen.getByText("token 显示名")).toBeInTheDocument();
    expect(screen.getByText("url 显示名")).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText("类型")[0], {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByLabelText("排序"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("上下文绑定"), {
      target: { value: "host" },
    });
    fireEvent.change(screen.getByLabelText("绑定目标 ID"), {
      target: { value: "prod-api" },
    });
    fireEvent.change(screen.getAllByLabelText("建议值")[1], {
      target: { value: "https://example.com, https://status.example.com" },
    });
    fireEvent.click(screen.getAllByLabelText("必填")[1]);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      category: "custom",
      defaultAction: "insert",
      contextBindings: [{ kind: "host", targetId: "prod-api" }],
      risk: "change",
      sortOrder: 42,
      variables: [
        expect.objectContaining({ kind: "secret", name: "token", sensitive: true }),
        expect.objectContaining({
          kind: "text",
          name: "url",
          required: false,
          suggestions: ["https://example.com", "https://status.example.com"],
        }),
      ],
    });
  });

  it("blocks a literal secret before calling storage", async () => {
    const onSave = vi.fn();
    render(
      <SnippetEditorDialogV2
        initial={{ ...initial, command: "password=super-secret" }}
        onClose={vi.fn()}
        onSave={onSave}
        open
        saving={false}
        title="编辑命令片段"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("疑似明文凭据");
    expect(onSave).not.toHaveBeenCalled();
  });
});
