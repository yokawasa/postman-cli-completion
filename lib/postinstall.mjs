#!/usr/bin/env node
// Postinstall version-drift notice.
//
// Runs once, right after `npm i -g postman-cli-completion`, and tells the user
// if their installed Postman CLI does not match the version these completions
// were generated for. That moment is the useful one: the user is already doing
// package management, so an "upgrade this" message is actionable.
//
// Hard rules for this file, because postinstall scripts are bad neighbours:
//
//   1. NEVER fail the install. Every path exits 0, including unexpected throws.
//   2. NEVER touch the network. A registry lookup here is exactly the kind of
//      postinstall behaviour people (rightly) disable; the offline comparison
//      already catches the common case. `doctor` does the online check on
//      demand.
//   3. Say nothing when there is nothing to say, and stay quiet in CI and other
//      non-interactive installs.
//
// The online "is my CLI older than npm latest?" check lives in `doctor`.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersions } from "./version-check.mjs";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Should we stay silent regardless of what the versions say?
 *
 * Suppressed for:
 *  - an explicit opt-out
 *  - CI (the notice is for humans; it would just be log noise)
 *  - a non-TTY stderr, which also covers piped/scripted installs
 *  - local (non-global) installs: this package is a global CLI helper, so a
 *    local install is usually a dependency graph artifact, not a user choice
 */
export function shouldSuppress(env = process.env, isTTY = process.stderr.isTTY) {
  if (env.POSTMAN_COMPLETION_NO_VERSION_CHECK === "1") return true;
  if (env.CI && env.CI !== "false") return true;
  if (env.npm_config_global !== "true") return true;
  return !isTTY;
}

/** Wrap the drift lines in a visually distinct block so it is not lost in npm's output. */
export function formatNotice(lines) {
  const body = lines.map((l) => `  ${l}`).join("\n");
  return `\npostman-cli-completion:\n${body}\n\n  Silence this check with POSTMAN_COMPLETION_NO_VERSION_CHECK=1\n`;
}

async function main() {
  if (shouldSuppress()) return;

  const report = await checkVersions({
    specPath: resolve(PKG_ROOT, "spec/commands.json"),
    packageJsonPath: resolve(PKG_ROOT, "package.json"),
    offline: true, // rule 2: no network during install
    timeoutMs: 3000, // keep the install snappy even if the CLI hangs
  });

  // Only speak up about real, actionable drift. A matching version, a missing
  // CLI, or an undeterminable one are all silent: a fresh `npm i -g` of this
  // package should not lecture someone who has not installed the CLI yet.
  if (!report.drifted) return;

  process.stderr.write(formatNotice(report.lines));
}

// Only run when invoked as the postinstall script, not when imported by tests.
// (Matches the isMainModule guard in scripts/generate.mjs.)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  // Rule 1: an install must never fail because of this notice.
  try {
    await main();
  } catch {
    // Intentionally silent — a broken notice is not worth a failed install.
  }
  process.exit(0);
}
