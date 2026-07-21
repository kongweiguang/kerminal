#!/usr/bin/env node
// @author kongweiguang
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { conversationSignals, redact } from './evolution_metrics.mjs';

export function runHook(allowedEvents = null) {
  const input = readInput();
  try {
    const root = findProjectRoot(input.cwd || process.cwd());
    if (!root || allowedEvents && !allowedEvents.includes(input.hook_event_name)) emit({});
    else {
      ensureStateAccess(root);
      const event = input.hook_event_name;
      recordHookObservation(root, input);
      if (event === 'SessionStart') emit(onSessionStart(root));
      else if (event === 'UserPromptSubmit') emit(onUserPromptSubmit(root, input));
      else if (event === 'SubagentStart') emit(onSubagentStart(root, input));
      else if (event === 'PreToolUse') emit(onPreToolUse(root, input));
      else if (event === 'PostToolUse') emit(onPostToolUse(root, input));
      else if (event === 'SubagentStop') emit(onSubagentStop(root, input));
      else if (event === 'Stop') emit(onStop(root, input));
      else emit({});
    }
  } catch (error) {
    emit({ systemMessage: 'Updeng Hook 执行失败：' + error.message });
  }
}

function onSessionStart(root) {
  pruneRuntime(root);
  const plans = readJsonSafe(statePath(root, 'plans', 'index.json')).value?.plans || [];
  const blockers = readJsonSafe(statePath(root, 'blockers.json')).value?.items || [];
  const tasks = readRuntimeTasks(root);
  const lines = [
    'Updeng 是本地弱流程层。使用工具前先读取强制加载的工作流与工程治理 Skills。',
    '分别判断流程深度（direct/plan）和执行位置（local/Codex worktree）。Hook 负责项目 Skill 评估与状态提示；subagent、合并、handoff、验证和 worktree 清理由 Codex 原生能力负责。',
    '本地共享状态：' + statePath(root),
  ];
  for (const item of tasks.slice(0, 8)) {
    lines.push('- 运行中 ' + item.executor + '/' + item.execution + '：' + item.sessionId + (item.agentId ? '/' + item.agentId : '') + ' ' + item.title);
  }
  if (tasks.length > 8) lines.push('- 另有 ' + (tasks.length - 8) + ' 个运行中任务，可用 updeng status . 查看。');
  let visiblePlanTasks = 0;
  let planTasksTruncated = false;
  for (const plan of plans.filter((item) => !['done', 'superseded'].includes(item?.status)).slice(0, 6)) {
    lines.push('- 计划 ' + plan.status + '：' + plan.id + ' ' + plan.title + ' (' + plan.path + ')' + (plan.dependsOn?.length ? '，依赖 ' + plan.dependsOn.join(', ') : '') + (plan.controllerSessionId ? '，主控会话 ' + plan.controllerSessionId : '，尚未绑定主控会话'));
    const directory = resolveLocalReference(root, plan.path);
    const document = directory ? readJsonSafe(path.join(directory, 'tasks.json')).value : null;
    for (const task of (document?.tasks || []).filter((item) => item?.status !== 'done')) {
      if (visiblePlanTasks >= 8) {
        planTasksTruncated = true;
        break;
      }
      lines.push('  - 任务 ' + task.status + '：' + task.id + ' ' + task.executor + '/' + task.execution + ' risk=' + (task.risk || 'invalid') + ' docs=' + (task.documentation?.impact || 'invalid') + ' [' + (task.skills || []).join(', ') + '] ' + task.title);
      visiblePlanTasks += 1;
    }
  }
  if (planTasksTruncated) lines.push('- 还有未完成的计划任务，可用 updeng status . 查看。');
  for (const item of blockers.filter((entry) => entry?.status === 'open').slice(0, 6)) {
    lines.push('- 阻塞项 ' + item.id + ' [' + item.kind + '] ' + item.title);
  }
  const errors = validateCoreState(root);
  if (errors.length) lines.push('- 状态错误：' + errors.slice(0, 4).join('; ') + '。请运行 updeng doctor .');
  return contextOutput('SessionStart', lines.join('\n'));
}

function onUserPromptSubmit(root, payload) {
  const config = readConfig(root);
  const manifest = readJsonSafe(statePath(root, 'skills.json')).value || { mandatorySkills: [], skills: [], routes: [] };
  const prompt = String(payload.prompt || '').trim();
  let route;
  let assignment;
  withRuntimeLock(root, () => {
    const activeBefore = readRuntimeTasks(root).filter((item) => item.sessionId !== payload.session_id);
    route = routePrompt(prompt, manifest, root, activeBefore);
    writeRuntimeTask(root, payload, route, firstLine(redact(prompt, config), 180));
  });
  if (route.flow === 'plan') {
    assignment = ensurePlanAssignment(root, payload, route, redact(prompt, config));
    if (assignment.task) withRuntimeLock(root, () => bindRuntimeAssignment(root, payload, assignment));
  }
  appendConversation(root, payload, 'user', prompt);

  const mandatory = (manifest.mandatorySkills || []).map((id) => '.agents/skills/' + id + '/SKILL.md');
  const matches = matchingSkillRoutes(prompt, manifest);
  const reasons = new Map();
  for (const match of matches) for (const id of match.skills || []) if (!reasons.has(id)) reasons.set(id, match.reason);
  const skillLines = route.skills.filter((id) => !manifest.mandatorySkills.includes(id)).map((id) => '- .agents/skills/' + id + '/SKILL.md：' + (reasons.get(id) || '命中当前任务语义'));
  const lines = [
    '本轮 Updeng 路由：',
    '- 流程：' + route.flow,
    '- 风险：' + route.risk,
    '- 执行位置建议：' + route.execution,
    '- tasks.json 绑定会话 ID：' + String(payload.session_id || 'unknown'),
    ...(assignment ? [
      ...(assignment.plan ? ['- 当前计划：' + assignment.plan.id + ' (' + assignment.plan.path + ')'] : []),
      ...(assignment.task ? ['- 绑定任务：' + assignment.task.id + ' ' + assignment.task.title] : ['- 绑定任务：无；' + assignment.warning]),
    ] : []),
    '- 强制加载 Skills：' + mandatory.join(', '),
    '- 文档门禁：plan task 进入 review/done 前必须解决 documentation.impact，并通过 required documentation check',
    '- 本轮需要评估的匹配 Skills：',
    ...(skillLines.length ? skillLines : ['- 除强制加载 Skills 外无其它匹配项']),
    ...(!worktreesAvailable(root) ? ['- worktree：当前 checkout 没有可用 Git HEAD，所有写入任务必须在当前目录串行执行'] : []),
    '',
    '使用工具前读取强制加载和匹配的 Skills。direct 不创建计划文件，但仍要保持已实现业务/集成文档与代码一致；plan 由 Hook 创建或复用三文件计划并绑定当前会话，修改源码前必须先核实代码并完善计划与 task capsule。设计、执行、worktree、subagent、合并、验证和收口仍由 Codex 负责。',
  ];
  return contextOutput('UserPromptSubmit', lines.join('\n'));
}

function onSubagentStart(root, payload) {
  const manifest = readJsonSafe(statePath(root, 'skills.json')).value || { mandatorySkills: [] };
  const assignment = findAssignedTask(root, payload) || findControllerAssignment(root, payload);
  const route = {
    flow: 'plan',
    execution: checkoutExecution(root),
    risk: assignment?.task.risk || 'medium',
    skills: unique([...(manifest.mandatorySkills || []), ...(assignment?.task.skills || [])]),
  };
  withRuntimeLock(root, () => writeRuntimeTask(root, payload, route, 'Subagent ' + (payload.agent_type || payload.agent_id || 'task'), assignment));
  const lines = [
    'Updeng subagent 范围：' + (payload.agent_type || payload.agent_id || 'subagent'),
    '继承计划任务：' + (assignment ? assignment.plan.id + '/' + assignment.task.id : '未绑定；以主控会话显式委派为准'),
    '强制加载 Skills：' + (manifest.mandatorySkills || []).map((id) => '.agents/skills/' + id + '/SKILL.md').join(', '),
    '分配任务的 Skills：' + (assignment?.task.skills || []).map((id) => '.agents/skills/' + id + '/SKILL.md').join(', '),
    'Owned paths：' + ((assignment?.task.ownedPaths || []).join(', ') || '由主控会话在委派提示中明确'),
    'Shared paths：' + ((assignment?.task.sharedPaths || []).join(', ') || '无已登记共享路径'),
    '验收：' + ((assignment?.task.acceptance || []).join('；') || '由主控会话在委派提示中明确'),
    '主控会话给出的更窄边界优先。只修改明确委派的 owned paths，并把变更、验证、阻塞和集成说明返回主控会话。',
  ];
  return contextOutput('SubagentStart', lines.join('\n'));
}

