#!/usr/bin/env node
// @author kongweiguang
import { runHook } from './hook_runtime.mjs';

runHook(['SessionStart', 'SubagentStart', 'PostToolUse', 'SubagentStop', 'Stop']);
