import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

test("introspect spec — postman v1.35.2 has 15 commands and required ones present", () => {
  assert.equal(spec.postmanCliVersion, "1.35.2");
  const names = spec.commands.map((c) => c.name);
  for (const required of [
    "login", "logout", "collection", "api", "runner", "spec",
    "monitor", "workspace", "performance", "flows", "request",
    "sdk", "mock", "application", "simulate",
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

test("applyOverrides — --reporters has enum choices", () => {
  const run = merged.commands.find((c) => c.name === "collection").subcommands.find((s) => s.name === "run");
  const rep = run.flags.find((f) => f.long === "--reporters");
  assert.equal(rep.valueType, "enum");
  assert.deepEqual(rep.choices, ["cli", "json", "junit", "html"]);
});

test("applyOverrides — global --color has enum choices", () => {
  const col = merged.global.flags.find((f) => f.long === "--color");
  assert.equal(col.valueType, "enum");
  assert.deepEqual(col.choices, ["auto", "on", "off"]);
});

test("snapshot — zsh emitter matches checked-in completions/zsh/_postman", () => {
  assert.equal(emitZsh(merged), read("completions/zsh/_postman"));
});

test("snapshot — bash emitter matches checked-in completions/bash/postman.bash", () => {
  assert.equal(emitBash(merged), read("completions/bash/postman.bash"));
});

test("snapshot — fish emitter matches checked-in completions/fish/postman.fish", () => {
  assert.equal(emitFish(merged), read("completions/fish/postman.fish"));
});
