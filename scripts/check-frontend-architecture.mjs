#!/usr/bin/env node
// @author kongweiguang

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCHEMA_VERSION = 1;
const DEFAULT_BASELINE = "scripts/frontend-architecture-baseline.json";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_SUPPORT_SEGMENTS = new Set([
  "__fixtures__",
  "__tests__",
  "test-support",
  "testSupport",
]);
const EXPLICIT_PLATFORM_ADAPTERS = new Set([
  "src/lib/appLog.ts",
  "src/lib/desktopPlatform.ts",
  "src/lib/nativeContextMenu.ts",
  "src/lib/useTauriWindowFrameState.ts",
  "src/lib/windowActions.ts",
]);
const OWNERSHIP = Object.freeze({
  "cross-feature-private-import": {
    owner: "frontend-architecture",
    targetTask: "TASK-020",
  },
  "feature-to-app": {
    owner: "frontend-architecture",
    targetTask: "TASK-020",
  },
  "lib-to-feature": {
    owner: "frontend-architecture",
    targetTask: "TASK-020",
  },
  "production-test-support-import": {
    owner: "test-architecture",
    targetTask: "TASK-022",
  },
  "tauri-outside-adapter": {
    owner: "runtime-adapters",
    targetTask: "TASK-021",
  },
});

try {
  main();
} catch (error) {
  console.error(`Frontend architecture configuration error: ${messageOf(error)}`);
  process.exitCode = 2;
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = options.repoRoot
    ? path.resolve(process.cwd(), options.repoRoot)
    : defaultRoot;
  const baselinePath = resolveFromRepo(
    repoRoot,
    options.baseline ?? DEFAULT_BASELINE,
  );
  const analysis = analyzeRepository(repoRoot);
  const previous = existsSync(baselinePath)
    ? readBaseline(baselinePath, "current")
    : null;

  if (options.writeBaseline) {
    const next = buildBaseline(analysis.violations, previous);
    writeJson(baselinePath, next);
    console.log(
      `Updated frontend architecture baseline: ${displayPath(repoRoot, baselinePath)} (${next.entries.length} entries).`,
    );
  }
  if (!existsSync(baselinePath)) {
    throw new Error(
      `baseline does not exist: ${displayPath(repoRoot, baselinePath)}; bootstrap it with --write-baseline`,
    );
  }

  const baseline = readBaseline(baselinePath, "current");
  const reference = resolveReferenceBaseline(repoRoot, baselinePath, options);
  const report = evaluate(analysis, baseline, reference);
  if (options.output) writeJson(resolveFromRepo(repoRoot, options.output), report);
  printReport(report);
  if (!report.pass) process.exitCode = 1;
}

