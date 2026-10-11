import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  parseVersion,
  compareVersions,
  buildReport,
  readSpecVersion,
  fetchLatestVersion,
  detectInstalledVersion,
  checkVersions,
  resolveTargetVersion,
  UPGRADE_COMMAND,
} from "../lib/version-check.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = resolve(ROOT, "bin/postman-completion.mjs");
const SPEC = resolve(ROOT, "spec/commands.json");

function tmpFile(name, content) {
  const dir = mkdtempSync(resolve(tmpdir(), "pmcc-"));
  const p = resolve(dir, name);
  writeFileSync(p, content);
  return p;
}

// Write an executable stub `postman` into a fresh dir and return that dir.
function stubCli(script) {
  const dir = mkdtempSync(resolve(tmpdir(), "pmcc-stub-"));
  const p = resolve(dir, "postman");
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return dir;
}

// --- parseVersion -----------------------------------------------------------

test("parseVersion accepts plain, v-prefixed, and prerelease versions", () => {
  assert.deepEqual(parseVersion("1.73.0"), {
    major: 1,
    minor: 73,
    patch: 0,
    prerelease: null,
  });
  assert.equal(parseVersion("v1.73.0").minor, 73);
  assert.equal(parseVersion("  1.73.0\n").patch, 0);
  assert.equal(parseVersion("1.73.0-beta.1").prerelease, "beta.1");
});