function onPreToolUse(root, payload) {
  touchRuntimeTask(root, payload, []);
  const toolInput = payload.tool_input;
  const command = commandText(toolInput);
  const paths = collectPaths(root, toolInput, command);
  const warnings = [];
  const runtime = readRuntimeTask(root, payload);
  const assignment = findAssignedTask(root, payload);
  const writing = writeIntent(payload.tool_name, command, paths);
  if (runtime?.route?.flow === 'plan' && writing && !assignment) {
    warnings.push('本轮被路由为 plan，但会话 ' + String(payload.session_id || 'unknown') + ' 未绑定未完成的 tasks.json 任务；写入前创建或复用 plan.md/tasks.json/operations.jsonl 并绑定 sessionId');
  } else if (runtime?.route?.flow === 'plan' && writing && assignment && writesOutsideState(paths)) {
    if (planIsHookDraft(assignment.directory)) warnings.push('绑定的 plan.md 仍是 Hook 初稿；修改源码前必须核实代码，并补全事实、设计、验收、验证和回滚');
    if (taskCapsuleIsProvisional(assignment.task)) warnings.push('绑定任务的 task capsule 仍有占位、空 owned paths、通用验收或未替换验证命令；修改源码前先补全 references、doNotTouch、rollback、ownership、acceptance 和 verification');
  }
  warnings.push(...advisorySafetyWarnings(command, paths, toolInput));
  if (writing) warnings.push(...authorHeaderWarnings(root, paths, toolInput));
  const ownership = ownershipWarning(root, payload, paths);
  if (ownership) warnings.push(ownership.replace(/^Updeng 所有权提示：\s*/, ''));
  return warnings.length ? { systemMessage: 'Updeng 弱流程提示（不替代 Codex 权限策略）：' + warnings.join('；') + '。' } : {};
}

function writeIntent(toolName, command, paths) {
  if (/apply_patch|Edit|Write|Notebook/i.test(String(toolName || ''))) return true;
  return /(?:\bapply_patch\b|\b(?:set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|git\s+(?:add|commit|merge|checkout|switch|reset|rebase|cherry-pick|revert|stash|clean|apply|am)|npm\s+install|pnpm\s+(?:add|remove)|cargo\s+(?:add|fmt))\b|(?:prettier\b[^\r\n]*--write|eslint\b[^\r\n]*--fix))/i.test(String(command));
}

function writesOutsideState(paths) {
  return paths.length === 0 || paths.some((item) => item !== '.updeng' && !item.startsWith('.updeng/'));
}

function planIsHookDraft(directory) {
  try {
    return provisionalPlanDocument(fs.readFileSync(path.join(directory, 'plan.md'), 'utf8'));
  } catch {
    return true;
  }
}

function provisionalPlanDocument(content) {
  const text = String(content);
  return />(?: Hook-created draft\.| 由 Hook 创建的初稿。)/.test(text)
    || [
      '写清一个可独立交付、可验证的用户或调用方结果',
      '列出已读取的实现入口、调用链、测试',
      '描述当前行为到目标行为的变化、状态与数据所有权',
      '按可独立验证的纵向切片概述 tasks.json 中的任务',
      '| 主路径 | 待核实 | 待核实 | 待核实 |',
      '定义每个切片的聚焦检查、目标 checkout 集成检查',
    ].some((placeholder) => text.includes(placeholder));
}

function taskCapsuleIsProvisional(task) {
  const values = [...(Array.isArray(task?.references) ? task.references : []), ...(Array.isArray(task?.doNotTouch) ? task.doNotTouch : []), task?.rollback];
  const checks = Array.isArray(task?.verification?.checks) ? task.verification.checks : [];
  return !task || !['low', 'medium', 'high', 'critical'].includes(task.risk)
    || !Array.isArray(task.references) || !Array.isArray(task.doNotTouch) || typeof task.rollback !== 'string'
    || task.references.length === 0 || task.doNotTouch.length === 0 || !task.rollback.trim()
    || !Array.isArray(task.ownedPaths) || task.ownedPaths.length === 0
    || !Array.isArray(task.acceptance) || task.acceptance.length === 0
    || task.references.every((value) => typeof value === 'string' && value.startsWith('用户请求：'))
    || task.acceptance.some((value) => typeof value === 'string' && /交付用户请求的可观察结果/.test(value))
    || checks.some((check) => check?.required && check.kind !== 'documentation'
      && typeof check.command === 'string' && /替换为项目真实验证命令|<[^>]+>|\b(?:todo|tbd)\b/i.test(check.command))
    || values.some((value) => typeof value === 'string' && /待完善|\b(?:todo|tbd)\b|<[^>]+>/i.test(value));
}

function advisorySafetyWarnings(command, paths, toolInput) {
  const warnings = [];
  const text = String(command || '');
  if (/\bgit\s+add\b[^\r\n;&|]*(?:\s)(?:\.|\.\/|-A|--all|:\/)(?=\s|$)/i.test(text)) {
    warnings.push('检测到宽泛 staging；先查看 git status/diff，只 add 当前任务实际修改的具体文件，避免带入用户改动、生成物或敏感文件');
  }
  if (/\bgit\s+reset\b[^\r\n;&|]*--hard\b/i.test(text)) {
    warnings.push('检测到 git reset --hard；它会覆盖未提交改动，除非用户明确授权且已核对恢复方式，否则不要执行');
  }
  if (/\bgit\s+push\b[^\r\n;&|]*(?:--force(?:-with-lease|-if-includes)?|-f)(?=\s|$)/i.test(text)) {
    warnings.push('检测到强制推送；先确认目标分支、远端保护、协作者影响和恢复点，并取得明确授权');
  }
  const raw = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {});
  const sensitive = paths.filter(isSensitivePath);
  if (sensitive.length || /(?:^|[\\/\s"'])(?:\.env(?:\.[^\\/\s"']+)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^\\/\s"']+\.(?:pem|key|p12|pfx|jks|keystore|crt|cer)|credentials?(?:\.[^\\/\s"']+)?|secrets?(?:\.[^\\/\s"']+)?)(?=$|[\\/\s"'])/i.test(raw)) {
    warnings.push('检测到可能的密钥、证书或敏感配置路径' + (sensitive.length ? '：' + sensitive.join(', ') : '') + '；不得写入真实 secret，提交前逐文件检查 ignore 与 diff');
  }
  return warnings;
}

function isSensitivePath(value) {
  return /(^|\/)(?:\.env(?:\.[^/]+)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx|jks|keystore|crt|cer)|credentials?(?:\.[^/]+)?|secrets?(?:\.[^/]+)?)(?:$|\/)/i.test(String(value));
}

function authorHeaderWarnings(root, paths, toolInput) {
  const candidates = unique(paths.filter(authorHeaderRequired));
  if (!candidates.length) return [];
  const toolText = collectToolText(toolInput);
  const missing = candidates.filter((file) => !fileHasAuthor(root, file) && !toolAddsAuthor(root, file, toolText, candidates.length));
  if (!missing.length) return [];
  const visible = missing.slice(0, 6).join(', ');
  const suffix = missing.length > 6 ? ' 等 ' + missing.length + ' 个文件' : '';
  return ['作者标识硬要求：' + visible + suffix + ' 缺少 `@author kongweiguang`；本次写入必须在合法文件头或文件级注释中补齐'];
}

function authorHeaderRequired(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  const lower = normalized.toLowerCase();
  const name = path.posix.basename(lower);
  if (!normalized || normalized === '.' || /(^|\/)(?:\.git|node_modules|target|dist|build|coverage|vendor|generated|__pycache__)(?:\/|$)/i.test(normalized)) return false;
  if (/(?:^|[.-])(?:generated|gen|min)\.(?:js|css|ts)$/.test(name) || name === 'vite-env.d.ts') return false;
  if (['cargo.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock', 'gemfile.lock', 'poetry.lock', 'uv.lock'].includes(name)) return false;
  if (['dockerfile', 'makefile', 'cmakelists.txt', '.gitignore', '.gitattributes', '.npmignore', '.editorconfig'].includes(name)) return true;
  return /\.(?:rs|ts|tsx|js|jsx|mjs|cjs|java|kt|kts|go|py|c|h|cpp|hpp|cs|swift|sql|sh|bash|zsh|ps1|psm1|css|scss|sass|less|html|xml|md|mdx|yaml|yml|toml|properties|gradle|vue|svelte|graphql|proto)$/i.test(name);
}

