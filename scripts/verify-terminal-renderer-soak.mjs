#!/usr/bin/env node
// @author kongweiguang

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));
const durationMinutes = readPositiveNumber(
  args["duration-minutes"],
  30,
  "--duration-minutes",
);
const outputPath = path.resolve(
  repoRoot,
  args.output ??
    ".updeng/docs/verification/terminal-renderer-soak.json",
);
mkdirSync(path.dirname(outputPath), { recursive: true });
const startedAt = Date.now();
const result = await run(
  process.execPath,
  [
    "--expose-gc",
    "node_modules/vitest/vitest.mjs",
    "run",
    "--run",
    "--disableConsoleIntercept",
    "tests/frontend/features/terminal/terminalRendererContinuousSoak.test.ts",
  ],
  {
    ...process.env,
    TERMINAL_RENDERER_SOAK_DURATION_MS: String(durationMinutes * 60_000),
  },
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
const reportLine = result.stdout
  .concat("\n", result.stderr)
  .split(/\r?\n/)
  .find((line) => line.includes("TERMINAL_RENDERER_SOAK_REPORT="));
const generatedReport = readSoakReport(
  reportLine,
  Date.now() - startedAt,
);
const report = {
  ...generatedReport,
  requestedDurationMinutes: durationMinutes,
  pass: result.exitCode === 0 && generatedReport.pass === true,
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `Terminal renderer soak: ${report.pass ? "passed" : "failed"}, ${report.cycles ?? 0} continuous cycles.`,
);
console.log(`Report: ${path.relative(repoRoot, outputPath)}`);
process.exitCode = report.pass ? 0 : 1;

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const key = rawArgs[index];
    if (!key?.startsWith("--")) {
      continue;
    }
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key.slice(2)] = true;
      continue;
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function readPositiveNumber(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

/**
 * 即使 Vitest 在报告输出后的断言阶段失败，也保留已生成的 cycles/resource
 * 证据；最终 pass 仍由子进程退出码和报告自身共同判定，避免误报成功。
 */
function readSoakReport(reportLine, elapsedMs) {
  const fallback = {
    actualDurationMs: elapsedMs,
    cycles: 0,
    pass: false,
  };
  if (!reportLine) {
    return fallback;
  }
  const payload = reportLine.split("TERMINAL_RENDERER_SOAK_REPORT=")[1];
  if (!payload) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function run(command, commandArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const signalHandlers = new Map(
      ["SIGINT", "SIGTERM"].map((signal) => [
        signal,
        () => terminateChildTree(child, signal),
      ]),
    );
    for (const [signal, handler] of signalHandlers) {
      process.once(signal, handler);
    }
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (exitCode) => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
      resolve({ exitCode: exitCode ?? 1, stderr, stdout });
    });
  });
}

/**
 * soak 会再启动 Vitest worker；收到中断时终止整棵子进程树，避免长稳测试在
 * 调用 shell 退出后继续占用内存并污染下一轮发布验证。
 */
function terminateChildTree(child, signal) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
    });
    return;
  }
  child.kill(signal);
}
