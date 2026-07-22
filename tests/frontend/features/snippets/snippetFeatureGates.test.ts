import { describe, expect, it } from "vitest";
import {
  DEFAULT_SNIPPET_FEATURE_GATES,
  SNIPPET_FEATURE_GATES_STORAGE_KEY,
  resolveRuntimeSnippetFeatureGates,
  resolveSnippetFeatureGates,
  snippetV2NavigationEnabled,
} from "../../../../src/features/snippets/snippetFeatureGates";

describe("snippetFeatureGates", () => {
  it("enables both V2 paths by default", () => {
    expect(DEFAULT_SNIPPET_FEATURE_GATES).toEqual({
      snippetCatalogV2: true,
      snippetPanelV2: true,
    });
    expect(resolveSnippetFeatureGates()).toEqual(
      DEFAULT_SNIPPET_FEATURE_GATES,
    );
  });

  it("reads independent internal build overrides", () => {
    expect(
      resolveRuntimeSnippetFeatureGates({
        env: {
          VITE_INTERNAL_SNIPPET_CATALOG_V2: "1",
          VITE_INTERNAL_SNIPPET_PANEL_V2: "false",
        },
        storage: null,
      }),
    ).toEqual({
      snippetCatalogV2: true,
      snippetPanelV2: false,
    });
  });

  it("requires both gates for V2 navigation and keeps either switch as rollback", () => {
    expect(
      snippetV2NavigationEnabled({ snippetCatalogV2: true, snippetPanelV2: true }),
    ).toBe(true);
    expect(
      snippetV2NavigationEnabled({ snippetCatalogV2: false, snippetPanelV2: true }),
    ).toBe(false);
    expect(
      snippetV2NavigationEnabled({ snippetCatalogV2: true, snippetPanelV2: false }),
    ).toBe(false);
  });

  it("lets the internal rollback storage override build defaults", () => {
    const storage = {
      getItem: (key: string) =>
        key === SNIPPET_FEATURE_GATES_STORAGE_KEY
          ? JSON.stringify({ snippetCatalogV2: false, snippetPanelV2: true })
          : null,
    };

    expect(
      resolveRuntimeSnippetFeatureGates({
        env: {
          VITE_INTERNAL_SNIPPET_CATALOG_V2: "true",
          VITE_INTERNAL_SNIPPET_PANEL_V2: "false",
        },
        storage,
      }),
    ).toEqual({
      snippetCatalogV2: false,
      snippetPanelV2: true,
    });
  });

  it("ignores malformed or unknown internal overrides", () => {
    expect(
      resolveRuntimeSnippetFeatureGates({
        env: { VITE_INTERNAL_SNIPPET_CATALOG_V2: "sometimes" },
        storage: { getItem: () => "{broken" },
      }),
    ).toEqual(DEFAULT_SNIPPET_FEATURE_GATES);
  });
});