function collectToolText(value, seen = new Set()) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const values = Array.isArray(value) ? value : Object.values(value);
  return values.map((item) => collectToolText(item, seen)).filter(Boolean).join('\n');
}

function toolAddsAuthor(root, file, toolText, candidateCount) {
  if (!toolText.includes('@author kongweiguang')) return false;
  if (candidateCount === 1) return true;
  const pattern = /\*\*\* (?:Add|Update) File:\s+(.+?)\r?\n([\s\S]*?)(?=\r?\n\*\*\* (?:Add|Update|Delete|Move|End Patch)|$)/g;
  for (const match of toolText.matchAll(pattern)) {
    const candidate = match[1].trim().replaceAll('\\\\', '\\').replaceAll('\\"', '"');
    if (normalizeRelative(root, candidate) === file && match[2].includes('@author kongweiguang')) return true;
  }
  return false;
}

function fileHasAuthor(root, file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
  try {
    return fs.statSync(absolute).isFile() && fs.readFileSync(absolute, 'utf8').includes('@author kongweiguang');
  } catch {
    return false;
  }
}

function authorCloseoutWarning(root, payload) {
  const runtime = readRuntimeTask(root, payload);
  const missing = unique((runtime?.touchedFiles || []).filter(authorHeaderRequired)).filter((file) => {
    const absolute = path.resolve(root, file);
    try {
      return fs.statSync(absolute).isFile() && !fileHasAuthor(root, file);
    } catch {
      return false;
    }
  });
  if (!missing.length) return null;
  const visible = missing.slice(0, 8).join(', ');
  const suffix = missing.length > 8 ? ' 等 ' + missing.length + ' 个文件' : '';
  return 'Updeng 作者标识收口：' + visible + suffix + ' 缺少 `@author kongweiguang`，补齐前不得视为完成';
}

function onPostToolUse(root, payload) {
  const command = commandText(payload.tool_input);
  const paths = collectPaths(root, payload.tool_input, command);
  const changedPaths = writeIntent(payload.tool_name, command, paths) && toolSucceeded(payload.tool_response) ? paths : [];
  touchRuntimeTask(root, payload, changedPaths);
  recordPlanOperation(root, payload, command, paths);
  const stateTouched = paths.some((item) => item.startsWith('.updeng/'));
  if (!stateTouched) return {};
  const errors = validateCoreState(root);
  return errors.length ? { systemMessage: 'Updeng 状态需要修复：' + errors.slice(0, 4).join('; ') + '。请运行 updeng doctor .' } : {};
}

function onSubagentStop(root, payload) {
  const authorWarning = authorCloseoutWarning(root, payload);
  removeRuntimeTask(root, payload);
  return authorWarning ? { systemMessage: authorWarning } : {};
}

function onStop(root, payload) {
  if (typeof payload.last_assistant_message === 'string' && payload.last_assistant_message.trim()) {
    appendConversation(root, payload, 'assistant', payload.last_assistant_message);
  }
  const documentationWarning = documentationCloseoutWarning(root, payload);
  const authorWarning = authorCloseoutWarning(root, payload);
  removeRuntimeTask(root, payload);
  const errors = validateCoreState(root);
  const messages = [];
  if (authorWarning) messages.push(authorWarning);
  if (documentationWarning) messages.push(documentationWarning);
  if (errors.length) messages.push('Updeng 最终状态需要修复：' + errors.slice(0, 4).join('; '));
  return messages.length ? { systemMessage: messages.join('; ') } : {};
}

function documentationCloseoutWarning(root, payload) {
  const runtime = readRuntimeTask(root, payload);
  const changed = (runtime?.touchedFiles || []).filter((item) => item !== '.updeng' && !item.startsWith('.updeng/'));
  if (!changed.length) return null;
  const assignment = findAssignedTask(root, payload);
  if (assignment) {
    const documentation = assignment.task.documentation;
    const check = (assignment.task.verification?.checks || []).find((item) => item?.kind === 'documentation');
    if (documentation?.impact === 'pending' || check?.status !== 'passed' && ['review', 'done'].includes(assignment.task.status)) {
      return 'Updeng 文档收口：' + assignment.plan.id + '/' + assignment.task.id + ' 已修改项目文件，但文档影响尚未解决；进入 review/done 前更新已实现业务/集成文档，或记录明确的无影响理由';
    }
    return null;
  }
  if (runtime?.route?.flow === 'direct') {
    const documentationChanged = (runtime.touchedFiles || []).some((item) => item.startsWith('.updeng/docs/business/') || item.startsWith('.updeng/docs/integrations/'));
    if (!documentationChanged) return 'Updeng 文档收口：本次 direct 已修改项目文件；报告完成前确认已实现业务/集成文档是否需要同步';
  }
  return null;
}

function recordHookObservation(root, payload) {
  const marker = readJsonSafe(path.join(root, '.codex', 'updeng.json')).value;
  const revision = typeof marker?.hookRevision === 'string' ? marker.hookRevision : null;
  if (!revision) return;
  const event = String(payload.hook_event_name || '');
  const supportedEvents = new Set(['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PreToolUse', 'PostToolUse', 'SubagentStop', 'Stop']);
  if (!supportedEvents.has(event)) return;
  const target = statePath(root, 'runtime', 'hooks.json');
  const timestamp = new Date().toISOString();
  withFileLock(statePath(root, 'runtime', '.hook-health.lock'), () => {
    const current = readJsonSafe(target).value;
    const installedRevision = typeof current?.installedRevision === 'string' ? current.installedRevision : revision;
    writeJsonAtomic(target, {
      $schema: '../schemas/hook-health.schema.json',
      schemaVersion: 1,
      status: installedRevision === revision ? 'active' : 'awaiting_activation',
      installedRevision,
      observedRevision: revision,
      installedAt: current?.installedAt || timestamp,
      lastEvent: event,
      lastEventAt: timestamp,
      lastSessionId: String(payload.session_id || '') || null,
    });
  });
}

function routePrompt(prompt, manifest, root, activeTasks) {
  const text = String(prompt);
  const matches = matchingSkillRoutes(text, manifest);
  const review = /review|评审|审查|检查\s*diff|代码检查/i.test(text)
    && !/修复|修改|实现|处理|落地|直接改|fix|change|implement/i.test(text);
  const planPersistenceOptOut = isPlanPersistenceOptOut(text);
  const planWork = isPlanWorkPrompt(text);
  const discussion = /只看|只分析|先讨论|不要改|不用改|方案|设计|规划|调研|评估/i.test(text)
    && !/实现|实施|开发|修改|修复|落地|编码|直接做|计划文档|落地计划/i.test(text);
  const readOnlyQuestion = /为什么|为啥|怎么|如何|是否|什么|查看|看看|解释|说明|现状|有哪些|哪.*任务|\b(?:what|why|how)\b/i.test(text)
    && !/实现|实施|开发|修改|修复|落地|编码|直接做|处理|fix|change|implement/i.test(text);
  const explicitlySmall = /小改|微调|文案|拼写|改名|一行|简单修复|直接改/i.test(text) && text.length < 400;
  const criticalRisk = /生产[^\r\n]*(?:删除数据|清空|不可逆|直接写入)|全量回填|密钥轮换|主分支强推|force\s*push\s+(?:origin\s+)?(?:main|master)/i.test(text);
  const productionSideEffect = /(?:生产|线上)(?:环境|数据|数据库|账号|密钥|服务|集群|资源|系统|流量|发布|部署|写入|变更|操作)/i.test(text);
  const highRisk = productionSideEffect || /发布|部署|迁移|回填|删除数据|认证|权限|密钥|签名|force\s*push|强推|远程写|database\s+migration/i.test(text);
  const nonTrivial = /实现|开发|新增|修复|重构|迁移|发布|功能|跨模块|多步骤|worktree|subagent|并行|\bfix\b/i.test(text)
    || matches.some((item) => item.flow === 'plan') || text.length > 600;
  const flow = review ? 'review' : planPersistenceOptOut ? 'discussion' : planWork ? 'plan' : discussion ? 'discussion' : readOnlyQuestion ? 'direct' : highRisk || nonTrivial && !explicitlySmall ? 'plan' : 'direct';
  const actualExecution = checkoutExecution(root);
  const canUseWorktrees = worktreesAvailable(root);
  const explicitWorktree = /worktree|后台|并行|独立分支|隔离/i.test(text);
  const dirty = gitOutput(root, ['status', '--porcelain'])?.trim().length > 0;
  const anotherWriter = activeTasks.some((task) => !['discussion', 'review'].includes(task.route?.flow));
  const execution = canUseWorktrees && (actualExecution === 'worktree' || explicitWorktree || anotherWriter)
    ? 'worktree'
    : canUseWorktrees && flow === 'plan' && dirty ? 'local-or-worktree' : 'local';
  const risk = criticalRisk ? 'critical' : highRisk ? 'high' : ['plan', 'review'].includes(flow) ? 'medium' : 'low';
  return {
    flow,
    execution,
    risk,
    skills: unique([...(manifest.mandatorySkills || []), ...matches.flatMap((item) => item.skills || [])]),
  };
}

