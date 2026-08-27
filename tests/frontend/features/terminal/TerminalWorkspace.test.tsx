// @author kongweiguang

import { afterEach, beforeEach, describe } from "vitest";
import {
  cleanupTerminalWorkspaceTestState,
  resetTerminalWorkspaceTestState,
} from "./terminal-workspace/setup";

const { registerPaneAndContentTests } = await import(
  "./terminal-workspace/panes-and-content"
);
const { registerTabAndMenuTests } = await import(
  "./terminal-workspace/tabs-and-menus"
);
const { registerTerminalCreatePanelTests } = await import(
  "./terminal-workspace/terminal-create-panel"
);
const { registerGroupAndSplitTests } = await import(
  "./terminal-workspace/groups-and-splits"
);

describe("TerminalWorkspace", () => {
  afterEach(cleanupTerminalWorkspaceTestState);
  beforeEach(resetTerminalWorkspaceTestState);

  registerPaneAndContentTests();
  registerTerminalCreatePanelTests();
  registerTabAndMenuTests();
  registerGroupAndSplitTests();
});