test("parseVersion returns null for unparseable input", () => {
  for (const bad of ["", "1.73", "latest", "x.y.z", null, undefined, 173, {}]) {
    assert.equal(parseVersion(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// --- compareVersions --------------------------------------------------------

test("compareVersions orders by major, minor, then patch", () => {
  assert.equal(compareVersions("1.73.0", "1.73.0"), 0);
  assert.equal(compareVersions("1.72.0", "1.73.0"), -1);
  assert.equal(compareVersions("1.73.1", "1.73.0"), 1);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  // 9 vs 10 must not be compared as strings.
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
});

test("compareVersions sorts a prerelease below its release", () => {
  assert.equal(compareVersions("1.73.0-beta.1", "1.73.0"), -1);
  assert.equal(compareVersions("1.73.0", "1.73.0-beta.1"), 1);
  assert.equal(compareVersions("1.73.0-beta.1", "1.73.0-beta.1"), 0);
});

test("compareVersions returns null when either side is unknown", () => {
  assert.equal(compareVersions("1.73.0", null), null);
  assert.equal(compareVersions(null, "1.73.0"), null);
  assert.equal(compareVersions("garbage", "1.73.0"), null);
});

// --- buildReport ------------------------------------------------------------

test("buildReport warns and suggests an upgrade when the CLI is outdated", () => {
  const r = buildReport({ installed: "1.60.0", spec: "1.60.0", latest: "1.73.0" });
  assert.equal(r.level, "warn");
  assert.equal(r.outdated, true);
  const text = r.lines.join("\n");
  assert.match(text, /outdated: installed 1\.60\.0, latest 1\.73\.0/);
  assert.ok(text.includes(UPGRADE_COMMAND), "includes the upgrade command");
});

test("buildReport reports ok when installed matches spec and latest", () => {
  const r = buildReport({ installed: "1.73.0", spec: "1.73.0", latest: "1.73.0" });
  assert.equal(r.level, "ok");
  assert.equal(r.outdated, false);
  assert.equal(r.drifted, false);
});

test("buildReport flags completion drift independently of the upgrade check", () => {
  // On the latest CLI, but the completions were built for an older one.
  const r = buildReport({ installed: "1.73.0", spec: "1.60.0", latest: "1.73.0" });
  assert.equal(r.outdated, false, "not outdated vs npm");
  assert.equal(r.drifted, true, "but drifted vs the spec");
  assert.equal(r.level, "warn");
  assert.match(r.lines.join("\n"), /missing commands your CLI supports/);
});

test("buildReport tells the user completions may be ahead of an older CLI", () => {
  const r = buildReport({ installed: "1.60.0", spec: "1.73.0", latest: "1.73.0" });
  assert.equal(r.drifted, true);
  assert.match(r.lines.join("\n"), /may offer commands your CLI does not have/);
});

test("buildReport handles a CLI newer than npm latest without warning", () => {
  const r = buildReport({ installed: "1.99.0", spec: "1.99.0", latest: "1.73.0" });
  assert.equal(r.outdated, false);
  assert.equal(r.level, "ok");
  assert.match(r.lines.join("\n"), /newer than npm latest/);
});

test("buildReport asks the user to install the CLI when it is absent", () => {
  const r = buildReport({ installed: null, spec: "1.73.0", latest: "1.73.0" });
  assert.equal(r.level, "notice");
  assert.equal(r.outdated, false);
  assert.match(r.lines.join("\n"), /not detected/);
});

test("buildReport stays quiet about unknown comparisons", () => {
  // Registry unreachable: no latest, so no upgrade claim either way.
  const r = buildReport({ installed: "1.73.0", spec: "1.73.0", latest: null });
  assert.equal(r.outdated, false);
  assert.equal(r.level, "ok");
  assert.ok(
    !r.lines.join("\n").includes("outdated"),
    "must not claim outdated without a latest version",
  );
});

// --- readSpecVersion --------------------------------------------------------

test("readSpecVersion reads postmanCliVersion from the committed spec", () => {
  const v = readSpecVersion(SPEC);
  assert.ok(parseVersion(v), `spec version should be semver, got ${v}`);
});

test("readSpecVersion returns null for a missing or malformed spec", () => {
  assert.equal(readSpecVersion(resolve(ROOT, "spec/does-not-exist.json")), null);
  assert.equal(readSpecVersion(tmpFile("bad.json", "{not json")), null);
  assert.equal(readSpecVersion(tmpFile("novers.json", "{}")), null);
});

// --- resolveTargetVersion ---------------------------------------------------

test("resolveTargetVersion prefers the spec when it is present", () => {
  const spec = tmpFile("spec.json", JSON.stringify({ postmanCliVersion: "1.73.0" }));
  const pkg = tmpFile("package.json", JSON.stringify({ version: "1.60.0" }));
  assert.equal(resolveTargetVersion({ specPath: spec, packageJsonPath: pkg }), "1.73.0");
});

test("resolveTargetVersion falls back to the package version when the spec is absent", () => {
  // The published tarball ships lib/ but not the 348 kB spec; release.yml sets
  // the package version to the targeted CLI version, so this is the real path
  // for an npm-installed copy.
  const pkg = tmpFile("package.json", JSON.stringify({ version: "1.73.0" }));
  assert.equal(
    resolveTargetVersion({ specPath: "/nonexistent/commands.json", packageJsonPath: pkg }),
    "1.73.0",
  );
});

test("resolveTargetVersion rejects the repo's 0.0.0 placeholder version", () => {
  // "0.0.0-managed-by-spec" IS valid semver (a prerelease of 0.0.0), so without
  // an explicit guard every real CLI would compare as newer and produce a bogus
  // drift warning. It must read as unknown instead.
  for (const v of ["0.0.0-managed-by-spec", "0.0.0"]) {
    const pkg = tmpFile("package.json", JSON.stringify({ version: v }));
    assert.equal(
      resolveTargetVersion({ specPath: "/nonexistent/commands.json", packageJsonPath: pkg }),
      null,
      `expected null for placeholder ${v}`,
    );
  }
});

test("a repo checkout with no spec produces no drift warning", () => {
  // Guards the regression the placeholder guard prevents, end to end.
  const r = buildReport({ installed: "1.73.0", spec: null, latest: "1.73.0" });
  assert.equal(r.drifted, false);
  assert.equal(r.level, "ok");
});

test("resolveTargetVersion returns null when neither source is usable", () => {
  assert.equal(
    resolveTargetVersion({
      specPath: "/nonexistent/commands.json",
      packageJsonPath: "/nonexistent/package.json",
    }),
    null,
  );
});

// --- fetchLatestVersion -----------------------------------------------------

test("fetchLatestVersion returns the registry version", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "1.73.0" }) });
  assert.deepEqual(await fetchLatestVersion({ fetchImpl }), {
    version: "1.73.0",
    error: null,
  });
});