function isPlanWorkPrompt(prompt) {
  const text = String(prompt);
  if (isPlanPersistenceOptOut(text)) return false;
  return /(?:继续|接着|恢复|执行|实施|按|写|制定|创建|完善|补全|重写|重做|重新设计|调整|更新|修改|修复|拆分)[^\r\n]{0,24}(?:plan|计划)|(?:plan|计划)[^\r\n]{0,24}(?:执行|实施|完善|补全|重写|重做|重新设计|调整|更新|修改|修复|拆分)/i.test(text);
}

function isPlanPersistenceOptOut(prompt) {
  return /(?:不要|无需)(?:创建|写入|落盘|修改)(?:这个|当前|任何)?\s*(?:plan|计划)(?:文件)?|(?:plan|计划)(?:文件)?\s*(?:不要|无需)(?:创建|写入|落盘|修改)|只在(?:回复|对话)[^\r\n]{0,12}(?:给|写|展示)[^\r\n]{0,12}(?:plan|计划)/i.test(String(prompt));
}

function matchingSkillRoutes(prompt, manifest) {
  return (manifest.routes || []).filter((route) => safeRegex(route.pattern).test(String(prompt)));
}

function ensurePlanAssignment(root, payload, route, prompt) {
  return withFileLock(statePath(root, 'plans', '.lock'), () => {
    const existing = findAssignedTask(root, payload);
    if (existing) return existing;

    const indexPath = statePath(root, 'plans', 'index.json');
    const index = readJsonSafe(indexPath).value;
    if (!index || !Array.isArray(index.plans)) throw new Error('plans/index.json 无效');
    const explicitId = explicitPlanId(prompt);
    const controllerPlan = index.plans.find((item) => !['done', 'superseded'].includes(item?.status)
      && item.controllerSessionId === String(payload.session_id || 'unknown'));
    if (controllerPlan) {
      if (explicitId && String(controllerPlan.id).toUpperCase() !== explicitId) {
        const requested = index.plans.find((item) => String(item?.id).toUpperCase() === explicitId);
        return {
          plan: requested || controllerPlan,
          task: null,
          directory: null,
          warning: '当前会话已绑定计划 ' + controllerPlan.id + '；完成或 handoff 当前计划后才能接管 ' + explicitId,
        };
      }
      const bound = bindPlanTask(root, index, controllerPlan, payload, route);
      if (bound.task) writeJsonAtomic(indexPath, index);
      return bound;
    }
    const referenced = referencedPlan(index, prompt);
    if (referenced) {
      const bound = bindPlanTask(root, index, referenced, payload, route, {
        allowHandoff: explicitPlanHandoff(prompt),
      });
      if (bound.task) writeJsonAtomic(indexPath, index);
      return bound;
    }
    if (explicitId) {
      const historical = index.plans.find((item) => String(item?.id).toUpperCase() === explicitId);
      return {
        plan: historical || null,
        task: null,
        directory: null,
        warning: historical
          ? '引用的计划状态为 ' + historical.status + '，不能自动恢复或复制；请明确 reopen、handoff 或新计划边界'
          : '引用的计划 ' + explicitId + ' 不存在；请核对 updeng status，不创建同名或替代计划',
      };
    }

    const unfinished = index.plans.filter((item) => !['done', 'superseded'].includes(item?.status));
    if (continuationPrompt(prompt) && unfinished.length > 1) return {
      plan: null,
      task: null,
      directory: null,
      warning: '存在多个未完成计划；请点名目标 PLAN id，避免当前 Codex 主控会话被静默绑定到错误计划',
    };

    return createPlanScaffold(root, indexPath, index, payload, route, prompt);
  });
}

function referencedPlan(index, prompt) {
  const active = index.plans.filter((item) => !['done', 'superseded'].includes(item?.status));
  const explicitId = explicitPlanId(prompt);
  if (explicitId) return active.find((item) => String(item.id).toUpperCase() === explicitId) || null;
  if (continuationPrompt(prompt) && active.length === 1) return active[0];
  return null;
}

function explicitPlanId(prompt) {
  return String(prompt).match(/\bPLAN-[0-9]{8}-[0-9]{6}-[a-z0-9-]+\b/i)?.[0]?.toUpperCase() || null;
}

function continuationPrompt(prompt) {
  return /继续|接着|恢复|实施计划|执行计划|按计划|完善(?:这个|当前)?\s*(?:plan|计划)|补全(?:这个|当前)?\s*(?:plan|计划)|重写(?:这个|当前)?\s*(?:plan|计划)|重做(?:这个|当前)?\s*(?:plan|计划)|重新设计(?:这个|当前)?\s*(?:plan|计划)|调整(?:这个|当前)?\s*(?:plan|计划)|更新(?:这个|当前)?\s*(?:plan|计划)|修改(?:这个|当前)?\s*(?:plan|计划)|continue|resume|implement\s+(?:the\s+)?plan/i.test(String(prompt));
}

function explicitPlanHandoff(prompt) {
  return Boolean(explicitPlanId(prompt))
    && /接管|移交|交接|重新绑定|换(?:到|个)?(?:新)?会话|handoff|take\s*over|takeover|rebind/i.test(String(prompt));
}

function bindPlanTask(root, index, plan, payload, route, { allowHandoff = false } = {}) {
  const directory = resolveLocalReference(root, plan.path);
  if (!directory) return { plan, task: null, directory: null, warning: '引用的计划目录不可用' };
  const tasksPath = path.join(directory, 'tasks.json');
  const document = readJsonSafe(tasksPath).value;
  if (!document || !Array.isArray(document.tasks)) return { plan, task: null, directory, warning: '引用计划的 tasks.json 无效' };
  const sessionId = String(payload.session_id || 'unknown');
  if (plan.status === 'blocked') return { plan, task: null, directory, warning: '引用的计划已阻塞；执行前先解决结构化 blocker' };
  const previousControllerSessionId = plan.controllerSessionId && plan.controllerSessionId !== sessionId
    ? plan.controllerSessionId
    : null;
  if (previousControllerSessionId && !allowHandoff) return { plan, task: null, directory, warning: '引用计划属于主控会话 ' + previousControllerSessionId + '；应恢复原 Codex 任务，或在确认旧会话已停止后明确“接管 ' + plan.id + '”' };
  if (previousControllerSessionId && readRuntimeTasks(root).some((item) => item.executor === 'controller' && item.sessionId === previousControllerSessionId)) {
    return { plan, task: null, directory, warning: '旧主控会话 ' + previousControllerSessionId + ' 仍在运行；先停止或 handoff 旧 Codex 任务，不能并发接管同一计划' };
  }
  const roadmap = (index.roadmaps || []).find((item) => item.id === plan.roadmapId);
  const activeSibling = roadmap?.executionPolicy === 'single-writer'
    ? index.plans.find((item) => item.id !== plan.id && item.roadmapId === roadmap.id && item.status === 'active')
    : null;
  if (activeSibling) return { plan, task: null, directory, warning: 'roadmap ' + roadmap.id + ' 是 single-writer，计划 ' + activeSibling.id + ' 已 active；开始本计划前先完成或 handoff 现有主控会话' };
  const planMap = new Map(index.plans.map((item) => [item.id, item]));
  const blockedDependencies = (plan.dependsOn || []).filter((id) => planMap.get(id)?.status !== 'done');
  if (blockedDependencies.length) return { plan, task: null, directory, warning: '跨计划依赖尚未完成：' + blockedDependencies.join(', ') };
  const done = new Set(document.tasks.filter((item) => item?.status === 'done').map((item) => item.id));
  let task = document.tasks.find((item) => item?.status !== 'done' && item.sessionId === sessionId);
  if (!task && previousControllerSessionId && allowHandoff) {
    task = document.tasks.find((item) => item?.status !== 'done'
      && item.executor === 'controller'
      && !item.agentId
      && item.sessionId === previousControllerSessionId);
  }
  task ||= document.tasks.find((item) => item?.status !== 'done'
    && item.executor === 'controller'
    && !item.sessionId
    && !item.agentId
    && (item.dependsOn || []).every((id) => done.has(id)));
  if (!task) return { plan, task: null, directory, warning: '引用计划没有可分配的可运行 controller task；修改任务图前先检查依赖、active subagent 和当前所有权' };
  const timestamp = new Date().toISOString();
  plan.controllerSessionId = sessionId;
  if (plan.status === 'pending') plan.status = 'active';
  task.sessionId = sessionId;
  task.skills = unique([...(task.skills || []), ...(route.skills || [])]);
  task.risk = higherRisk(task.risk, route.risk);
  if (task.status === 'pending') task.status = 'in_progress';
  task.startedAt ||= timestamp;
  task.updatedAt = timestamp;
  document.updatedAt = timestamp;
  writeJsonAtomic(tasksPath, document);
  plan.updatedAt = timestamp;
  index.updatedAt = timestamp;
  if (previousControllerSessionId) {
    fs.appendFileSync(path.join(directory, 'operations.jsonl'), JSON.stringify({
      schemaVersion: 1,
      id: 'OP-' + crypto.randomUUID(),
      at: timestamp,
      planId: plan.id,
      taskId: task.id,
      sessionId,
      kind: 'handoff',
      status: 'ok',
      summary: '用户显式接管已停止旧会话的计划主控权',
      tool: 'skill_forced_eval',
      detail: 'from=' + previousControllerSessionId + '; to=' + sessionId,
      paths: [],
    }) + '\n', 'utf8');
  }
  return { plan, task, directory };
}

