#!/usr/bin/env node
import { readFileSync } from "node:fs";

// Load-bearing commands that have never been renamed upstream. If one of these
// vanishes, introspection almost certainly broke (bad install, unparseable help)
// rather than Postman having dropped it — always fail.
const CORE_COMMANDS = [
  "login", "logout", "collection", "api", "spec", "request",
];

// Commands we expect but that upstream may legitimately rename or retire, e.g.
// v1.71.0 renamed `simulate` → `simulation` (issue #59). A miss here only fails
// when the spec also looks unhealthy overall; otherwise it is reported as a
// warning so a real upstream rename does not block the catch-up PR.
const EXPECTED_COMMANDS = [
  "runner", "monitor", "workspace", "performance", "flows",
  "sdk", "mock", "application", "simulation",
];

const FLAG_DROP_THRESHOLD = 0.3;

// A rename swaps one command for another, so a healthy spec keeps roughly the
// same breadth. Tolerate a single net loss to absorb a retirement.
const COMMAND_DROP_TOLERANCE = 1;

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
  const warnings = [];

  if (cmpSemver(newSpec.postmanCliVersion, oldSpec.postmanCliVersion) < 0) {
    errors.push(`version regression: ${oldSpec.postmanCliVersion} → ${newSpec.postmanCliVersion}`);
  }

  const oldCmds = oldSpec.commands?.length || 0;
  const newCmds = newSpec.commands?.length || 0;
  const commandsHealthy = newCmds >= oldCmds - COMMAND_DROP_TOLERANCE;
  if (!commandsHealthy) {
    errors.push(`top-level command count decreased: ${oldCmds} → ${newCmds}`);
  }

  const oldCount = countFlags(oldSpec);
  const newCount = countFlags(newSpec);
  const flagsHealthy =
    oldCount === 0 || (oldCount - newCount) / oldCount < FLAG_DROP_THRESHOLD;
  if (!flagsHealthy) {
    errors.push(
      `flag count dropped ${oldCount} → ${newCount} (≥${Math.round(FLAG_DROP_THRESHOLD * 100)}%)`
    );
  }

  // Only trust the "this is a rename, not a breakage" reading while the spec is
  // otherwise intact; a collapsed spec must still fail loudly.
  const specHealthy = commandsHealthy && flagsHealthy;

  const newNames = new Set((newSpec.commands || []).map((c) => c.name));
  for (const name of CORE_COMMANDS) {
    if (!newNames.has(name)) errors.push(`core command missing: ${name}`);
  }
  for (const name of EXPECTED_COMMANDS) {
    if (newNames.has(name)) continue;
    const msg = `expected command missing: ${name}`;
    if (specHealthy) {
      const oldNames = new Set((oldSpec.commands || []).map((c) => c.name));
      const added = [...newNames].filter((n) => !oldNames.has(n));
      warnings.push(
        `${msg} (spec otherwise healthy — likely renamed or retired upstream` +
        `${added.length ? `; new commands: ${added.join(", ")}` : ""})`
      );
    } else {
      errors.push(msg);
    }
  }

  for (const w of warnings) process.stderr.write(`validate-diff warning: ${w}\n`);

  if (errors.length) {
    process.stderr.write("validate-diff failed:\n");
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `validate-diff OK (${oldSpec.postmanCliVersion} → ${newSpec.postmanCliVersion}; ` +
    `${oldCmds} → ${newCmds} commands; ${oldCount} → ${newCount} flags` +
    `${warnings.length ? `; ${warnings.length} warning(s)` : ""})\n`
  );
}

main();
