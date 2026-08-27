// @author kongweiguang

import type { TerminalProfile } from "../../lib/profileApi";
import type {
  MachineGroup,
  MachineKind,
} from "../workspace/contracts/index";

export interface TerminalCreateProfileOption {
  id: string;
  isDefault: boolean;
  name: string;
  shell: string;
}

export interface TerminalCreateHostOption {
  detail: string;
  groupName: string;
  id: string;
  name: string;
}

export interface FilteredTerminalCreateOptions {
  hosts: TerminalCreateHostOption[];
  profiles: TerminalCreateProfileOption[];
}

const TERMINAL_MACHINE_KINDS = new Set<MachineKind>([
  "dockerContainer",
  "serial",
  "ssh",
  "telnet",
]);

/**
 * 将 Profile 转成稳定的菜单投影；默认项优先，但不修改 store 原有顺序，避免
 * 右键入口反向影响设置页和左栏的持久排序。
 */
export function buildTerminalCreateProfileOptions(
  profiles: readonly TerminalProfile[],
): TerminalCreateProfileOption[] {
  return [...profiles]
    .sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) ||
        left.sortOrder - right.sortOrder,
    )
    .map((profile) => ({
      id: profile.id,
      isDefault: profile.isDefault,
      name: profile.name,
      shell: profile.shell,
    }));
}

/**
 * 只暴露会生成终端 Tab 的已保存目标；RDP、SFTP 和分组有独立工作流，若混入
 * 此菜单会让“新建终端”的结果不可预测。主机详情仅使用非敏感展示字段。
 */
export function buildTerminalCreateHostOptions(
  groups: readonly MachineGroup[],
): TerminalCreateHostOption[] {
  return groups.flatMap((group) =>
    group.machines.flatMap((machine) => {
      if (!TERMINAL_MACHINE_KINDS.has(machine.kind)) {
        return [];
      }

      const endpoint = machine.host
        ? `${machine.username ? `${machine.username}@` : ""}${machine.host}${
            machine.port ? `:${machine.port}` : ""
          }`
        : machine.description;
      return [
        {
          detail: endpoint || machine.kind,
          groupName: group.title,
          id: machine.id,
          name: machine.name,
        },
      ];
    }),
  );
}

/**
 * 以空白分词并同时匹配名称、运行时和分组信息；所有词都命中才保留，既支持
 * 精确缩小结果，也避免引入模糊搜索依赖和不可解释的排序变化。
 */
export function filterTerminalCreateOptions(
  profileOptions: readonly TerminalCreateProfileOption[],
  hostOptions: readonly TerminalCreateHostOption[],
  query: string,
): FilteredTerminalCreateOptions {
  const terms = normalizedSearchTerms(query);
  if (terms.length === 0) {
    return {
      hosts: [...hostOptions],
      profiles: [...profileOptions],
    };
  }

  return {
    hosts: hostOptions.filter((host) =>
      matchesAllSearchTerms([host.name, host.groupName, host.detail], terms),
    ),
    profiles: profileOptions.filter((profile) =>
      matchesAllSearchTerms(
        [profile.name, profile.shell, profile.isDefault ? "默认" : ""],
        terms,
      ),
    ),
  };
}

/** 将用户输入收敛为大小写无关的非空搜索词。 */
function normalizedSearchTerms(query: string): string[] {
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

/** 对一个候选的多个展示字段执行 AND 匹配，保证多词搜索可预测。 */
function matchesAllSearchTerms(
  fields: readonly string[],
  terms: readonly string[],
): boolean {
  const searchableText = fields.join("\n").toLocaleLowerCase();
  return terms.every((term) => searchableText.includes(term));
}