function createPlanScaffold(root, indexPath, index, payload, route, prompt) {
  const timestamp = new Date();
  const now = timestamp.toISOString();
  const title = firstLine(prompt, 160);
  const id = availablePlanId(root, timestamp, prompt);
  const relative = '.updeng/plans/active/' + id;
  const directory = statePath(root, 'plans', 'active', id);
  const taskExecution = route.execution === 'worktree' ? 'worktree' : 'local';
  const executionStrategy = route.execution === 'local-or-worktree' ? 'mixed' : taskExecution;
  const sessionId = String(payload.session_id || 'unknown');
  const task = {
    id: 'TASK-001',
    title,
    status: 'in_progress',
    risk: route.risk,
    skills: unique(route.skills || []),
    references: [
      '用户请求：' + firstLine(prompt, 500),
      '待完善：修改源码前补充相关代码、调用方、测试、业务文档、设计或 issue 引用。',
    ],
    doNotTouch: ['待完善：核实禁止修改的路径、公共契约和业务边界；始终不得覆盖未归因用户改动或真实 secret。'],
    rollback: '待完善：修改源码前写明本任务代码、数据和外部副作用的具体回退步骤及回退后验证；不得覆盖未归因用户改动。',
    delegation: 'controller',
    executor: 'controller',
    execution: taskExecution,
    sessionId,
    agentId: null,
    ownedPaths: [],
    sharedPaths: [],
    dependsOn: [],
    acceptance: ['交付用户请求的可观察结果，明确失败行为，不发生未经批准的范围扩张。'],
    documentation: {
      impact: 'pending',
      paths: [],
      reason: null,
    },
    verification: {
      status: 'pending',
      checks: [
        {
          id: 'CHECK-001',
          kind: 'test',
          required: true,
          description: '运行最窄有效自动化检查，并在目标 checkout 执行集成门禁。',
          command: '修改源码前替换为项目真实验证命令。',
          status: 'pending',
          evidence: null,
        },
        {
          id: 'CHECK-002',
          kind: 'documentation',
          required: true,
          description: '判断文档影响：更新已实现的业务/集成文档，或明确记录无需更新的理由。',
          command: null,
          status: 'pending',
          evidence: null,
        },
      ],
      summary: null,
    },
    blockerId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
  };
  const plan = {
    id,
    roadmapId: null,
    title,
    status: 'active',
    path: relative,
    dependsOn: [],
    executionStrategy,
    controllerSessionId: sessionId,
    supersededBy: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  fs.mkdirSync(directory, { recursive: false });
  try {
    fs.writeFileSync(path.join(directory, 'plan.md'), planScaffold(title, prompt, route), 'utf8');
    writeJsonAtomic(path.join(directory, 'tasks.json'), {
      $schema: '../../../schemas/plan-tasks.schema.json',
      schemaVersion: 5,
      planId: id,
      updatedAt: now,
      tasks: [task],
    });
    fs.writeFileSync(path.join(directory, 'operations.jsonl'), JSON.stringify({
      schemaVersion: 1,
      id: 'OP-' + crypto.randomUUID(),
      at: now,
      planId: id,
      taskId: task.id,
      sessionId,
      kind: 'note',
      status: 'ok',
      summary: 'UserPromptSubmit 创建并绑定计划初稿',
      tool: 'skill_forced_eval',
      detail: null,
      paths: [],
    }) + '\n', 'utf8');
    index.updatedAt = now;
    index.plans.push(plan);
    writeJsonAtomic(indexPath, index);
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return { plan, task, directory };
}

function availablePlanId(root, timestamp, prompt) {
  const pad = (value) => String(value).padStart(2, '0');
  const date = String(timestamp.getFullYear()) + pad(timestamp.getMonth() + 1) + pad(timestamp.getDate());
  const time = pad(timestamp.getHours()) + pad(timestamp.getMinutes()) + pad(timestamp.getSeconds());
  const textSlug = slugify(firstLine(prompt, 80));
  const fallback = 'task-' + crypto.createHash('sha256').update(String(prompt)).digest('hex').slice(0, 8);
  const base = 'PLAN-' + date + '-' + time + '-' + (textSlug === 'project' ? fallback : textSlug);
  let id = base;
  let suffix = 2;
  while (fs.existsSync(statePath(root, 'plans', 'active', id)) || fs.existsSync(statePath(root, 'plans', 'archive', id))) id = base + '-' + suffix++;
  return id;
}

function planScaffold(title, prompt, route) {
  const request = String(prompt).slice(0, 4000).replace(/\r?\n/g, '\n> ');
  return [
    '<!-- @author kongweiguang -->',
    '',
    '# ' + title,
    '',
    '> 由 Hook 创建的初稿。它只负责建立持久载体，不代表方案已经完成；修改源码前必须核实代码、文档和运行事实，并替换所有待核实内容。',
    '',
    '## 交付目标',
    '',
    '写清一个可独立交付、可验证的用户或调用方结果，以及完成后可直接观察到的变化。本计划只由一个 Codex 主控会话负责集成。',
    '',
    '## 当前事实与证据',
    '',
    '### 原始请求',
    '',
    '> ' + request,
    '',
    '### 已确认事实',
    '',
    '列出已读取的实现入口、调用链、测试、已实现业务/集成文档、运行证据和相关 discovery 资料，并给出具体路径或符号。',
    '',
    '### 待核实假设',
    '',
    '列出仍需通过代码、测试、真实运行或用户决定验证的假设；不得把假设写成当前事实。',
    '',
    '## 范围与边界',
    '',
    '写清本次包含的行为、明确非目标、兼容要求、禁止修改的模块/契约、数据与权限边界，以及不得覆盖的用户改动。',
    '',
    '## 业务与技术方案',
    '',
    '描述当前行为到目标行为的变化、状态与数据所有权、公开契约、生命周期、失败/取消/恢复、并发与幂等、安全与隐私、性能预算，以及被拒绝但会影响实施的替代方案。',
    '',
    '## 子计划、依赖与输入',
    '',
    '当需求包含多个可独立交付结果、可由不同主控会话执行或需要分阶段发布时，在 plans/index.json 建 roadmap 并拆成多个 child plan。这里写明跨 plan 依赖、外部决定、输入产物和每个依赖提供的精确契约；不要把多个项目级目标塞进一个超大计划。',
    '',
    '## 执行与所有权',
    '',
    '- 初始执行位置建议：' + route.execution + '。',
    '- 初始风险：' + route.risk + '。',
    '- 匹配 Skills：' + (route.skills || []).join(', ') + '。',
    '- 明确 controller-owned、subagent-eligible、shared paths 和唯一 integration owner。是否启动 subagent/worktree 由主控会话依据当前冲突重新判断，计划只写切分与集成契约。',
    '',
    '## 任务切片',
    '',
    '按可独立验证的纵向切片概述 tasks.json 中的任务、依赖顺序、输入输出和集成点。状态、会话绑定、风险、owned paths、验证结果和 blocker 只写 tasks.json，不在本文使用复选框维护。',
    '',
    '## 验收矩阵',
    '',
    '| 场景 | 输入/前置条件 | 可观察结果 | 证据入口 |',
    '| --- | --- | --- | --- |',
    '| 主路径 | 待核实 | 待核实 | 待核实 |',
    '| 失败、取消与恢复 | 待核实 | 待核实 | 待核实 |',
    '| 兼容、权限与边界 | 待核实 | 待核实 | 待核实 |',
    '| 性能、可访问性或用户错误 | 按适用范围填写 | 待核实 | 待核实 |',
    '',
    '## 验证矩阵',
    '',
    '定义每个切片的聚焦检查、目标 checkout 集成检查、真实运行/非 mock 证据、UI 截图、review、性能、安全和产物门禁。tasks.json 保存每项检查的实时状态与证据；本文只定义验证策略。',
    '',
    '## 发布、迁移与回滚',
    '',
    '写清迁移顺序、灰度/切换、兼容窗口、失败回退、数据和外部副作用恢复、回滚后验证，以及旧路径可以删除的条件。没有数据或发布影响时也要明确说明。',
    '',
    '## 风险、决策与阻塞',
    '',
    '列出已知风险、可逆默认值、必须写入 blockers.json 的用户决定，以及需要重新规划而不是静默扩范围的条件。',
    '',
    '## 文档同步',
    '',
    '只在功能实际落地并验证后更新 docs/business 或 docs/integrations；未实现设计、候选和资料留在 docs/discovery。写清受影响模块、具体文档路径和判断为无影响时的理由。',
    '',
    '## Handoff 与收口',
    '',
    '定义恢复会话所需材料、subagent/worktree 合并后的目标 checkout 复验、operations.jsonl 需要留下的关键操作，以及任务、计划、业务文档和临时 worktree 全部收口的完成定义。',
    '',
  ].join('\n');
}

function writeRuntimeTask(root, payload, route, title, assignment = null) {
  const filePath = runtimeTaskPath(root, payload);
  const existing = readJsonSafe(filePath).value;
  const timestamp = new Date().toISOString();
  const task = {
    $schema: '../../schemas/runtime-task.schema.json',
    schemaVersion: 2,
    sessionId: String(payload.session_id || 'unknown'),
    agentId: payload.agent_id ? String(payload.agent_id) : null,
    turnId: String(payload.turn_id || 'unknown'),
    title: title || 'Codex task',
    status: 'running',
    cwd: path.resolve(payload.cwd || root),
    executor: payload.agent_id ? 'subagent' : 'controller',
    execution: checkoutExecution(root),
    branch: gitOutput(root, ['branch', '--show-current']) || null,
    planId: assignment?.plan.id || existing?.planId || null,
    taskId: assignment?.task.id || existing?.taskId || null,
    route,
    touchedFiles: Array.isArray(existing?.touchedFiles) ? existing.touchedFiles : [],
    startedAt: existing?.startedAt || timestamp,
    updatedAt: timestamp,
    heartbeatAt: timestamp,
  };
  writeJsonAtomic(filePath, task);
}

function bindRuntimeAssignment(root, payload, assignment) {
  const filePath = runtimeTaskPath(root, payload);
  const current = readJsonSafe(filePath).value;
  if (!current) return;
  current.planId = assignment.plan.id;
  current.taskId = assignment.task.id;
  current.updatedAt = new Date().toISOString();
  current.heartbeatAt = current.updatedAt;
  writeJsonAtomic(filePath, current);
}

function touchRuntimeTask(root, payload, paths) {
  withRuntimeLock(root, () => {
    const filePath = runtimeTaskPath(root, payload);
    const current = readJsonSafe(filePath).value;
    if (!current) return;
    current.turnId = String(payload.turn_id || current.turnId);
    current.touchedFiles = unique([...(current.touchedFiles || []), ...paths]);
    current.updatedAt = new Date().toISOString();
    current.heartbeatAt = current.updatedAt;
    writeJsonAtomic(filePath, current);
  });
}

function readRuntimeTask(root, payload) {
  return readJsonSafe(runtimeTaskPath(root, payload)).value;
}

function removeRuntimeTask(root, payload) {
  withRuntimeLock(root, () => fs.rmSync(runtimeTaskPath(root, payload), { force: true }));
}

function withRuntimeLock(root, action) {
  return withFileLock(statePath(root, 'runtime', '.lock'), action);
}

function runtimeTaskPath(root, payload) {
  const key = String(payload.session_id || 'unknown') + '|' + String(payload.agent_id || 'root');
  const name = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) + '.json';
  return statePath(root, 'runtime', 'tasks', name);
}

function readRuntimeTasks(root) {
  const directory = statePath(root, 'runtime', 'tasks');
  if (!fs.existsSync(directory)) return [];
  const tasks = [];
  for (const name of fs.readdirSync(directory).filter((item) => item.endsWith('.json'))) {
    const task = readJsonSafe(path.join(directory, name)).value;
    if (task && task.status === 'running') tasks.push(task);
  }
  return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function pruneRuntime(root) {
  const config = readConfig(root);
  const maxAge = (config.runtime?.pruneAfterHours || 24) * 60 * 60 * 1000;
  const directory = statePath(root, 'runtime', 'tasks');
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory).filter((item) => item.endsWith('.json'))) {
    const filePath = path.join(directory, name);
    const task = readJsonSafe(filePath).value;
    if (!task || Date.now() - Date.parse(task.heartbeatAt) > maxAge) fs.rmSync(filePath, { force: true });
  }
}