function parseOptions(args) {
  const options = {
    baseline: null,
    output: null,
    referenceBaseline:
      process.env.KERMINAL_FRONTEND_ARCHITECTURE_REFERENCE_BASELINE?.trim() ||
      null,
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

function analyzeRepository(repoRoot) {
  const sourceRoot = path.join(repoRoot, "src");
  const absoluteFiles = collectSourceFiles(sourceRoot);
  const files = new Set(absoluteFiles.map((file) => normalizeAbsolute(file)));
  const dependencies = [];
  for (const absoluteFile of absoluteFiles) {
    const source = relativePath(repoRoot, absoluteFile);
    if (!isProductionSource(source)) continue;
    const sourceFile = ts.createSourceFile(
      absoluteFile,
      readFileSync(absoluteFile, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      absoluteFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const dependency of collectDependencies(sourceFile)) {
      dependencies.push({
        ...dependency,
        source,
        target: resolveLocalTarget(
          repoRoot,
          absoluteFile,
          dependency.specifier,
          files,
        ),
      });
    }
  }
  const violations = dependencies
    .flatMap(classifyDependency)
    .sort(compareViolation)
    .filter((entry, index, entries) =>
      index === 0 || violationKey(entry) !== violationKey(entries[index - 1]),
    );
  return {
    dependencies: dependencies.length,
    files: absoluteFiles.filter((file) =>
      isProductionSource(relativePath(repoRoot, file)),
    ).length,
    runtimeCycles: findRuntimeCycles(dependencies),
    violations,
  };
}

function collectSourceFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolute));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function collectDependencies(sourceFile) {
  const dependencies = [];
  const add = (specifier, kind, runtime) => {
    if (typeof specifier === "string" && specifier) {
      dependencies.push({ kind, runtime, specifier });
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(
        node.moduleSpecifier.text,
        "import",
        importDeclarationHasRuntimeValue(node),
      );
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(
        node.moduleSpecifier.text,
        "export",
        exportDeclarationHasRuntimeValue(node),
      );
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression.text, "import-equals", !node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add(node.arguments[0].text, "dynamic-import", true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return dependencies;
}

function importDeclarationHasRuntimeValue(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationHasRuntimeValue(node) {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function resolveLocalTarget(repoRoot, sourceFile, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null;
  const resolution = ts.resolveModuleName(
    specifier,
    sourceFile,
    {
      allowImportingTsExtensions: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (resolution && knownFiles.has(normalizeAbsolute(resolution))) {
    return relativePath(repoRoot, resolution);
  }
  const unresolved = path.resolve(path.dirname(sourceFile), specifier);
  for (const candidate of [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    path.join(unresolved, "index.ts"),
    path.join(unresolved, "index.tsx"),
  ]) {
    if (knownFiles.has(normalizeAbsolute(candidate))) {
      return relativePath(repoRoot, candidate);
    }
  }
  return null;
}

function classifyDependency(dependency) {
  const violations = [];
  const sourceFeature = featureName(dependency.source);
  const targetFeature = featureName(dependency.target);
  if (sourceFeature && dependency.target?.startsWith("src/app/")) {
    violations.push(asViolation("feature-to-app", dependency));
  }
  if (
    dependency.source.startsWith("src/lib/") &&
    dependency.target?.startsWith("src/features/")
  ) {
    violations.push(asViolation("lib-to-feature", dependency));
  }
  if (
    sourceFeature &&
    targetFeature &&
    sourceFeature !== targetFeature &&
    !isPublicFeatureEntry(dependency.target)
  ) {
    violations.push(asViolation("cross-feature-private-import", dependency));
  }
  if (
    dependency.specifier.startsWith("@tauri-apps/") &&
    !isPlatformAdapter(dependency.source)
  ) {
    violations.push(asViolation("tauri-outside-adapter", dependency));
  }
  if (
    dependency.target &&
    isTestSupportPath(dependency.target) &&
    isProductionSource(dependency.source)
  ) {
    violations.push(asViolation("production-test-support-import", dependency));
  }
  return violations;
}

function asViolation(rule, dependency) {
  return {
    kind: dependency.kind,
    rule,
    runtime: dependency.runtime,
    source: dependency.source,
    specifier: dependency.specifier,
    target: dependency.target,
  };
}

function featureName(file) {
  return file?.match(/^src\/features\/([^/]+)\//)?.[1] ?? null;
}

function isPublicFeatureEntry(file) {
  return /\/index\.tsx?$/.test(file);
}

function isPlatformAdapter(file) {
  return (
    /^src\/lib\/[^/]*Api(?:\.[^/]+)?\.tsx?$/.test(file) ||
    EXPLICIT_PLATFORM_ADAPTERS.has(file)
  );
}

function isTestSupportPath(file) {
  const segments = file.split("/");
  return (
    segments.some((segment) => TEST_SUPPORT_SEGMENTS.has(segment)) ||
    /\.testSupport\.tsx?$/.test(file) ||
    /\.(?:test|spec)\.tsx?$/.test(file)
  );
}

function isProductionSource(file) {
  return file.startsWith("src/") && !isTestSupportPath(file);
}

function findRuntimeCycles(dependencies) {
  const adjacency = new Map();
  for (const dependency of dependencies) {
    if (!dependency.runtime || !dependency.target) continue;
    const targets = adjacency.get(dependency.source) ?? new Set();
    targets.add(dependency.target);
    adjacency.set(dependency.source, targets);
    if (!adjacency.has(dependency.target)) adjacency.set(dependency.target, new Set());
  }
  const components = stronglyConnectedComponents(adjacency);
  return components
    .filter(
      (component) =>
        component.length > 1 || adjacency.get(component[0])?.has(component[0]),
    )
    .map((component) => findCyclePath(component, adjacency))
    .sort((left, right) => left.join("|").localeCompare(right.join("|")));
}

function stronglyConnectedComponents(adjacency) {
  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const stacked = new Set();
  const components = [];
  const visit = (node) => {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    stacked.add(node);
    for (const target of [...(adjacency.get(node) ?? [])].sort()) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (stacked.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(target)));
      }
    }
    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      stacked.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component.sort());
  };
  for (const node of [...adjacency.keys()].sort()) {
    if (!indexes.has(node)) visit(node);
  }
  return components;
}

function findCyclePath(component, adjacency) {
  const members = new Set(component);
  const start = component[0];
  const search = (node, pathSoFar, visited) => {
    for (const target of [...(adjacency.get(node) ?? [])].sort()) {
      if (!members.has(target)) continue;
      if (target === start) return [...pathSoFar, start];
      if (visited.has(target)) continue;
      const next = search(target, [...pathSoFar, target], new Set([...visited, target]));
      if (next) return next;
    }
    return null;
  };
  return search(start, [start], new Set([start])) ?? [...component, start];
}

function buildBaseline(violations, previous) {
  const previousByKey = new Map(
    (previous?.entries ?? []).map((entry) => [violationKey(entry), entry]),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: violations.map((violation) => {
      const old = previousByKey.get(violationKey(violation));
      const ownership = old ?? {
        deadline: "before TASK-080",
        ...OWNERSHIP[violation.rule],
      };
      return {
        ...violation,
        deadline: ownership.deadline,
        owner: ownership.owner,
        targetTask: ownership.targetTask,
      };
    }),
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
    const key = violationKey(entry);
    if (!OWNERSHIP[entry?.rule] || !entry.source || !entry.specifier || !entry.kind) {
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

function resolveReferenceBaseline(repoRoot, baselinePath, options) {
  if (options.referenceBaseline) {
    return readBaseline(
      resolveFromRepo(repoRoot, options.referenceBaseline),
      "reference",
    );
  }
  const githubReference = readGitHubReferenceFile(
    repoRoot,
    relativePath(repoRoot, baselinePath),
  );
  if (!githubReference) return null;
  const value = JSON.parse(githubReference);
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
    analysis.violations.map((entry) => [violationKey(entry), entry]),
  );
  const baselineByKey = new Map(
    baseline.entries.map((entry) => [violationKey(entry), entry]),
  );
  const newDebt = analysis.violations.filter(
    (entry) => !baselineByKey.has(violationKey(entry)),
  );
  const staleBaseline = baseline.entries.filter(
    (entry) => !currentByKey.has(violationKey(entry)),
  );
  const referenceKeys = new Set(
    (reference?.entries ?? []).map((entry) => violationKey(entry)),
  );
  const referenceRegressions = reference
    ? baseline.entries
        .filter((entry) => !referenceKeys.has(violationKey(entry)))
        .map((entry) => ({ ...entry, reason: "new-baseline-debt" }))
    : [];
  return {
    ...analysis,
    newDebt,
    pass:
      analysis.runtimeCycles.length === 0 &&
      newDebt.length === 0 &&
      staleBaseline.length === 0 &&
      referenceRegressions.length === 0,
    referenceRegressions,
    staleBaseline,
  };
}

function printReport(report) {
  console.log(
    `Frontend architecture: ${report.files} production files, ${report.dependencies} dependencies.`,
  );
  console.log(`Runtime cycles: ${report.runtimeCycles.length}`);
  console.log(`Architecture debt: ${report.violations.length}`);
  printCycles(report.runtimeCycles);
  printViolations("New architecture debt", report.newDebt);
  printViolations("Stale architecture baseline", report.staleBaseline);
  printViolations("Architecture baseline regressed", report.referenceRegressions);
  if (report.pass) {
    console.log("Frontend architecture ratchet passed; runtime cycle count remains zero.");
  }
}

function printCycles(cycles) {
  if (cycles.length === 0) return;
  console.error("\nRuntime dependency cycles:");
  for (const cycle of cycles) console.error(cycle.join(" -> "));
}

function printViolations(title, violations) {
  if (violations.length === 0) return;
  console.error(`\n${title}:`);
  for (const entry of violations) {
    console.error(
      `${entry.rule}  ${entry.source} -> ${entry.target ?? entry.specifier} (${entry.kind}${entry.runtime ? ", runtime" : ", type-only"})${entry.reason ? ` [${entry.reason}]` : ""}`,
    );
  }
}

function compareViolation(left, right) {
  return violationKey(left).localeCompare(violationKey(right));
}

function violationKey(entry) {
  return [
    entry?.rule ?? "",
    entry?.source ?? "",
    entry?.target ?? "",
    entry?.specifier ?? "",
    entry?.kind ?? "",
    entry?.runtime ? "runtime" : "type-only",
  ].join("|");
}

function normalizeAbsolute(file) {
  const normalized = path.resolve(file).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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
