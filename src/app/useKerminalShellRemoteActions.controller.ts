// @author kongweiguang

import { useCallback, useRef, useState } from "react";
import type { ConnectionOpenOptions } from "../features/machine-sidebar/MachineSidebar";
import type { LocalTerminalCreateOptions } from "../features/machine-sidebar/RemoteHostCreateDialog";
import { findMachine, localMachineIdForProfile } from "../features/workspace/workspaceStore";
import type { Machine, MachineGroup } from "../features/workspace/types";
import { externalSshLaunchIdFromMachineId } from "../features/external-launch/externalSshLaunchModel";
import { buildUserFacingError, type UserFacingMessage } from "../lib/userFacingMessage";
import {
  duplicateMachineName,
  hasLocalProfileOverrides,
  isRealRemoteGroup,
  mergeProfiles,
  nextPinnedGroupSortOrder,
  nextUnpinnedGroupSortOrder,
  remoteHostCreateRequestFromMachine,
  remoteHostFromMachine,
  remoteHostUpdateRequestFromMachine,
  type PendingDelete,
} from "./KerminalShell.helpers";
import type { ConnectionDialogOptions, UseKerminalShellRemoteActionsParams } from "./useKerminalShellRemoteActions.commands";
import {
  closeExternalSshLaunch, createProfile, createRemoteHost, createRemoteHostGroup,
  deleteRemoteHost, deleteRemoteHostGroup, listProfiles, listRemoteHostTree,
  openSavedRdpConnection, UNGROUPED_REMOTE_HOST_GROUP_ID, updateProfile,
  updateRemoteHost, updateRemoteHostGroup, type RemoteHost,
  type RemoteHostCreateRequest, type RemoteHostGroup,
  type RemoteHostGroupUpdateRequest, type TerminalProfile,
} from "./useKerminalShellRemoteActions.transport";

const DEFAULT_REMOTE_GROUP_NAME = "默认分组";