function appendConversation(root, payload, role, rawContent) {
  const config = readConfig(root);
  if (config.metrics?.captureConversations === false) return;
  const sessionId = String(payload.session_id || 'unknown');
  const hash = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
  const relative = '.updeng/metrics/conversations/' + hash + '.jsonl';
  const filePath = statePath(root, 'metrics', 'conversations', hash + '.jsonl');
  const max = config.metrics?.maxMessageChars || 200000;
  let content = String(rawContent);
  if (config.metrics?.redactSecrets !== false) content = redact(content, config);
  const truncated = content.length > max;
  if (truncated) content = content.slice(0, max);
  const timestamp = new Date().toISOString();
  const event = {
    schemaVersion: 1,
    id: String(payload.turn_id || timestamp) + '-' + role,
    at: timestamp,
    sessionId,
    turnId: payload.turn_id ? String(payload.turn_id) : null,
    role,
    content,
    signals: role === 'user' ? conversationSignals(content) : [],
    model: payload.model ? String(payload.model) : null,
    truncated,
  };
  const lock = statePath(root, 'metrics', '.lock');
  withFileLock(lock, () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const indexPath = statePath(root, 'metrics', 'index.json');
    const index = readJsonSafe(indexPath).value || { $schema: '../schemas/metrics-index.schema.json', schemaVersion: 1, updatedAt: timestamp, sessions: [] };
    let session = index.sessions.find((item) => item.sessionId === sessionId);
    const tail = conversationTail(filePath);
    const alreadyWritten = tail.ids.has(event.id);
    if (!alreadyWritten) {
      fs.appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
    }
    if (!session) {
      const stats = conversationStats(filePath);
      session = {
        sessionId,
        path: relative,
        models: stats.models,
        startedAt: stats.startedAt,
        updatedAt: stats.updatedAt,
        messageCount: stats.messageCount,
        lastEventId: stats.lastEventId,
      };
      index.sessions.push(session);
    } else if (!alreadyWritten || tail.lastEventId === event.id && session.lastEventId !== event.id) {
      session.messageCount += 1;
      session.updatedAt = event.at;
      session.lastEventId = event.id;
      if (event.model && !session.models.includes(event.model)) session.models.push(event.model);
    }
    session.path = relative;
    index.updatedAt = timestamp;
    writeJsonAtomic(indexPath, index);
  });
}

function conversationStats(filePath) {
  const stats = { ids: new Set(), messageCount: 0, models: [], startedAt: null, updatedAt: null, lastEventId: null };
  if (!fs.existsSync(filePath)) return stats;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object') continue;
      if (typeof event.id === 'string') stats.ids.add(event.id);
      stats.messageCount += 1;
      stats.startedAt ||= event.at;
      stats.updatedAt = event.at;
      stats.lastEventId = event.id;
      if (typeof event.model === 'string' && event.model && !stats.models.includes(event.model)) stats.models.push(event.model);
    } catch {
      // 状态校验会报告损坏历史，这里只跳过当前无效行。
    }
  }
  return stats;
}

