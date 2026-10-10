import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  stripAnsi, splitSections, parseEntries, parseFlag, parseCommandEntry,
} from "../scripts/introspect.mjs";
import { applyOverrides } from "../scripts/generate.mjs";
import { emitZsh } from "../scripts/emitters/zsh.mjs";
import { emitBash } from "../scripts/emitters/bash.mjs";
import { emitFish } from "../scripts/emitters/fish.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

const spec = JSON.parse(read("spec/commands.json"));
const overrides = JSON.parse(read("spec/overrides.json"));
const merged = applyOverrides(spec, overrides);

test("stripAnsi removes color codes", () => {
  const sample = "\x1b[33mhello\x1b[39m world";
  assert.equal(stripAnsi(sample), "hello world");
});

test("parseFlag — short + long with value", () => {
  const f = parseFlag("-e, --environment <path>");
  assert.equal(f.short, "-e");
  assert.equal(f.long, "--environment");
  assert.equal(f.valueName, "path");
  assert.equal(f.valueType, "file");
});

test("parseFlag — boolean long-only flag", () => {
  const f = parseFlag("--silent");
  assert.equal(f.long, "--silent");
  assert.equal(f.valueType, undefined);
});

test("parseFlag — optional value uses []", () => {
  const f = parseFlag("-r, --reporters [reporter]");
  assert.equal(f.short, "-r");
  assert.equal(f.long, "--reporters");
  assert.equal(f.valueOptional, true);
});

test("parseCommandEntry — alias-bearing command", () => {
  const c = parseCommandEntry({ head: "flows|fl", desc: "Manage and interact with flows." });
  assert.equal(c.name, "flows");
  assert.deepEqual(c.aliases, ["fl"]);
});

test("splitSections — Topics: pseudo-block in v1.39.0 context help leaks into Commands but only real names survive command filter", () => {
  const text = stripAnsi(read("tests/fixtures/help-context-v139.txt"));
  const s = splitSections(text);
  const COMMAND_NAME = /^[a-z][\w-]*$/;
  const heads = s.commands.map((e) => parseCommandEntry(e).name);
  const surviving = heads.filter((n) => n !== "help" && COMMAND_NAME.test(n));
  // `Topics:` is filtered (colon); `(none)` parses as continuation; `code-generation`
  // is missing entirely (single-space header). `discovery` and `maintenance` would
  // slip through the name filter — the second-line defense is the parent-help
  // cycle detector in introspectCommand, asserted separately.
  assert.ok(!surviving.includes("Topics:"));
  for (const real of ["instructions", "collection", "request", "folder", "response", "workspace", "environment"]) {
    assert.ok(surviving.includes(real), `missing real subcommand: ${real}`);
  }
});

test("splitSections — Usage and section bodies separated", () => {
  const text = stripAnsi(read("tests/fixtures/help-collection.txt"));
  const s = splitSections(text);
  assert.ok(s.usage.startsWith("postman collection"));
  assert.ok(s.commands.length >= 3);
  const names = s.commands.map((e) => e.head.split(/\s+/)[0]);
  assert.ok(names.includes("migrate"));
  assert.ok(names.includes("lint"));
  assert.ok(names.includes("run"));
});

test("parseEntries — deeply-indented --reporter-*-export captured as own entry", () => {
  const text = stripAnsi(read("tests/fixtures/help-collection-run.txt"));
  const s = splitSections(text);
  const heads = s.options.map((e) => e.head);
  assert.ok(heads.some((h) => h.startsWith("--reporter-[reporter]-export")));
  assert.ok(heads.some((h) => h.startsWith("--reporter-[reporter]-omitRequestBodies")));
});

test("introspect spec — postmanCliVersion is semver and required top-level commands are present", () => {
  assert.match(spec.postmanCliVersion, /^\d+\.\d+\.\d+/, "postmanCliVersion must be semver-like");
  const names = spec.commands.map((c) => c.name);
  for (const required of [
    "login", "logout", "collection", "api", "runner", "spec",
    "monitor", "workspace", "performance", "flows", "request",
    "sdk", "mock", "application", "simulation",
  ]) {
    assert.ok(names.includes(required), `missing top-level command: ${required}`);
  }
});

test("applyOverrides — --auth-<type>-<param> expanded into the override flag list", () => {
  const req = merged.commands.find((c) => c.name === "request");
  const auths = req.flags.filter((f) => f.long?.startsWith("--auth-"));
  const expected = overrides.request.dynamicFlags["--auth-<type>-<param>"].expansions;
  assert.equal(auths.length, expected.length);
  for (const long of expected) {
    assert.ok(auths.some((f) => f.long === long), `missing expansion: ${long}`);
  }
  assert.ok(!req.flags.some((f) => f.long === "--auth-<type>-<param>"));
});

function collectionRunFromHelp(fixture) {
  const flags = splitSections(stripAnsi(read(fixture))).options
    .map((entry) => parseFlag(entry.head)).filter(Boolean);
  const input = { commands: [{ name: "collection", subcommands: [{ name: "run", flags }] }] };
  return applyOverrides(input, { "collection/run": overrides["collection/run"] })
    .commands[0].subcommands[0];
}

test("applyOverrides — legacy --reporters has enum choices and dynamic reporter flags", () => {
  const run = collectionRunFromHelp("tests/fixtures/help-collection-run.txt");
  const rep = run.flags.find((f) => f.long === "--reporters");
  assert.equal(rep.valueType, "enum");
  assert.deepEqual(rep.choices, ["cli", "json", "junit", "html"]);
  for (const [template, dynamic] of Object.entries(overrides["collection/run"].dynamicFlags)) {
    assert.ok(!run.flags.some((f) => f.long === template));
    for (const long of dynamic.expansions) {
      assert.equal(run.flags.filter((f) => f.long === long).length, 1, long);
    }
  }
});

