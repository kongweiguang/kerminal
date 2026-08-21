// @author kongweiguang

import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultAppSettings } from "../../../../../src/features/settings/settingsModel";
import { mocks } from "../../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane } from "../../../../../src/features/terminal/XtermPane";

describe("XtermPane web links", () => {
  /** 真实 runtime 必须把 Kerminal URL provider 注册进每个 xterm 实例。 */
  it("registers one URL link provider for the terminal lifecycle", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-web-links"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="Web links"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].registerLinkProvider).toHaveBeenCalledTimes(
      1,
    );
  });
});
