// @author kongweiguang

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type {
  SettingsSaveState,
} from "../features/settings/SettingsToolContent";
import type { AppSettings } from "../features/settings/settingsModel";
import type { MachineGroup } from "../features/workspace/types";
import { getSettings } from "../features/settings/settingsApi";
import type { listProfiles } from "../lib/profileApi";
import { listSnippets } from "../lib/snippetApi";
import { listWorkflows } from "../lib/workflowApi";
import {
  configChangeNoticeSnapshot,
  type ConfigChangeNoticeSnapshot,
  type ConfigChangePublicItem,
} from "./configChangeNoticeModel";
import {
  createConfigRefreshCoordinator,
  type ConfigChangeNotice,
} from "./configRefreshCoordinator";
import { shouldKeepSettingsEditorDraft } from "./configDirtyGuardModel";

function configHostNoticeItems(groups: MachineGroup[]): ConfigChangePublicItem[] {
  return groups.flatMap((group) =>
    group.machines
      .filter((machine) =>
        ["ssh", "sftp", "rdp", "telnet", "serial"].includes(machine.kind),
      )
      .map((machine) => ({
        id: machine.id,
        label: machine.name,
        revision: [
          machine.updatedAt ?? "",
          machine.remoteGroupId ?? group.id,
          machine.host ?? "",
          machine.port ?? "",
          machine.tags.join(","),
        ].join("|"),
      })),
  );
}

function configProfileNoticeItems(
  profiles: Awaited<ReturnType<typeof listProfiles>>,
): ConfigChangePublicItem[] {
  return profiles.map((profile) => ({
    id: profile.id,
    label: profile.name,
    revision: [
      profile.updatedAt,
      profile.sidebarGroupId ?? "",
      profile.shell,
      profile.args.join(" "),
      profile.cwd ?? "",
    ].join("|"),
  }));
}

function configSettingsRevision(settings: AppSettings) {
  return JSON.stringify(settings);
}