test("applyOverrides — v1.69.0 does not resurrect removed reporter flags (issue #58)", () => {
  const run = collectionRunFromHelp("tests/fixtures/help-collection-run-v169.txt");
  assert.ok(run.flags.some((f) => f.long === "--output" && f.valueName === "folder"));
  assert.ok(!run.flags.some((f) => f.long?.startsWith("--reporter")));
  assert.deepEqual(run.flags.find((f) => f.long === "--bail").choices, ["folder", "failure"]);
  const input = { postmanCliVersion: "1.69.0", global: { flags: [] },
    commands: [{ name: "collection", subcommands: [run] }] };
  for (const emit of [emitZsh, emitBash, emitFish]) {
    const output = emit(input);
    assert.doesNotMatch(output, /reporter/);
    assert.match(output, /output/);
  }
});

test("applyOverrides — global --color has enum choices", () => {
  const col = merged.global.flags.find((f) => f.long === "--color");
  assert.equal(col.valueType, "enum");
  assert.deepEqual(col.choices, ["auto", "on", "off"]);
});

test("snapshot — zsh emitter matches checked-in completions/zsh/_postman", () => {
  assert.equal(emitZsh(merged), read("completions/zsh/_postman"));
});

test("zsh emitter avoids single-alternative globs (regression: issue #15)", () => {
  // zsh reads a trailing parenthesized group as a glob qualifier, so
  // `_files -g "*.(json)"` errors and yields no completions. Single
  // extensions must be emitted as `*.json`.
  const zsh = emitZsh(merged);
  assert.match(zsh, /_files -g "\*\.json"/);
  assert.doesNotMatch(zsh, /_files -g "\*\.\([a-zA-Z.]+\)"/);
});

test("snapshot — bash emitter matches checked-in completions/bash/postman.bash", () => {
  assert.equal(emitBash(merged), read("completions/bash/postman.bash"));
});

test("snapshot — fish emitter matches checked-in completions/fish/postman.fish", () => {
  assert.equal(emitFish(merged), read("completions/fish/postman.fish"));
});

// --- validate-diff safety net (issue #59) ---------------------------------

function runValidateDiff(oldSpec, newSpec) {
  const dir = mkdtempSync(join(tmpdir(), "validate-diff-"));
  const oldPath = join(dir, "old.json");
  const newPath = join(dir, "new.json");
  writeFileSync(oldPath, JSON.stringify(oldSpec));
  writeFileSync(newPath, JSON.stringify(newSpec));
  const res = spawnSync(
    process.execPath,
    [resolve(ROOT, "scripts/validate-diff.mjs"), oldPath, newPath],
    { encoding: "utf8" }
  );
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, stderr: res.stderr };
}

// Minimal spec with enough flags that the 30% drop threshold is not tripped
// by the fixtures themselves.
function specWith(names, { version = "1.0.0", flagsPerCommand = 10 } = {}) {
  return {
    postmanCliVersion: version,
    global: { flags: [] },
    commands: names.map((name) => ({
      name,
      flags: Array.from({ length: flagsPerCommand }, (_, i) => ({ long: `--f${i}` })),
    })),
  };
}

const CORE = ["login", "logout", "collection", "api", "spec", "request"];
const EXPECTED = [
  "runner", "monitor", "workspace", "performance", "flows",
  "sdk", "mock", "application", "simulation",
];
const ALL = [...CORE, ...EXPECTED];

test("validate-diff — healthy upgrade passes", () => {
  const r = runValidateDiff(
    specWith(ALL, { version: "1.67.0" }),
    specWith(ALL, { version: "1.71.0" })
  );
  assert.equal(r.status, 0, r.stderr);
});

test("validate-diff — upstream rename of an expected command warns but passes (issue #59)", () => {
  // v1.71.0 renamed top-level `simulate` → `simulation`. Introspection was
  // fine, so the catch-up must not be blocked.
  const older = specWith([...CORE, ...EXPECTED.filter((n) => n !== "simulation"), "simulate"], {
    version: "1.67.0",
  });
  const newer = specWith([...ALL, "secret"], { version: "1.71.0" });
  const r = runValidateDiff(older, newer);
  assert.equal(r.status, 0, r.stderr);
});

test("validate-diff — missing expected command warns when spec is otherwise healthy", () => {
  const newer = specWith([...ALL.filter((n) => n !== "mock"), "mocking"]);
  const r = runValidateDiff(specWith(ALL), newer);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /warning: expected command missing: mock/);
});

test("validate-diff — missing core command always fails, even if spec looks healthy", () => {
  const newer = specWith([...ALL.filter((n) => n !== "collection"), "zz1", "zz2"]);
  const r = runValidateDiff(specWith(ALL), newer);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /core command missing: collection/);
});

test("validate-diff — collapsed spec fails and missing expected commands become errors", () => {
  const r = runValidateDiff(specWith(ALL), specWith(CORE.slice(0, 2)));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /top-level command count decreased/);
  // Degraded spec ⇒ no longer excused as a rename.
  assert.match(r.stderr, /- expected command missing: mock/);
});

test("validate-diff — gutted flags fail even with command names intact", () => {
  const r = runValidateDiff(
    specWith(ALL, { flagsPerCommand: 10 }),
    specWith(ALL, { flagsPerCommand: 0 })
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /flag count dropped/);
});

test("validate-diff — version regression fails", () => {
  const r = runValidateDiff(
    specWith(ALL, { version: "1.71.0" }),
    specWith(ALL, { version: "1.67.0" })
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /version regression/);
});
