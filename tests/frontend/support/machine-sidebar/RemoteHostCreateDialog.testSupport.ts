// @author kongweiguang

import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import {
  createDefaultSshOptions,
  type RemoteHost,
} from "../../../../src/lib/remoteHostApi";
import type { MachineGroup } from "../../../../src/features/workspace/types";

export const groups: MachineGroup[] = [
  {
    id: "local",
    machines: [],
    title: "本地",
  },
  {
    id: "group-dev",
    machines: [],
    title: "开发主机",
  },
];

export const createdHost: RemoteHost = {
  authType: "key",
  createdAt: "now",
  credentialRef: "/home/ubuntu/.ssh/id_ed25519",
  groupId: "group-dev",
  host: "172.16.41.60",
  id: "host-1",
  name: "ubuntu-dev",
  port: 22,
  protocol: "ssh",
  sshOptions: createDefaultSshOptions(),
  sortOrder: 10,
  tags: ["ssh", "ubuntu"],
  updatedAt: "now",
  username: "ubuntu",
};

export const groupsWithSsh: MachineGroup[] = [
  groups[0],
  {
    id: "group-dev",
    machines: [
      {
        authType: "key",
        credentialRef: "/home/ubuntu/.ssh/id_ed25519",
        description: "ubuntu@172.16.41.60:22",
        host: "172.16.41.60",
        id: "host-1",
        kind: "ssh",
        name: "ubuntu-dev",
        port: 22,
        remoteGroupId: "group-dev",
        status: "offline",
        target: { hostId: "host-1", kind: "ssh" },
        tags: ["ssh", "ubuntu"],
        username: "ubuntu",
      },
      {
        authType: "agent",
        description: "root@10.0.0.8:22",
        host: "10.0.0.8",
        id: "host-2",
        kind: "ssh",
        name: "db-prod",
        port: 22,
        remoteGroupId: "group-dev",
        status: "warning",
        target: { hostId: "host-2", kind: "ssh" },
        tags: ["ssh", "prod"],
        username: "root",
      },
    ],
    title: "开发主机",
  },
];

export async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: new RegExp(`^${optionName}`) }));
}