function conversationTail(filePath) {
  const result = { ids: new Set(), lastEventId: null };
  if (!fs.existsSync(filePath)) return result;
  const size = fs.statSync(filePath).size;
  const length = Math.min(size, 1_000_000);
  const buffer = Buffer.alloc(length);
  const handle = fs.openSync(filePath, 'r');
  try {
    fs.readSync(handle, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(handle);
  }
  let lines = buffer.toString('utf8').split(/\r?\n/);
  if (size > length) lines = lines.slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (typeof event?.id === 'string') {
        result.ids.add(event.id);
        result.lastEventId = event.id;
      }
    } catch {
      // 完整 doctor 校验会按准确位置报告损坏历史。
    }
  }
  return result;
}

function recordPlanOperation(root, payload, command, paths) {
  const assignment = findAssignedTask(root, payload);
  if (!assignment) return;
  const classification = classifyOperation(command, paths);
  if (!classification) return;
  const timestamp = new Date().toISOString();
  const operation = {
    schemaVersion: 1,
    id: 'OP-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
    at: timestamp,
    planId: assignment.plan.id,
    taskId: assignment.task.id,
    sessionId: String(payload.session_id || ''),
    kind: classification.kind,
    status: toolSucceeded(payload.tool_response) ? 'ok' : 'error',
    summary: classification.summary,
    tool: payload.tool_name ? String(payload.tool_name) : null,
    detail: operationDetail(command),
    paths,
  };
  const lock = path.join(assignment.directory, '.lock');
  withFileLock(lock, () => {
    fs.appendFileSync(path.join(assignment.directory, 'operations.jsonl'), JSON.stringify(operation) + '\n', 'utf8');
  });
}

function findAssignedTask(root, payload) {
  const index = readJsonSafe(statePath(root, 'plans', 'index.json')).value;
  for (const plan of (index?.plans || []).filter((item) => !['done', 'superseded'].includes(item.status))) {
    const directory = resolveLocalReference(root, plan.path);
    if (!directory) continue;
    const document = readJsonSafe(path.join(directory, 'tasks.json')).value;
    const task = (document?.tasks || []).find((item) => item.status !== 'done'
      && (payload.agent_id ? item.agentId === payload.agent_id : item.sessionId === payload.session_id));
    if (task) return { plan, task, directory };
  }
  if (payload.agent_id) {
    const runtime = readRuntimeTask(root, payload);
    const plan = (index?.plans || []).find((item) => item.id === runtime?.planId && !['done', 'superseded'].includes(item.status));
    const directory = plan ? resolveLocalReference(root, plan.path) : null;
    const document = directory ? readJsonSafe(path.join(directory, 'tasks.json')).value : null;
    const task = (document?.tasks || []).find((item) => item.id === runtime?.taskId && item.status !== 'done');
    if (plan && task && directory) return { plan, task, directory };
  }
  return null;
}

function findControllerAssignment(root, payload) {
  const index = readJsonSafe(statePath(root, 'plans', 'index.json')).value;
  const sessionId = String(payload.session_id || '');
  if (!sessionId) return null;
  for (const plan of (index?.plans || []).filter((item) => !['done', 'superseded'].includes(item.status)
    && item.controllerSessionId === sessionId)) {
    const directory = resolveLocalReference(root, plan.path);
    const document = directory ? readJsonSafe(path.join(directory, 'tasks.json')).value : null;
    const task = (document?.tasks || []).find((item) => item.status !== 'done' && item.sessionId === sessionId);
    if (task) return { plan, task, directory };
  }
  return null;
}

function classifyOperation(command, paths) {
  if (/\bgit\s+worktree\b/i.test(command)) return { kind: 'worktree', summary: 'Codex 执行 worktree 操作' };
  if (/\bgit\s+merge\b/i.test(command)) return { kind: 'merge', summary: 'Codex 执行合并操作' };
  if (/\bgit\s+commit\b/i.test(command)) return { kind: 'commit', summary: 'Codex 执行提交操作' };
  if (/\b(test|vitest|jest|cargo\s+(?:test|check|clippy)|npm\s+(?:test|run\s+(?:test|build|lint|typecheck))|pnpm\s+(?:test|build|lint|typecheck)|yarn\s+(?:test|build|lint|typecheck)|tsc|lint|verify|validate)\b/i.test(command)) {
    return { kind: 'verification', summary: 'Codex 执行验证操作' };
  }
  if (paths.length) return { kind: 'tool', summary: 'Codex 修改 ' + paths.length + ' 个项目路径' };
  return null;
}

function operationDetail(command) {
  const value = String(command).trim();
  if (!value || /^\*\*\* (?:Begin Patch|Add File|Update File|Delete File):?/m.test(value)) return null;
  return redact(value).replace(/\s+/g, ' ').slice(0, 1000);
}

function ownershipWarning(root, payload, paths) {
  if (!paths.length) return null;
  const current = findAssignedTask(root, payload);
  const index = readJsonSafe(statePath(root, 'plans', 'index.json')).value;
  const owners = [];
  for (const plan of (index?.plans || []).filter((item) => !['done', 'superseded'].includes(item.status))) {
    const directory = resolveLocalReference(root, plan.path);
    const document = directory ? readJsonSafe(path.join(directory, 'tasks.json')).value : null;
    for (const task of document?.tasks || []) {
      if (task.status === 'done' || current?.plan.id === plan.id && current?.task.id === task.id) continue;
      if (paths.some((file) => (task.ownedPaths || []).some((owned) => overlaps(file, owned)))) owners.push(plan.id + '/' + task.id + ' [' + (task.skills || []).join(', ') + ']');
    }
  }
  const runtimeConflicts = readRuntimeTasks(root).filter((task) => task.sessionId !== payload.session_id
    && paths.some((file) => (task.touchedFiles || []).some((touched) => overlaps(file, touched))));
  const parts = [];
  if (owners.length) parts.push('计划所有者：' + unique(owners).join(', '));
  if (runtimeConflicts.length) parts.push('其它运行中会话已修改这些路径');
  return parts.length ? 'Updeng 所有权提示：' + parts.join('；') + '。请重读最新文件，并由 integration owner 串行集成。' : null;
}

function validateCoreState(root) {
  const errors = [];
  for (const [label, filePath] of [
    ['config.json', statePath(root, 'config.json')],
    ['skills.json', statePath(root, 'skills.json')],
    ['plans/index.json', statePath(root, 'plans', 'index.json')],
    ['blockers.json', statePath(root, 'blockers.json')],
    ['metrics/index.json', statePath(root, 'metrics', 'index.json')],
    ['runtime/hooks.json', statePath(root, 'runtime', 'hooks.json')],
  ]) {
    const result = readJsonSafe(filePath);
    if (!result.ok) errors.push(label + ': ' + result.error);
  }
  const index = readJsonSafe(statePath(root, 'plans', 'index.json')).value;
  for (const plan of index?.plans || []) {
    const directory = resolveLocalReference(root, plan.path);
    if (!directory || !fs.existsSync(directory)) {
      errors.push(plan.id + ': plan directory is missing');
      continue;
    }
    for (const name of ['plan.md', 'tasks.json', 'operations.jsonl']) {
      if (!fs.existsSync(path.join(directory, name))) errors.push(plan.id + ': missing ' + name);
    }
    const tasksResult = readJsonSafe(path.join(directory, 'tasks.json'));
    if (!tasksResult.ok) {
      errors.push(plan.id + ': tasks.json is invalid');
      continue;
    }
    if (tasksResult.value?.schemaVersion !== 5 || !Array.isArray(tasksResult.value?.tasks)) {
      errors.push(plan.id + ': tasks.json 必须使用 plan-tasks schema v5');
      continue;
    }
    for (const task of tasksResult.value.tasks) {
      const label = plan.id + '/' + (task?.id || '<missing>');
      validateHookTaskCapsule(task, label, errors);
      validateHookTaskDocumentation(root, task, label, errors);
    }
  }
  return errors;
}

function validateHookTaskCapsule(task, label, errors) {
  if (!task || !['low', 'medium', 'high', 'critical'].includes(task.risk)
    || !Array.isArray(task.references) || !Array.isArray(task.doNotTouch)
    || typeof task.rollback !== 'string' || !task.rollback.trim()) {
    errors.push(label + ': task capsule 无效');
    return;
  }
  if (['review', 'done'].includes(task.status)
    && (!task.references.length || !task.doNotTouch.length || taskCapsuleIsProvisional(task))) {
    errors.push(label + ': review/done 前必须完成 references、doNotTouch 和 rollback');
  }
}

