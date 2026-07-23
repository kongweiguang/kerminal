#!/usr/bin/env node
// @author kongweiguang

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const SCHEMA_VERSION = 1;
const DEFAULT_BASELINE = "scripts/eslint-baseline.json";
const DEFAULT_CONFIG = "eslint.config.mjs";
const LINT_TARGETS = Object.freeze([
  "src",
  "tests/frontend",
  "vite.config.ts",
  "vitest.config.ts",
]);

try {
  await main();
} catch (error) {
  console.error(`ESLint gate configuration error: ${messageOf(error)}`);
  process.exitCode = 2;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = options.repoRoot
    ? path.resolve(process.cwd(), options.repoRoot)
    : defaultRoot;
  const baselinePath = resolveFromRepo(
    repoRoot,
    options.baseline ?? DEFAULT_BASELINE,
  );
  const configPath = resolveFromRepo(repoRoot, options.config ?? DEFAULT_CONFIG);
  const analysis = await analyze(repoRoot, configPath);
  const previous = existsSync(baselinePath)
    ? readBaseline(baselinePath, "current")
    : null;

  if (options.writeBaseline) {
    const next = buildBaseline(analysis.findings, previous);
    writeJson(baselinePath, next);
    console.log(
      `Updated ESLint baseline: ${displayPath(repoRoot, baselinePath)} (${next.entries.length} entries).`,
    );
  }
  if (!existsSync(baselinePath)) {
    throw new Error(
      `baseline does not exist: ${displayPath(repoRoot, baselinePath)}; bootstrap it with --write-baseline`,
    );
  }

  const baseline = readBaseline(baselinePath, "current");
  const reference = resolveReference(repoRoot, baselinePath, options);
  const report = evaluate(analysis, baseline, reference);
  if (options.output) writeJson(resolveFromRepo(repoRoot, options.output), report);
  printReport(report);
  if (!report.pass) process.exitCode = 1;
}

function parseOptions(args) {
  const options = {
    baseline: null,
    config: null,
    output: null,
    referenceBaseline: process.env.KERMINAL_ESLINT_REFERENCE_BASELINE?.trim() || null,
    repoRoot: null,
    writeBaseline: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--write-baseline") {
      options.writeBaseline = true;
      continue;
    }
    const key = {
      "--baseline": "baseline",
      "--config": "config",
      "--output": "output",
      "--reference-baseline": "referenceBaseline",
      "--repo-root": "repoRoot",
    }[argument];
    if (!key) throw new Error(`unknown argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

async function analyze(repoRoot, configPath) {
  if (!existsSync(configPath)) throw new Error(`ESLint config not found: ${configPath}`);
  const eslint = new ESLint({
    cwd: repoRoot,
    errorOnUnmatchedPattern: false,
    overrideConfigFile: configPath,
  });
  const results = await eslint.lintFiles(LINT_TARGETS);
  const grouped = new Map();
  const hardErrors = [];
  for (const result of results) {
    const file = relativePath(repoRoot, result.filePath);
    for (const finding of result.messages) {
      if (finding.fatal || !finding.ruleId) {
        hardErrors.push({
          column: finding.column ?? null,
          file,
          line: finding.line ?? null,
          message: finding.message,
        });
        continue;
      }
      const entry = {
        file,
        message: normalizeMessage(finding.message),
        rule: finding.ruleId,
      };
      const key = findingKey(entry);
      const current = grouped.get(key) ?? { ...entry, count: 0 };
      current.count += 1;
      grouped.set(key, current);
    }
  }
  return {
    files: results.length,
    findings: [...grouped.values()].sort(compareFinding),
    hardErrors: hardErrors.sort((left, right) =>
      `${left.file}|${left.line}`.localeCompare(`${right.file}|${right.line}`),
    ),
    messages: results.reduce((total, result) => total + result.messages.length, 0),
  };
}

function normalizeMessage(message) {
  return message.replaceAll(/\s+/g, " ").trim();
}

function buildBaseline(findings, previous) {
  const previousByKey = new Map(
    (previous?.entries ?? []).map((entry) => [findingKey(entry), entry]),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: findings.map((finding) => {
      const old = previousByKey.get(findingKey(finding));
      const ownership = old ?? ownershipFor(finding);
      return {
        ...finding,
        deadline: ownership.deadline,
        owner: ownership.owner,
        targetTask: ownership.targetTask,
      };
    }),
  };
}

function ownershipFor(finding) {
  if (finding.file.startsWith("tests/")) {
    return {
      deadline: "before TASK-080",
      owner: "test-architecture",
      targetTask: "TASK-071",
    };
  }
  if (finding.rule.startsWith("react-hooks/")) {
    return {
      deadline: "before TASK-080",
      owner: "frontend-react",
      targetTask: "TASK-070",
    };
  }
  if (finding.rule.startsWith("@typescript-eslint/")) {
    return {
      deadline: "before TASK-080",
      owner: "frontend-types",
      targetTask: "TASK-020/TASK-070",
    };
  }
  return {
    deadline: "before TASK-080",
    owner: "frontend-architecture",
    targetTask: "TASK-072",
  };
}

function readBaseline(filePath, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} baseline is not valid JSON: ${messageOf(error)}`);
  }
  validateBaseline(value, label);
  return value;
}

