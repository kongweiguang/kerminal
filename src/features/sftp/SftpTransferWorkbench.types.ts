// @author kongweiguang

import type {
  DesktopNotificationSettings,
  InterfaceDensity,
} from "../settings/contracts/index";
import type { MachineGroup } from "../workspace/contracts/index";
import type { OpenWorkspaceFileTabOptions } from "../workspace/state/index";
import type { SftpTransferHostSide } from "./sftpTransferWorkbenchModel";

export interface SftpTransferWorkbenchProps {
  active?: boolean;
  createdHostTarget?: SftpTransferCreatedHostTarget;
  desktopNotifications?: DesktopNotificationSettings;
  groups: MachineGroup[];
  initialRightHostId?: string;
  initialRightPath?: string;
  initialRightSelection?: string;
  externalLaunchId?: string;
  interfaceDensity?: InterfaceDensity;
  lockedLeftHostId?: string;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  onOpenWorkspaceFileTab?: (options: OpenWorkspaceFileTabOptions) => void;
  workspaceTabId?: string;
}

export interface SftpTransferCreateHostRequest {
  side: SftpTransferHostSide;
  workspaceTabId?: string;
}

export interface SftpTransferCreatedHostTarget {
  hostId: string;
  sequence: number;
  side: SftpTransferHostSide;
  workspaceTabId?: string;
}
