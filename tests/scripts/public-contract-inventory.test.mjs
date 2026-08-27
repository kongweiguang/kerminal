// @author kongweiguang

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const inventory = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/contracts/public-contract-inventory.json"),
    "utf8",
  ),
);

test("frontend literal invoke contract remains auditable against command registration", () => {
  const registry = fs.readFileSync(
    path.join(root, "src-tauri/src/commands/registry.rs"),
    "utf8",
  );
  const backendCommands = new Set(
    [...registry.matchAll(/crate::commands::[\w:]+::(\w+),/g)].map(
      (match) => match[1],
    ),
  );
  assert.equal(backendCommands.size, inventory.tauri.commandCount);

  const invokes = new Set();
  for (const file of sourceFiles(path.join(root, "src"))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "invoke" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        invokes.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const sortedInvokes = [...invokes].sort();
  assert.equal(sortedInvokes.length, inventory.tauri.frontendInvokeCount);
  assert.equal(
    fingerprint(sortedInvokes.join("\n")),
    inventory.tauri.frontendInvokeFingerprint,
  );
  assert.deepEqual(
    sortedInvokes.filter((command) => !backendCommands.has(command)),
    [],
  );
  for (const removedCommand of [
    "external_launch_alias_status",
    "external_launch_alias_generate",
    "external_launch_alias_delete",
    "external_launch_alias_open_directory",
  ]) {
    assert.equal(backendCommands.has(removedCommand), false);
    assert.equal(invokes.has(removedCommand), false);
  }
});

test("workspace session remains normalized to version 3", () => {
  const source = fs.readFileSync(
    path.join(root, "src/features/workspace/workspaceSession.ts"),
    "utf8",
  );
  assert.match(
    source,
    new RegExp(`WORKSPACE_SESSION_VERSION = ${inventory.workspaceSession.frontendVersion}`),
  );
});

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.tsx?$/.test(entry.name) ? [target] : [];
  });
}

function fingerprint(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