test("fetchLatestVersion reports HTTP and network failures as data, not throws", async () => {
  const notOk = await fetchLatestVersion({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(notOk.version, null);
  assert.match(notOk.error, /503/);

  const threw = await fetchLatestVersion({
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    },
  });
  assert.equal(threw.version, null);
  assert.match(threw.error, /ENOTFOUND/);
});

test("fetchLatestVersion handles a response with no version field", async () => {
  const r = await fetchLatestVersion({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  assert.equal(r.version, null);
  assert.match(r.error, /no version field/);
});

// --- detectInstalledVersion -------------------------------------------------

test("detectInstalledVersion parses a bare version from the CLI", async () => {
  const dir = stubCli("#!/bin/sh\necho 1.73.0\n");
  const r = await detectInstalledVersion({ command: resolve(dir, "postman") });
  assert.deepEqual(r, { version: "1.73.0", error: null });
});

test("detectInstalledVersion tolerates surrounding noise and a v prefix", async () => {
  const dir = stubCli("#!/bin/sh\necho 'Postman CLI v1.73.0 (darwin-arm64)'\n");
  const r = await detectInstalledVersion({ command: resolve(dir, "postman") });
  assert.equal(r.version, "1.73.0");
});

test("detectInstalledVersion reports a missing CLI without throwing", async () => {
  const r = await detectInstalledVersion({ command: "postman-does-not-exist-xyz" });
  assert.equal(r.version, null);
  assert.match(r.error, /not found on PATH/);
});

test("detectInstalledVersion reports an unparseable version", async () => {
  const dir = stubCli("#!/bin/sh\necho 'no version here'\n");
  const r = await detectInstalledVersion({ command: resolve(dir, "postman") });
  assert.equal(r.version, null);
  assert.match(r.error, /could not parse/);
});

test("detectInstalledVersion reports a failing CLI", async () => {
  const dir = stubCli("#!/bin/sh\nexit 3\n");
  const r = await detectInstalledVersion({ command: resolve(dir, "postman") });
  assert.equal(r.version, null);
  assert.ok(r.error.length > 0);
});

// --- checkVersions ----------------------------------------------------------

test("checkVersions combines both comparisons into one report", async () => {
  const dir = stubCli("#!/bin/sh\necho 1.60.0\n");
  const r = await checkVersions({
    specPath: tmpFile("spec.json", JSON.stringify({ postmanCliVersion: "1.73.0" })),
    command: resolve(dir, "postman"),
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: "1.73.0" }) }),
  });
  assert.equal(r.installed, "1.60.0");
  assert.equal(r.spec, "1.73.0");
  assert.equal(r.latest, "1.73.0");
  assert.equal(r.outdated, true);
  assert.equal(r.drifted, true);
  assert.equal(r.level, "warn");
});

test("checkVersions skips the registry entirely when offline", async () => {
  const dir = stubCli("#!/bin/sh\necho 1.73.0\n");
  let called = false;
  const r = await checkVersions({
    specPath: SPEC,
    offline: true,
    command: resolve(dir, "postman"),
    fetchImpl: async () => {
      called = true;
      throw new Error("network must not be used when offline");
    },
  });
  assert.equal(called, false, "fetch must not be called in offline mode");
  assert.equal(r.latest, null);
  assert.match(r.latestError, /offline/);
});

// --- bin integration --------------------------------------------------------

function runBin(env, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "" };
  }
}

test("doctor --offline exits 1 and suggests an update when the CLI is outdated", () => {
  const dir = stubCli("#!/bin/sh\necho 1.0.0\n");
  const { status, stdout } = runBin({ PATH: `${dir}:${process.env.PATH}` }, "doctor", "--offline");
  assert.equal(status, 1, "an actionable drift must be a non-zero exit");
  assert.match(stdout, /generated for Postman CLI/);
  assert.match(stdout, /postman-cli-completion@latest/);
});

test("doctor --offline exits 0 when the CLI matches the spec", () => {
  const specVersion = readSpecVersion(SPEC);
  const dir = stubCli(`#!/bin/sh\necho ${specVersion}\n`);
  const { status, stdout } = runBin({ PATH: `${dir}:${process.env.PATH}` }, "doctor", "--offline");
  assert.equal(status, 0);
  assert.match(stdout, /Completions match your installed CLI/);
});

test("doctor reports a missing CLI without crashing", () => {
  // Build a PATH containing only node, so `postman` is genuinely absent. We
  // cannot just use node's own dir: a globally installed postman often lives
  // right beside it (same nvm/npm prefix).
  const onlyNode = mkdtempSync(resolve(tmpdir(), "pmcc-nodeonly-"));
  symlinkSync(process.execPath, resolve(onlyNode, "node"));
  const { status, stdout } = runBin({ PATH: onlyNode }, "doctor", "--offline");
  assert.equal(status, 0, "a missing CLI is a notice, not a failure");
  assert.match(stdout, /not detected/);
});

test("--help documents the doctor subcommand", () => {
  const { status, stdout } = runBin({}, "--help");
  assert.equal(status, 0);
  assert.match(stdout, /doctor/);
});
