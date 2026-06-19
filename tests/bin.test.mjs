import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = resolve(ROOT, "bin/postman-completion.mjs");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

// Run the bin and capture stdout. Returns { status, stdout }.
function run(...args) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "" };
  }
}

test("emits zsh completion identical to the packaged file", () => {
  const { status, stdout } = run("zsh");
  assert.equal(status, 0);
  assert.equal(stdout.split("\n")[0], "#compdef postman");
  assert.equal(stdout, read("completions/zsh/_postman"));
});

test("emits bash completion identical to the packaged file", () => {
  const { status, stdout } = run("bash");
  assert.equal(status, 0);
  assert.ok(stdout.length > 0);
  assert.equal(stdout, read("completions/bash/postman.bash"));
});

test("emits fish completion identical to the packaged file", () => {
  const { status, stdout } = run("fish");
  assert.equal(status, 0);
  assert.ok(stdout.length > 0);
  assert.equal(stdout, read("completions/fish/postman.fish"));
});

test("path <shell> prints an existing absolute file", () => {
  const { status, stdout } = run("path", "zsh");
  assert.equal(status, 0);
  const p = stdout.trim();
  assert.ok(p.startsWith("/"));
  assert.ok(existsSync(p) && statSync(p).isFile());
});

test("path <shell> --dir prints the file's directory", () => {
  const file = run("path", "fish").stdout.trim();
  const { status, stdout } = run("path", "fish", "--dir");
  assert.equal(status, 0);
  assert.equal(stdout.trim(), dirname(file));
});

test("unknown shell exits non-zero", () => {
  assert.equal(run("powershell").status, 1);
});

test("--help exits zero and mentions the command", () => {
  const { status, stdout } = run("--help");
  assert.equal(status, 0);
  assert.match(stdout, /postman-completion/);
});