export function useKerminalShellConfigRefresh({
  machineGroups,
  profiles,
  refreshProfiles,
  refreshRemoteHostTree,
  setSettings,
  settings,
  settingsDialogDirtyRef,
  settingsDialogOpenRef,
  settingsSaveStateRef,
}: {
  machineGroups: MachineGroup[];
  profiles: Awaited<ReturnType<typeof listProfiles>>;
    refreshProfiles: () => Promise<unknown>;
    refreshRemoteHostTree: () => Promise<void>;
  setSettings: (settings: AppSettings) => void;
  settings: AppSettings;
  settingsDialogDirtyRef: MutableRefObject<boolean>;
  settingsDialogOpenRef: MutableRefObject<boolean>;
  settingsSaveStateRef: MutableRefObject<SettingsSaveState>;
}) {
  const [configNotice, setConfigNotice] = useState<ConfigChangeNotice | null>(
    null,
  );
  const [configCatalogRevisions, setConfigCatalogRevisions] = useState({
    snippets: 0,
    workflows: 0,
  });
  const machineGroupsRef = useRef(machineGroups);
  const profilesRef = useRef(profiles);
  const settingsRef = useRef(settings);
  const snippetNoticeItemsRef = useRef<ConfigChangePublicItem[]>([]);
  const workflowNoticeItemsRef = useRef<ConfigChangePublicItem[]>([]);

  machineGroupsRef.current = machineGroups;
  profilesRef.current = profiles;
  settingsRef.current = settings;

  const refreshSettingsFromConfig = useCallback(async () => {
    if (
      shouldKeepSettingsEditorDraft({
        dialogOpen: settingsDialogOpenRef.current,
        dirty: settingsDialogDirtyRef.current,
        saveState: settingsSaveStateRef.current,
      })
    ) {
      setConfigNotice({
        batchId: "settings-editor-draft",
        domains: ["settings"],
        id: `settings-editor-draft:${Date.now()}`,
        level: "warning",
        text: "设置已在外部更新，当前编辑内容已保留。",
        ttlMs: 3500,
      });
      return;
    }
    setSettings(await getSettings());
  }, [
    setSettings,
    settingsDialogDirtyRef,
    settingsDialogOpenRef,
    settingsSaveStateRef,
  ]);

  const refreshSnippetNoticeSnapshot = useCallback(async () => {
    const snippets = await listSnippets();
    snippetNoticeItemsRef.current = snippets.map((snippet) => ({
      id: snippet.id,
      label: snippet.title,
      revision: [
        snippet.updatedAt,
        snippet.scope,
        snippet.tags.join(","),
        snippet.command,
      ].join("|"),
    }));
    setConfigCatalogRevisions((current) => ({
      ...current,
      snippets: current.snippets + 1,
    }));
  }, []);

  const refreshWorkflowNoticeSnapshot = useCallback(async () => {
    const workflows = await listWorkflows();
    workflowNoticeItemsRef.current = workflows.map((workflow) => ({
      id: workflow.id,
      label: workflow.title,
      revision: [
        workflow.updatedAt,
        workflow.scope,
        workflow.tags.join(","),
        workflow.steps.map((step) => `${step.id}:${step.updatedAt}`).join(","),
      ].join("|"),
    }));
    setConfigCatalogRevisions((current) => ({
      ...current,
      workflows: current.workflows + 1,
    }));
  }, []);

  const getConfigNoticeSnapshot = useCallback(
    (): ConfigChangeNoticeSnapshot =>
      configChangeNoticeSnapshot({
        hosts: configHostNoticeItems(machineGroupsRef.current),
        profiles: configProfileNoticeItems(profilesRef.current),
        settingsRevision: configSettingsRevision(settingsRef.current),
        snippets: snippetNoticeItemsRef.current,
        workflows: workflowNoticeItemsRef.current,
      }),
    [],
  );

  const configRefreshCoordinator = useMemo(
    () =>
      createConfigRefreshCoordinator({
        getSnapshot: getConfigNoticeSnapshot,
        onNotice: setConfigNotice,
        refreshers: {
          hosts: refreshRemoteHostTree,
          profiles: async () => {
            await refreshProfiles();
          },
          settings: refreshSettingsFromConfig,
          snippets: refreshSnippetNoticeSnapshot,
          workflows: refreshWorkflowNoticeSnapshot,
        },
      }),
    [
      getConfigNoticeSnapshot,
      refreshProfiles,
      refreshRemoteHostTree,
      refreshSettingsFromConfig,
      refreshSnippetNoticeSnapshot,
      refreshWorkflowNoticeSnapshot,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([listSnippets(), listWorkflows()]).then((results) => {
      if (cancelled) {
        return;
      }
      const [snippetsResult, workflowsResult] = results;
      if (snippetsResult.status === "fulfilled") {
        snippetNoticeItemsRef.current = snippetsResult.value.map((snippet) => ({
          id: snippet.id,
          label: snippet.title,
          revision: [
            snippet.updatedAt,
            snippet.scope,
            snippet.tags.join(","),
            snippet.command,
          ].join("|"),
        }));
      }
      if (workflowsResult.status === "fulfilled") {
        workflowNoticeItemsRef.current = workflowsResult.value.map(
          (workflow) => ({
            id: workflow.id,
            label: workflow.title,
            revision: [
              workflow.updatedAt,
              workflow.scope,
              workflow.tags.join(","),
              workflow.steps
                .map((step) => `${step.id}:${step.updatedAt}`)
                .join(","),
            ].join("|"),
          }),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!configNotice) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setConfigNotice((current) =>
        current?.id === configNotice.id ? null : current,
      );
    }, configNotice.ttlMs);
    return () => window.clearTimeout(timer);
  }, [configNotice]);

  return {
    configCatalogRevisions,
    configNotice,
    configRefreshCoordinator,
    setConfigNotice,
  };
}
