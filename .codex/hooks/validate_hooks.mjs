#!/usr/bin/env node
// @author kongweiguang
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || process.cwd());
const configPath = path.join(root, '.codex', 'hooks.json');
const markerPath = path.join(root, '.codex', 'updeng.json');
const required = [
  'hook_runtime.mjs',
  'skill_forced_eval.mjs',
  'pre_tool_use.mjs',
  'workflow_event.mjs',
  'evolution_metrics.mjs',
  'validate_hooks.mjs',
];
const eventScripts = {
  SessionStart: 'workflow_event.mjs',
  UserPromptSubmit: 'skill_forced_eval.mjs',
  SubagentStart: 'workflow_event.mjs',
  PreToolUse: 'pre_tool_use.mjs',
  PostToolUse: 'workflow_event.mjs',
  SubagentStop: 'workflow_event.mjs',
  Stop: 'workflow_event.mjs',
};
const toolAliases = ['Bash', 'shell', 'apply_patch', 'functions.apply_patch', 'Edit', 'Write', 'NotebookEdit', 'exec_command', 'functions.exec', 'functions.exec_command'];
const errors = [];

let document = null;
if (!fs.existsSync(configPath)) errors.push('.codex/hooks.json is missing');
else {
  try {
    document = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    errors.push('.codex/hooks.json is invalid: ' + error.message);
  }
}

for (const [event, script] of Object.entries(eventScripts)) {
  const groups = document?.hooks?.[event];
  if (!Array.isArray(groups)) {
    errors.push('hooks.json is missing ' + event);
    continue;
  }
  const matching = groups.flatMap((group) => Array.isArray(group?.hooks) ? group.hooks : [])
    .filter((hook) => [hook?.command, hook?.commandWindows].some((command) => typeof command === 'string' && command.includes('.codex/hooks/' + script)));
  if (matching.length !== 1) errors.push(event + ' must contain exactly one Updeng ' + script + ' command');
}

for (const event of ['PreToolUse', 'PostToolUse']) {
  const matchers = (document?.hooks?.[event] || []).filter((group) => group?.hooks?.some((hook) => [hook?.command, hook?.commandWindows]
    .some((command) => typeof command === 'string' && command.includes('.codex/hooks/')))).map((group) => group.matcher || '');
  for (const alias of toolAliases) {
    if (!matchers.some((matcher) => matches(matcher, alias))) errors.push(event + ' matcher does not cover ' + alias);
  }
}

for (const name of required) {
  const script = path.join(root, '.codex', 'hooks', name);
  if (!fs.existsSync(script)) {
    errors.push('.codex/hooks/' + name + ' is missing');
    continue;
  }
  const checked = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8', windowsHide: true });
  if (checked.error || checked.status !== 0) errors.push(name + ' failed node --check: ' + (checked.error?.message || checked.stderr || checked.stdout).trim());
}

if (!fs.existsSync(markerPath)) errors.push('.codex/updeng.json is missing');
else {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (marker.schemaVersion !== 2) errors.push('.codex/updeng.json schemaVersion must be 2');
    if (JSON.stringify(marker.managedHookFiles) !== JSON.stringify(required)) errors.push('.codex/updeng.json managedHookFiles is stale');
  } catch (error) {
    errors.push('.codex/updeng.json is invalid: ' + error.message);
  }
}

process.stdout.write(JSON.stringify({ ok: errors.length === 0, root, errors }, null, 2) + '\n');
if (errors.length) process.exitCode = 1;

function matches(pattern, value) {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}
