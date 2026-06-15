#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitZsh } from "./emitters/zsh.mjs";
import { emitBash } from "./emitters/bash.mjs";
import { emitFish } from "./emitters/fish.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = resolve(REPO_ROOT, "spec/commands.json");
const OVERRIDES_PATH = resolve(REPO_ROOT, "spec/overrides.json");

const TARGETS = [
  { emit: emitZsh,  path: resolve(REPO_ROOT, "completions/zsh/_postman") },
  { emit: emitBash, path: resolve(REPO_ROOT, "completions/bash/postman.bash") },
  { emit: emitFish, path: resolve(REPO_ROOT, "completions/fish/postman.fish") },
];

function loadSpec() {
  const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  const overrides = existsSync(OVERRIDES_PATH)
    ? JSON.parse(readFileSync(OVERRIDES_PATH, "utf8"))
    : {};
  return applyOverrides(spec, overrides);
}

export function applyOverrides(spec, overrides) {
  const merged = structuredClone(spec);
  for (const [path, ov] of Object.entries(overrides)) {
    if (path.startsWith("_")) continue;
    const cmd = path === "global" ? merged.global : resolvePath(merged, path);
    if (!cmd) {
      process.stderr.write(`warning: overrides path not found: ${path}\n`);
      continue;
    }
    cmd.flags ||= [];
    if (ov.dynamicFlags) {
      for (const [template, dyn] of Object.entries(ov.dynamicFlags)) {
        const idx = cmd.flags.findIndex((f) => f.long === template);
        if (idx >= 0) cmd.flags.splice(idx, 1);
        for (const long of dyn.expansions || []) {
          const flag = {
            long,
            valueType: dyn.valueType || "none",
            description: dyn.description || "",
          };
          if (dyn.patterns) flag.patterns = dyn.patterns;
          if (dyn.valueType && dyn.valueType !== "none") {
            flag.valueName = dyn.valueName || "value";
          }
          cmd.flags.push(flag);
        }
      }
    }
    if (ov.enumChoices) {
      for (const [long, choices] of Object.entries(ov.enumChoices)) {
        const f = cmd.flags.find((f) => f.long === long);
        if (f) {
          f.valueType = "enum";
          f.choices = choices;
        }
      }
    }
  }
  return merged;
}

function resolvePath(spec, path) {
  const parts = path.split("/");
  let cursor = { subcommands: spec.commands };
  for (const part of parts) {
    cursor = (cursor.subcommands || []).find((c) => c.name === part);
    if (!cursor) return null;
  }
  return cursor;
}

function diff(a, b) {
  if (a === b) return null;
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
    if (aLines[i] !== bLines[i]) {
      return { line: i + 1, expected: aLines[i], actual: bLines[i] };
    }
  }
  return null;
}

function main() {
  const check = process.argv.includes("--check");
  const spec = loadSpec();
  let failed = false;

  for (const t of TARGETS) {
    const out = t.emit(spec);
    if (check) {
      const cur = existsSync(t.path) ? readFileSync(t.path, "utf8") : "";
      const d = diff(out, cur);
      if (d) {
        process.stderr.write(`drift: ${t.path}\n  line ${d.line}:\n  - expected: ${JSON.stringify(d.expected)}\n  - actual:   ${JSON.stringify(d.actual)}\n`);
        failed = true;
      }
    } else {
      writeFileSync(t.path, out);
      process.stderr.write(`wrote ${t.path}\n`);
    }
  }

  if (failed) process.exit(1);
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) main();