export function useKerminalShellRemoteActions({
  activeProfileId,
  addLocalProfileMachine,
  addTerminalTab,
  defaultRemoteGroupId,
  machineGroups,
  moveSidebarMachine,
  pinMachineGroup,
  profiles,
  removeSidebarMachine,
  renameMachineGroup,
  selectMachine,
  setProfiles,
  setRemoteHostTree,
  updateLocalMachine,
}: UseKerminalShellRemoteActionsParams) {
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [remoteHostLoadError, setRemoteHostLoadError] = useState<string | null>(null);
  const [remoteHostDialogOpen, setRemoteHostDialogOpen] = useState(false);
  const [remoteHostDefaultGroupId, setRemoteHostDefaultGroupId] = useState<string | undefined>(undefined);
  const [remoteHostDefaultMode, setRemoteHostDefaultMode] = useState<NonNullable<ConnectionOpenOptions["mode"]>>("ssh");
  const [editingRemoteHost, setEditingRemoteHost] = useState<RemoteHost | undefined>(undefined);
  const [editingLocalMachine, setEditingLocalMachine] = useState<Machine | undefined>(undefined);
  const [remoteGroupDialogOpen, setRemoteGroupDialogOpen] = useState(false);
  const [editingRemoteGroup, setEditingRemoteGroup] = useState<MachineGroup | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteError, setDeleteError] = useState<UserFacingMessage | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [rdpOpeningMachineIds, setRdpOpeningMachineIds] = useState<string[]>([]);
  // ref 在 React 重渲染前同步拦截连点，state 只负责驱动界面反馈。
  const rdpOpeningMachineIdsRef = useRef(new Set<string>());

  const refreshRemoteHostTree = useCallback(async () => {
    try {
      const remoteGroups = await listRemoteHostTree();
      setRemoteHostTree(remoteGroups);
      setRemoteHostLoadError(null);
    } catch {
      setRemoteHostLoadError("远程主机加载失败，使用本地列表。");
    }
  }, [setRemoteHostTree]);
  const refreshProfiles = useCallback(async () => {
    const nextProfiles = await listProfiles();
    setProfiles(nextProfiles);
    setProfileLoadError(null);
    return nextProfiles;
  }, [setProfiles]);
  const handleRemoteHostCreated = useCallback(
    async (host: RemoteHost) => {
      await refreshRemoteHostTree();
      selectMachine(host.id);
    },
    [refreshRemoteHostTree, selectMachine],
  );
  const ensureDefaultRemoteGroup = useCallback(async () => {
    const existingGroup = machineGroups.find(
      (group) =>
        isRealRemoteGroup(group) && group.title.trim() === DEFAULT_REMOTE_GROUP_NAME,
    );
    if (existingGroup) {
      return existingGroup.id;
    }

    try {
      const createdGroup = await createRemoteHostGroup({
        name: DEFAULT_REMOTE_GROUP_NAME,
      });
      return createdGroup.id;
    } catch (caught) {
      const remoteGroups = await listRemoteHostTree();
      setRemoteHostTree(remoteGroups);
      const refreshedGroup = remoteGroups.find(
        (group) => group.name.trim() === DEFAULT_REMOTE_GROUP_NAME,
      );
      if (refreshedGroup) {
        return refreshedGroup.id;
      }
      throw caught;
    }
  }, [machineGroups, setRemoteHostTree]);
  const resolveTargetGroupId = useCallback(
    async (groupId: string | undefined) => {
      const requestedGroupId = groupId?.trim();
      if (
        requestedGroupId &&
        requestedGroupId !== UNGROUPED_REMOTE_HOST_GROUP_ID
      ) {
        return requestedGroupId;
      }

      return ensureDefaultRemoteGroup();
    },
    [ensureDefaultRemoteGroup],
  );
  const handleCreateRemoteHost = useCallback(
    async (request: RemoteHostCreateRequest) => {
      const groupId = await resolveTargetGroupId(request.groupId);
      return createRemoteHost({ ...request, groupId });
    },
    [resolveTargetGroupId],
  );
  const handleCreateLocalProfile = useCallback(
    async (options?: LocalTerminalCreateOptions) => {
      const groupId = await resolveTargetGroupId(options?.groupId);
      if (!options) {
        addTerminalTab({ groupId });
        return;
      }
      if (!hasLocalProfileOverrides(options)) {
        addTerminalTab({ groupId });
        return;
      }

      const baseProfile =
        profiles.find((profile) => profile.id === activeProfileId) ??
        profiles.find((profile) => profile.isDefault) ??
        profiles[0];
      const shell = options.shell?.trim() || baseProfile?.shell;
      if (!shell) {
        addTerminalTab({ ...options, groupId });
        return;
      }

      const createdProfile = await createProfile({
        args: options.args ?? baseProfile?.args ?? [],
        cwd: options.cwd ?? baseProfile?.cwd,
        env: options.env ?? baseProfile?.env ?? {},
        name: options.title?.trim() || baseProfile?.name || "本地会话",
        sidebarGroupId: groupId,
        shell,
        setDefault: false,
      });
      let nextProfiles: TerminalProfile[];
      try {
        nextProfiles = await refreshProfiles();
        if (!nextProfiles.some((profile) => profile.id === createdProfile.id)) {
          nextProfiles = mergeProfiles(nextProfiles, createdProfile);
          setProfiles(nextProfiles);
        }
      } catch {
        setProfileLoadError("终端配置刷新失败，已显示新配置。");
        nextProfiles = mergeProfiles(profiles, createdProfile);
        setProfiles(nextProfiles);
      }
      const savedProfile =
        nextProfiles.find((profile) => profile.id === createdProfile.id) ??
        createdProfile;
      addLocalProfileMachine(savedProfile, groupId);
      selectMachine(localMachineIdForProfile(savedProfile.id));
    },
    [
      activeProfileId,
      addLocalProfileMachine,
      addTerminalTab,
      profiles,
      refreshProfiles,
      resolveTargetGroupId,
      selectMachine,
      setProfiles,
    ],
  );
  const handleUpdateLocalProfile = useCallback(
    async (machineId: string, options: LocalTerminalCreateOptions) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine || machine.kind !== "local") {
        setProfileLoadError("只能编辑已同步的本地终端配置。");
        return;
      }

      const groupId = await resolveTargetGroupId(
        options.groupId ?? machine.remoteGroupId,
      );
      const title = options.title?.trim() || machine.name || "本地会话";
      const shell = options.shell?.trim();
      const nextOptions: LocalTerminalCreateOptions = {
        args: options.args ?? [],
        cwd: options.cwd,
        env: options.env ?? {},
        groupId,
        shell,
        title,
      };

      if (machine.profileId) {
        const profile = profiles.find(
          (candidate) => candidate.id === machine.profileId,
        );
        const profileShell = shell || profile?.shell || machine.shell;
        if (!profileShell) {
          setProfileLoadError("本地终端缺少 Shell，无法保存。");
          return;
        }

        const updatedProfile = await updateProfile({
          args: nextOptions.args,
          cwd: nextOptions.cwd,
          env: nextOptions.env,
          id: machine.profileId,
          name: title,
          setDefault: profile?.isDefault ?? false,
          sidebarGroupId: groupId,
          shell: profileShell,
          sortOrder: profile?.sortOrder ?? machine.sortOrder ?? 0,
        });
        let nextProfiles: TerminalProfile[];
        try {
          nextProfiles = mergeProfiles(await refreshProfiles(), updatedProfile);
          setProfiles(nextProfiles);
        } catch {
          setProfileLoadError("终端配置刷新失败，已显示更新。");
          nextProfiles = mergeProfiles(profiles, updatedProfile);
          setProfiles(nextProfiles);
        }

        updateLocalMachine(machine.id, {
          args: updatedProfile.args,
          cwd: updatedProfile.cwd,
          env: updatedProfile.env,
          groupId,
          shell: updatedProfile.shell,
          title: updatedProfile.name,
        });
        selectMachine(machine.id);
        return;
      }

      updateLocalMachine(machine.id, nextOptions);
      selectMachine(machine.id);
    },
    [
      machineGroups,
      profiles,
      refreshProfiles,
      resolveTargetGroupId,
      selectMachine,
      setProfiles,
      updateLocalMachine,
    ],
  );
  const handleMoveMachineToGroup = useCallback(
    async (machineId: string, targetGroupId: string) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine) {
        setRemoteHostLoadError("主机不存在，无法移动。");
        return;
      }
      if (machine.remoteGroupId === targetGroupId) {
        return;
      }

      if (machine.kind === "local") {
        const groupId = await resolveTargetGroupId(targetGroupId);
        if (machine.profileId) {
          const profile = profiles.find(
            (candidate) => candidate.id === machine.profileId,
          );
          const shell = machine.shell ?? profile?.shell;
          if (!shell) {
            setProfileLoadError("本地终端缺少 Shell，无法移动。");
            return;
          }

          let updatedProfile: TerminalProfile;
          try {
            updatedProfile = await updateProfile({
              args: machine.args ?? profile?.args ?? [],
              cwd: machine.cwd ?? profile?.cwd,
              env: machine.env ?? profile?.env ?? {},
              id: machine.profileId,
              name: machine.name,
              setDefault: profile?.isDefault ?? false,
              sidebarGroupId: groupId,
              shell,
              sortOrder: profile?.sortOrder ?? machine.sortOrder ?? 0,
            });
          } catch (caught) {
            console.warn("Kerminal local terminal group save failed", caught);
            setProfileLoadError("本地终端分组未保存，请稍后重试。");
            return;
          }
          try {
            const nextProfiles = mergeProfiles(
              await refreshProfiles(),
              updatedProfile,
            );
            setProfiles(nextProfiles);
          } catch {
            setProfileLoadError("终端配置刷新失败，已保存分组位置。");
            setProfiles(mergeProfiles(profiles, updatedProfile));
          }
        }

        moveSidebarMachine(machine.id, groupId);
        selectMachine(machine.id);
        return;
      }
      if (machine.kind === "dockerContainer") {
        moveSidebarMachine(machine.id, targetGroupId);
        selectMachine(machine.id);
        return;
      }

      if (
        machine.kind !== "ssh" &&
        machine.kind !== "sftp" &&
        machine.kind !== "rdp"
      ) {
        setRemoteHostLoadError("只能移动本地、容器、SSH、SFTP 或 RDP 连接。");
        return;
      }

      const groupId = await resolveTargetGroupId(targetGroupId);
      const request = remoteHostUpdateRequestFromMachine(machine, groupId);
      if (!request) {
        setRemoteHostLoadError("主机配置不完整，无法移动。");
        return;
      }

      await updateRemoteHost(request);
      await refreshRemoteHostTree();
      selectMachine(machine.id);
    },
    [
      machineGroups,
      moveSidebarMachine,
      profiles,
      refreshProfiles,
      refreshRemoteHostTree,
      resolveTargetGroupId,
      selectMachine,
      setProfiles,
    ],
  );
  const handleDuplicateMachine = useCallback(
    async (machineId: string) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine) {
        setRemoteHostLoadError("主机不存在，无法复制。");
        return;
      }
      const groupId = await resolveTargetGroupId(machine.remoteGroupId);
      const name = duplicateMachineName(machine.name);

      if (machine.kind === "local") {
        const profile = machine.profileId
          ? profiles.find((candidate) => candidate.id === machine.profileId)
          : undefined;
        const shell = machine.shell ?? profile?.shell;
        if (!shell) {
          setProfileLoadError("本地终端缺少 Shell，无法复制。");
          return;
        }

        const createdProfile = await createProfile({
          args: machine.args ?? profile?.args ?? [],
          cwd: machine.cwd ?? profile?.cwd,
          env: machine.env ?? profile?.env ?? {},
          name,
          sidebarGroupId: groupId,
          setDefault: false,
          shell,
        });
        let nextProfiles: TerminalProfile[];
        try {
          nextProfiles = mergeProfiles(await refreshProfiles(), createdProfile);
          setProfiles(nextProfiles);
        } catch {
          setProfileLoadError("终端配置刷新失败，已显示副本。");
          nextProfiles = mergeProfiles(profiles, createdProfile);
          setProfiles(nextProfiles);
        }
        const savedProfile =
          nextProfiles.find((profile) => profile.id === createdProfile.id) ??
          createdProfile;
        addLocalProfileMachine(savedProfile, groupId);
        selectMachine(localMachineIdForProfile(savedProfile.id));
        return;
      }

      if (
        machine.kind !== "ssh" &&
        machine.kind !== "sftp" &&
        machine.kind !== "rdp"
      ) {
        setRemoteHostLoadError("容器卡片暂不支持复制。");
        return;
      }

      const request = remoteHostCreateRequestFromMachine(machine, {
        groupId,
        name,
      });
      if (!request) {
        setRemoteHostLoadError("主机配置不完整，无法复制。");
        return;
      }
      if (machine.kind === "sftp") {
        request.protocol = "ssh";
      }

      const createdHost = await createRemoteHost(request);
      await refreshRemoteHostTree();
      selectMachine(createdHost.id);
    },
    [
      addLocalProfileMachine,
      machineGroups,
      profiles,
      refreshProfiles,
      refreshRemoteHostTree,
      resolveTargetGroupId,
      selectMachine,
      setProfiles,
    ],
  );
  const handlePinMachineGroup = useCallback(
    async (groupId: string, pinned = true) => {
      const group = machineGroups.find((candidate) => candidate.id === groupId);
      if (!group) {
        setRemoteHostLoadError("分组不存在，无法更新置顶状态。");
        return;
      }
      const nextSortOrder = pinned
        ? nextPinnedGroupSortOrder(machineGroups)
        : nextUnpinnedGroupSortOrder(machineGroups, group.id);

      if (group.id === UNGROUPED_REMOTE_HOST_GROUP_ID) {
        pinMachineGroup(group.id, pinned);
        return;
      }

      await updateRemoteHostGroup({
        id: group.id,
        name: group.title,
        sortOrder: nextSortOrder,
      });
      await refreshRemoteHostTree();
    },
    [machineGroups, pinMachineGroup, refreshRemoteHostTree],
  );
  const handleRemoteGroupSaved = useCallback(
    async (group: RemoteHostGroup) => {
      if (group.id !== UNGROUPED_REMOTE_HOST_GROUP_ID) {
        await refreshRemoteHostTree();
      }
    },
    [refreshRemoteHostTree],
  );
  const handleRemoteGroupUpdate = useCallback(
    async (request: RemoteHostGroupUpdateRequest) => {
      const name = request.name.trim();
      if (request.id === UNGROUPED_REMOTE_HOST_GROUP_ID) {
        renameMachineGroup(request.id, name);
        return {
          createdAt: "",
          id: request.id,
          name,
          sortOrder: request.sortOrder,
          updatedAt: "",
        };
      }

      return updateRemoteHostGroup(request);
    },
    [renameMachineGroup],
  );
  const openConnectionDialog = useCallback(
    (options?: ConnectionDialogOptions) => {
      const nextEditingMachine = options?.hostId
        ? findMachine(machineGroups, options.hostId)
        : undefined;
      const nextEditingLocalMachine =
        nextEditingMachine?.kind === "local" ? nextEditingMachine : undefined;
      const nextEditingHost = options?.hostId
        ? remoteHostFromMachine(nextEditingMachine)
        : undefined;
      const nextEditingMode =
        nextEditingMachine?.kind === "rdp"
          ? "rdp"
          : nextEditingMachine?.kind === "sftp"
            ? "sftp"
          : nextEditingMachine?.kind === "telnet"
            ? "telnet"
            : nextEditingMachine?.kind === "serial"
              ? "serial"
            : "ssh";

      if (options?.hostId && !nextEditingHost && !nextEditingLocalMachine) {
        setRemoteHostLoadError("只能编辑已同步的连接配置。");
        return;
      }

      setEditingRemoteHost(nextEditingHost);
      setEditingLocalMachine(nextEditingLocalMachine);
      setRemoteHostDefaultGroupId(
        nextEditingLocalMachine?.remoteGroupId ??
          nextEditingHost?.groupId ??
          options?.groupId ??
          defaultRemoteGroupId,
      );
      setRemoteHostDefaultMode(
        nextEditingLocalMachine
          ? "local"
          : nextEditingHost
            ? nextEditingMode
            : options?.mode ?? "ssh",
      );
      setRemoteHostDialogOpen(true);
    },
    [defaultRemoteGroupId, machineGroups],
  );
  const closeConnectionDialog = useCallback(() => {
    setRemoteHostDialogOpen(false);
    setEditingRemoteHost(undefined);
    setEditingLocalMachine(undefined);
  }, []);
  const openRemoteGroupDialog = useCallback(
    (groupId?: string) => {
      if (!groupId) {
        setEditingRemoteGroup(undefined);
        setRemoteGroupDialogOpen(true);
        return;
      }

      const group = machineGroups.find((candidate) => candidate.id === groupId);
      if (!group) {
        setRemoteHostLoadError("分组不存在，无法重命名。");
        return;
      }
      setEditingRemoteGroup(group);
      setRemoteGroupDialogOpen(true);
    },
    [machineGroups],
  );
  const closeRemoteGroupDialog = useCallback(() => {
    setRemoteGroupDialogOpen(false);
    setEditingRemoteGroup(undefined);
  }, []);
  const requestDeleteGroup = useCallback(
    (groupId: string) => {
      const group = machineGroups.find((candidate) => candidate.id === groupId);
      if (!group) {
        setRemoteHostLoadError("分组不存在，无法删除。");
        return;
      }
      setDeleteError(null);
      setPendingDelete({
        id: group.id,
        machineCount: group.machines.length,
        title: group.title,
        type: "group",
      });
    },
    [machineGroups],
  );
  const requestDeleteMachine = useCallback(
    async (machineId: string) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine) {
        setRemoteHostLoadError("只能删除已保存的连接配置。");
        return;
      }
      if (machine.kind === "local") {
        if (machine.profileId) {
          const profile = profiles.find(
            (candidate) => candidate.id === machine.profileId,
          );
          const shell = machine.shell ?? profile?.shell;
          if (!shell) {
            setProfileLoadError("本地终端缺少 Shell，无法移除。");
            return;
          }
          let updatedProfile: TerminalProfile;
          try {
            updatedProfile = await updateProfile({
              args: machine.args ?? profile?.args ?? [],
              cwd: machine.cwd ?? profile?.cwd,
              env: machine.env ?? profile?.env ?? {},
              id: machine.profileId,
              name: machine.name,
              setDefault: profile?.isDefault ?? false,
              sidebarGroupId: "",
              shell,
              sortOrder: profile?.sortOrder ?? machine.sortOrder ?? 0,
            });
          } catch (caught) {
            console.warn("Kerminal local terminal sidebar removal failed", caught);
            setProfileLoadError("本地终端未从侧栏移除，请稍后重试。");
            return;
          }
          try {
            const nextProfiles = mergeProfiles(
              await refreshProfiles(),
              updatedProfile,
            );
            setProfiles(nextProfiles);
          } catch {
            setProfileLoadError("终端配置刷新失败，已移除侧栏位置。");
            setProfiles(mergeProfiles(profiles, updatedProfile));
          }
        }
        removeSidebarMachine(machine.id);
        return;
      }
      if (machine.kind === "dockerContainer") {
        removeSidebarMachine(machine.id);
        return;
      }
      if (
        machine.kind !== "ssh" &&
        machine.kind !== "sftp" &&
        machine.kind !== "rdp" &&
        machine.kind !== "telnet" &&
        machine.kind !== "serial"
      ) {
        setRemoteHostLoadError("只能删除已保存的连接配置。");
        return;
      }
      setDeleteError(null);
      setPendingDelete({
        id: machine.id,
        title: machine.name,
        type: "machine",
      });
    },
    [machineGroups, profiles, refreshProfiles, removeSidebarMachine, setProfiles],
  );
  const openSavedRdpMachine = useCallback(
    async (machineId: string) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine || machine.kind !== "rdp") {
        setRemoteHostLoadError("只能打开已保存的 RDP 连接配置。");
        return;
      }
      if (rdpOpeningMachineIdsRef.current.has(machine.id)) {
        return;
      }

      rdpOpeningMachineIdsRef.current.add(machine.id);
      setRdpOpeningMachineIds((current) =>
        current.includes(machine.id) ? current : [...current, machine.id],
      );
      setRemoteHostLoadError(null);
      try {
        await openSavedRdpConnection(machine.id);
      } catch (caught) {
        console.warn("Kerminal saved RDP launch failed", caught);
        setRemoteHostLoadError(
          "RDP 连接未打开，请检查主机地址和系统远程桌面设置后重试。",
        );
      } finally {
        rdpOpeningMachineIdsRef.current.delete(machine.id);
        setRdpOpeningMachineIds((current) =>
          current.filter((id) => id !== machine.id),
        );
      }
    },
    [machineGroups],
  );
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }

    setDeleteSaving(true);
    setDeleteError(null);
    try {
      if (pendingDelete.type === "group") {
        if (pendingDelete.id === UNGROUPED_REMOTE_HOST_GROUP_ID) {
          const groupId = await ensureDefaultRemoteGroup();
          const group = machineGroups.find(
            (candidate) => candidate.id === pendingDelete.id,
          );
          const hosts = group?.machines
            .map(remoteHostFromMachine)
            .filter((host): host is RemoteHost => Boolean(host)) ?? [];
          await Promise.all(
            hosts.map((host) =>
              updateRemoteHost({
                ...host,
                groupId,
              }),
            ),
          );
        } else {
          await deleteRemoteHostGroup(pendingDelete.id);
        }
      } else {
        const externalLaunchId = externalSshLaunchIdFromMachineId(
          pendingDelete.id,
        );
        if (externalLaunchId) {
          await closeExternalSshLaunch(externalLaunchId);
          removeSidebarMachine(pendingDelete.id);
          setPendingDelete(null);
          return;
        } else {
          await deleteRemoteHost(pendingDelete.id);
        }
      }
      await refreshRemoteHostTree();
      setPendingDelete(null);
    } catch (caught) {
      setDeleteError(
        buildUserFacingError(caught, {
          detail: "本地保存的配置没有被删除。",
          recoveryAction: "请检查配置目录权限后重试。",
          title:
            pendingDelete.type === "group" ? "分组未删除" : "连接未删除",
        }),
      );
    } finally {
      setDeleteSaving(false);
    }
  }, [
    ensureDefaultRemoteGroup,
    machineGroups,
    pendingDelete,
    refreshRemoteHostTree,
    removeSidebarMachine,
  ]);

  return {
    closeConnectionDialog,
    closeRemoteGroupDialog,
    confirmDelete,
    deleteError,
    deleteSaving,
    editingLocalMachine,
    editingRemoteGroup,
    editingRemoteHost,
    handleCreateLocalProfile,
    handleCreateRemoteHost,
    handleDuplicateMachine,
    handleMoveMachineToGroup,
    handlePinMachineGroup,
    handleRemoteGroupSaved,
    handleRemoteGroupUpdate,
    handleRemoteHostCreated,
    handleUpdateLocalProfile,
    openConnectionDialog,
    openRemoteGroupDialog,
    openSavedRdpMachine,
    pendingDelete,
    profileLoadError,
    refreshProfiles,
    refreshRemoteHostTree,
    rdpOpeningMachineIds,
    remoteGroupDialogOpen,
    remoteHostDefaultGroupId,
    remoteHostDefaultMode,
    remoteHostDialogOpen,
    remoteHostLoadError,
    requestDeleteGroup,
    requestDeleteMachine,
    resolveTargetGroupId,
    setDeleteError,
    setPendingDelete,
    setProfileLoadError,
  };
}
