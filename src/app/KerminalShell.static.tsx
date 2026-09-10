// @author kongweiguang

import { lazy } from "react";
import type { SettingsSectionId } from "../features/settings/SettingsToolContent";

export const DEFAULT_SETTINGS_SECTION_ID: SettingsSectionId =
  "settings-appearance";
export const DEFAULT_REMOTE_GROUP_NAME = "默认分组";
export const TOOL_RAIL_WIDTH = 44;
export const WORKSPACE_SESSION_SAVE_DELAY_MS = 1_000;

export const LazySettingsDialog = lazy(() =>
  import("../features/settings/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);

export const LazyRemoteHostCreateDialog = lazy(() =>
  import("../features/machine-sidebar/RemoteHostCreateDialog").then(
    (module) => ({
      default: module.RemoteHostCreateDialog,
    }),
  ),
);

export const LazyRemoteHostGroupCreateDialog = lazy(() =>
  import("../features/machine-sidebar/RemoteHostGroupCreateDialog").then(
    (module) => ({
      default: module.RemoteHostGroupCreateDialog,
    }),
  ),
);

export const LazySshAuthPromptHost = lazy(() =>
  import("../features/ssh-auth/SshAuthPromptHost").then((module) => ({
    default: module.SshAuthPromptHost,
  })),
);

export const LazySshHostKeyPromptHost = lazy(() =>
  import("../features/ssh-host-key/SshHostKeyPromptHost").then((module) => ({
    default: module.SshHostKeyPromptHost,
  })),
);

export const LazyExternalLaunchHost = lazy(() =>
  import("../features/external-launch/ExternalLaunchHost").then((module) => ({
    default: module.ExternalLaunchHost,
  })),
);