function validateHookTaskDocumentation(root, task, label, errors) {
  const documentation = task?.documentation;
  const checks = Array.isArray(task?.verification?.checks)
    ? task.verification.checks.filter((item) => item?.kind === 'documentation')
    : [];
  if (!documentation || !['pending', 'required', 'none'].includes(documentation.impact) || !Array.isArray(documentation.paths)) {
    errors.push(label + ': documentation state is invalid');
    return;
  }
  if (checks.length !== 1 || checks[0].required !== true || checks[0].command !== null) {
    errors.push(label + ': exactly one required documentation check is needed');
    return;
  }
  if (documentation.impact === 'pending') {
    if (documentation.paths.length || documentation.reason !== null || checks[0].status !== 'pending') errors.push(label + ': pending documentation state is inconsistent');
    if (['review', 'done'].includes(task.status)) errors.push(label + ': review/done task has unresolved documentation impact');
    return;
  }
  if (documentation.impact === 'none' && (documentation.paths.length || typeof documentation.reason !== 'string' || !documentation.reason.trim())) {
    errors.push(label + ': no-impact documentation state needs an explicit reason and no paths');
  }
  if (documentation.impact === 'required') {
    if (!documentation.paths.length) errors.push(label + ': required documentation state has no paths');
    for (const entry of documentation.paths) {
      const filePath = typeof entry === 'string' && /^\.updeng\/docs\/(?:business|integrations)\/.+/.test(entry)
        ? resolveLocalReference(root, entry)
        : null;
      if (!filePath || (['review', 'done'].includes(task.status) || checks[0].status === 'passed') && !isRegularFile(filePath)) {
        errors.push(label + ': documented file is invalid or missing: ' + String(entry));
      }
    }
  }
  if (['review', 'done'].includes(task.status) && checks[0].status !== 'passed') errors.push(label + ': review/done task needs a passed documentation check');
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readConfig(root) {
  return readJsonSafe(statePath(root, 'config.json')).value || {
    metrics: { captureConversations: true, redactSecrets: true, maxMessageChars: 200000 },
    runtime: { staleAfterMinutes: 30, pruneAfterHours: 24 },
  };
}

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function emit(value) {
  process.stdout.write(JSON.stringify(value));
}

function contextOutput(event, context) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}

function findProjectRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.codex', 'updeng.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveStateLocation(root) {
  const projectRoot = realPath(root);
  const topLevel = gitOutput(projectRoot, ['rev-parse', '--show-toplevel']);
  const commonValue = gitOutput(projectRoot, ['rev-parse', '--git-common-dir']);
  if (topLevel && commonValue) {
    const gitRoot = path.resolve(topLevel);
    const relative = path.relative(gitRoot, projectRoot);
    if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
      const relativeRoot = String(relative || '.').replaceAll('\\', '/');
      const hash = crypto.createHash('sha256').update(relativeRoot).digest('hex').slice(0, 12);
      const label = relativeRoot === '.' ? 'root' : slugify(relativeRoot);
      const commonDir = path.isAbsolute(commonValue) ? path.resolve(commonValue) : path.resolve(projectRoot, commonValue);
      return { projectRoot, visibleRoot: path.join(projectRoot, '.updeng'), stateRoot: path.join(commonDir, 'updeng', label + '-' + hash), shared: true };
    }
  }
  return { projectRoot, visibleRoot: path.join(projectRoot, '.updeng'), stateRoot: path.join(projectRoot, '.updeng'), shared: false };
}

function ensureStateAccess(root) {
  const location = resolveStateLocation(root);
  fs.mkdirSync(location.stateRoot, { recursive: true });
  if (location.shared) {
    if (pathEntryExists(location.visibleRoot)) {
      const target = fs.realpathSync.native(location.visibleRoot);
      if (!samePath(target, location.stateRoot)) throw new Error('.updeng does not point to shared state ' + location.stateRoot);
    } else {
      fs.symlinkSync(location.stateRoot, location.visibleRoot, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  if (!fs.existsSync(path.join(location.stateRoot, 'config.json'))) throw new Error('Shared Updeng state is not initialized. Run updeng init in the local checkout.');
  return location;
}

function statePath(root, ...segments) {
  return path.join(resolveStateLocation(root).stateRoot, ...segments);
}

function resolveLocalReference(root, value) {
  if (typeof value !== 'string' || !value.startsWith('.updeng/')) return null;
  const stateRoot = resolveStateLocation(root).stateRoot;
  const target = path.resolve(stateRoot, value.slice('.updeng/'.length));
  const relative = path.relative(stateRoot, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  return target;
}

function collectPaths(root, toolInput, command) {
  const raw = extractPaths(toolInput);
  raw.push(...[...String(command).matchAll(/(?:^|[\s"'])(\.updeng[\\/][A-Za-z0-9._\\/-]+)/g)].map((match) => match[1]));
  return unique(raw.map((value) => normalizeRelative(root, value)).filter(Boolean));
}

function extractPaths(toolInput) {
  const paths = [];
  if (toolInput && typeof toolInput === 'object') {
    for (const key of ['file_path', 'path', 'notebook_path']) if (typeof toolInput[key] === 'string') paths.push(toolInput[key]);
    for (const key of ['input', 'patch']) if (typeof toolInput[key] === 'string') paths.push(...extractPatchPaths(toolInput[key]));
  } else if (typeof toolInput === 'string') paths.push(...extractPatchPaths(toolInput));
  return paths;
}

function extractPatchPaths(value) {
  const pattern = /\*\*\* (?:Add|Update|Delete) File:\s+(.+?)(?=\r?\n|(?<!\\)(?:\\r\\n|\\n)|$)/g;
  return [...String(value).matchAll(pattern)].map((match) => match[1].trim().replaceAll('\\\\', '\\').replaceAll('\\"', '"'));
}

function normalizeRelative(root, value) {
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  return relative.replaceAll('\\', '/') || '.';
}

function commandText(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (!toolInput || typeof toolInput !== 'object') return '';
  return String(toolInput.command || toolInput.cmd || '');
}

function toolSucceeded(response) {
  if (response && typeof response === 'object') {
    if (response.is_error === true || response.success === false || response.error) return false;
    const code = response.exit_code ?? response.exitCode ?? response.code;
    if (Number.isInteger(code)) return code === 0;
  }
  return true;
}

function overlaps(left, right) {
  const a = String(left).replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
  const b = String(right).replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
  return a === '.' || b === '.' || a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

function checkoutExecution(root) {
  const gitDir = gitOutput(root, ['rev-parse', '--git-dir']);
  const common = gitOutput(root, ['rev-parse', '--git-common-dir']);
  if (!gitDir || !common) return 'local';
  return samePath(path.resolve(root, gitDir), path.resolve(root, common)) ? 'local' : 'worktree';
}

function worktreesAvailable(root) {
  return gitOutput(root, ['rev-parse', '--is-inside-work-tree']) === 'true'
    && gitOutput(root, ['rev-parse', '--verify', 'HEAD']) !== null;
}

function gitOutput(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function readJsonSafe(filePath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { ok: false, value: null, error: error.message };
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, filePath);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function withFileLock(lockPath, action) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const wait = new Int32Array(new SharedArrayBuffer(4));
  let handle;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      handle = fs.openSync(lockPath, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 120000) fs.rmSync(lockPath, { force: true });
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      Atomics.wait(wait, 0, 0, 50);
    }
  }
  if (handle === undefined) throw new Error('Updeng state is busy');
  try {
    return action();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lockPath, { force: true });
  }
}

function safeRegex(value) {
  try {
    return new RegExp(value, 'i');
  } catch {
    return /$a/;
  }
}

function firstLine(value, limit) {
  return String(value).split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, limit) || 'Codex task';
}

function slugify(value) {
  return String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
}

function realPath(value) {
  try {
    return fs.realpathSync.native(path.resolve(value));
  } catch {
    return path.resolve(value);
  }
}

function pathEntryExists(value) {
  try {
    fs.lstatSync(value);
    return true;
  } catch {
    return false;
  }
}

function samePath(left, right) {
  const a = path.resolve(left).replaceAll('\\', '/');
  const b = path.resolve(right).replaceAll('\\', '/');
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function unique(values) {
  return [...new Set(values)];
}

function higherRisk(left, right) {
  const levels = ['low', 'medium', 'high', 'critical'];
  return levels[Math.max(levels.indexOf(left), levels.indexOf(right), 0)];
}
