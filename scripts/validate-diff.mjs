#!/usr/bin/env node
import { readFileSync } from "node:fs";

const FIXED_COMMANDS = [
  "login", "logout", "collection", "api", "runner", "spec",
  "monitor", "workspace", "performance", "flows", "request",
  "sdk", "mock", "application", "simulate",
];

const FLAG_DROP_THRESHOLD = 0.3;

function load(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function countFlags(spec) {
  let n = spec.global?.flags?.length || 0;
  function walk(node) {
    n += node.flags?.length || 0;
    for (const sc of node.subcommands || []) walk(sc);
  }
  for (const c of spec.commands || []) walk(c);
  return n;
}

function cmpSemver(a, b) {
  const pa = String(a).split(/[-.]/).map((x) => Number.isFinite(+x) ? +x : x);
  const pb = String(b).split(/[-.]/).map((x) => Number.isFinite(+x) ? +x : x);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0, bi = pb[i] ?? 0;
    if (typeof ai === "number" && typeof bi === "number") {
      if (ai !== bi) return ai - bi;
    } else {
      if (String(ai) !== String(bi)) return String(ai) < String(bi) ? -1 : 1;
    }
  }
  return 0;
}

function main() {
  const [, , oldPath, newPath] = process.argv;
  if (!oldPath || !newPath) {
    process.stderr.write("usage: validate-diff.mjs <old.json> <new.json>\n");
    process.exit(2);
  }
  const oldSpec = load(oldPath);
  const newSpec = load(newPath);
  const errors = [];

  if (cmpSemver(newSpec.postmanCliVersion, oldSpec.postmanCliVersion) < 0) {
    errors.push(`version regression: ${oldSpec.postmanCliVersion} → ${newSpec.postmanCliVersion}`);
  }

  if ((newSpec.commands?.length || 0) < (oldSpec.commands?.length || 0)) {
    errors.push(
      `top-level command count decreased: ${oldSpec.commands.length} → ${newSpec.commands.length}`
    );
  }

  const newNames = new Set((newSpec.commands || []).map((c) => c.name));
  for (const name of FIXED_COMMANDS) {
    if (!newNames.has(name)) errors.push(`fixed command missing: ${name}`);
  }

  const oldCount = countFlags(oldSpec);
  const newCount = countFlags(newSpec);
  if (oldCount > 0 && (oldCount - newCount) / oldCount >= FLAG_DROP_THRESHOLD) {
    errors.push(
      `flag count dropped ${oldCount} → ${newCount} (≥${Math.round(FLAG_DROP_THRESHOLD * 100)}%)`
    );
  }

  if (errors.length) {
    process.stderr.write("validate-diff failed:\n");
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `validate-diff OK (${oldSpec.postmanCliVersion} → ${newSpec.postmanCliVersion}; ${oldCount} → ${newCount} flags)\n`
  );
}

main();