function validateBaseline(value, label) {
  if (!value || typeof value !== "object" || value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${label} baseline schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.entries)) {
    throw new Error(`${label} baseline entries must be an array`);
  }
  let previous = "";
  const seen = new Set();
  for (const entry of value.entries) {
    const key = findingKey(entry);
    if (
      !entry?.file ||
      !entry.rule ||
      !entry.message ||
      !Number.isInteger(entry.count) ||
      entry.count < 1
    ) {
      throw new Error(`${label} baseline contains an invalid entry`);
    }
    for (const field of ["deadline", "owner", "targetTask"]) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) {
        throw new Error(`${label} baseline entry ${key} is missing ${field}`);
      }
    }
    if (seen.has(key)) throw new Error(`${label} baseline contains duplicate: ${key}`);
    if (key.localeCompare(previous) < 0) {
      throw new Error(`${label} baseline entries must be sorted`);
    }
    seen.add(key);
    previous = key;
  }
}

function resolveReference(repoRoot, baselinePath, options) {
  if (options.referenceBaseline) {
    return readBaseline(
      resolveFromRepo(repoRoot, options.referenceBaseline),
      "reference",
    );
  }
  const content = readGitHubReferenceFile(
    repoRoot,
    relativePath(repoRoot, baselinePath),
  );
  if (!content) return null;
  const value = JSON.parse(content);
  validateBaseline(value, "reference");
  return value;
}

function readGitHubReferenceFile(repoRoot, relativeFile) {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    !process.env.GITHUB_EVENT_PATH ||
    !process.env.GITHUB_WORKSPACE ||
    path.resolve(process.env.GITHUB_WORKSPACE) !== path.resolve(repoRoot)
  ) {
    return null;
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  // tag force-push 的 before 是旧 tag 对象，不是可读取的提交基线。
  if (
    event.ref?.startsWith("refs/tags/") ||
    process.env.GITHUB_REF_TYPE === "tag"
  ) {
    return null;
  }
  const sha = event.pull_request?.base?.sha ?? event.before;
  if (!/^[0-9a-f]{40}$/i.test(sha ?? "") || /^0+$/.test(sha)) return null;
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`GitHub reference commit is unavailable: ${sha}`);
  }
  try {
    return execFileSync("git", ["show", `${sha}:${relativeFile}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function evaluate(analysis, baseline, reference) {
  const currentByKey = new Map(
    analysis.findings.map((entry) => [findingKey(entry), entry]),
  );
  const baselineByKey = new Map(
    baseline.entries.map((entry) => [findingKey(entry), entry]),
  );
  const newDebt = analysis.findings
    .filter((entry) => {
      const old = baselineByKey.get(findingKey(entry));
      return !old || entry.count > old.count;
    })
    .map((entry) => ({
      ...entry,
      baselineCount: baselineByKey.get(findingKey(entry))?.count ?? 0,
    }));
  const staleBaseline = baseline.entries
    .filter((entry) => currentByKey.get(findingKey(entry))?.count !== entry.count)
    .map((entry) => ({
      ...entry,
      currentCount: currentByKey.get(findingKey(entry))?.count ?? 0,
    }));
  const referenceByKey = new Map(
    (reference?.entries ?? []).map((entry) => [findingKey(entry), entry]),
  );
  const referenceRegressions = reference
    ? baseline.entries
        .filter((entry) => {
          const old = referenceByKey.get(findingKey(entry));
          return !old || entry.count > old.count;
        })
        .map((entry) => ({
          ...entry,
          referenceCount: referenceByKey.get(findingKey(entry))?.count ?? 0,
          reason: referenceByKey.has(findingKey(entry))
            ? "baseline-increased"
            : "new-baseline-debt",
        }))
    : [];
  return {
    ...analysis,
    newDebt,
    pass:
      analysis.hardErrors.length === 0 &&
      newDebt.length === 0 &&
      staleBaseline.length === 0 &&
      referenceRegressions.length === 0,
    referenceRegressions,
    staleBaseline,
  };
}

function printReport(report) {
  console.log(
    `ESLint gate: ${report.files} files, ${report.messages} messages, ${report.findings.length} debt entries.`,
  );
  printHardErrors(report.hardErrors);
  printFindings("New ESLint debt", report.newDebt, "baselineCount");
  printFindings("Stale ESLint baseline", report.staleBaseline, "currentCount");
  printFindings(
    "ESLint baseline regressed",
    report.referenceRegressions,
    "referenceCount",
  );
  if (report.pass) console.log("ESLint ratchet passed.");
}

function printHardErrors(entries) {
  if (entries.length === 0) return;
  console.error("\nUnbaselinable ESLint errors:");
  for (const entry of entries) {
    console.error(`${entry.file}:${entry.line ?? "?"}:${entry.column ?? "?"} ${entry.message}`);
  }
}

function printFindings(title, entries, comparisonField) {
  if (entries.length === 0) return;
  console.error(`\n${title}:`);
  for (const entry of entries) {
    const comparison =
      comparisonField && comparisonField in entry
        ? ` ${entry[comparisonField]} -> ${entry.count}`
        : "";
    console.error(
      `${entry.rule} ${entry.file}${comparison}: ${entry.message}${entry.reason ? ` [${entry.reason}]` : ""}`,
    );
  }
}

function compareFinding(left, right) {
  return findingKey(left).localeCompare(findingKey(right));
}

function findingKey(entry) {
  return [entry?.file ?? "", entry?.rule ?? "", entry?.message ?? ""].join("|");
}

function relativePath(repoRoot, file) {
  return path.relative(repoRoot, file).replaceAll("\\", "/");
}

function resolveFromRepo(repoRoot, file) {
  return path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
}

function displayPath(repoRoot, file) {
  const relative = relativePath(repoRoot, file);
  return relative.startsWith("../") ? file : relative;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
