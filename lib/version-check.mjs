// Version drift detection for the Postman CLI.
//
// Two independent comparisons, because "outdated" has two meanings here:
//
//   1. installed CLI vs. the version these completions were generated against
//      (spec/commands.json.postmanCliVersion). A mismatch means completions may
//      offer commands the user's CLI lacks, or miss ones it has. Offline, free.
//   2. installed CLI vs. the latest published postman-cli on npm. A mismatch
//      means the user should upgrade. Requires the network.
//
// Everything that decides *what* to say is a pure function so it can be tested
// without a CLI, a network, or a filesystem.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

export const REGISTRY_URL = "https://registry.npmjs.org/postman-cli/latest";
export const UPGRADE_COMMAND = "npm install -g postman-cli@latest";

/**
 * Parse a semver-ish string into comparable parts.
 * Tolerates a leading "v", trailing prerelease/build metadata, and surrounding
 * whitespace. Returns null for anything we cannot order numerically.
 */
export function parseVersion(raw) {
  if (typeof raw !== "string") return null;
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?\s*$/.exec(raw);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/**
 * Compare two version strings. Returns -1 / 0 / 1 (a<b / a==b / a>b), or null
 * if either side is unparseable — callers must treat null as "unknown", never
 * as "equal", so we don't warn on garbage input.
 *
 * A prerelease sorts below the same x.y.z release (1.2.3-beta < 1.2.3), which
 * matches semver. We deliberately do not order two different prereleases of the
 * same release against each other beyond a plain string compare.
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;

  for (const part of ["major", "minor", "patch"]) {
    if (pa[part] !== pb[part]) return pa[part] < pb[part] ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1; // release > prerelease
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/**
 * Read the installed Postman CLI version by shelling out to `postman --version`,
 * which prints a bare "1.73.0".
 *
 * Never throws: a missing CLI, a non-zero exit, or a hang are all normal states
 * for this tool (the completions package is installed independently of the CLI).
 * Resolves { version, error } where exactly one side is set.
 */
export function detectInstalledVersion({ command = "postman", timeoutMs = 5000 } = {}) {
  return new Promise((resolvePromise) => {
    execFile(command, ["--version"], { timeout: timeoutMs }, (err, stdout) => {
      if (err) {
        const reason =
          err.code === "ENOENT"
            ? `"${command}" not found on PATH`
            : err.killed
              ? `"${command} --version" timed out`
              : `"${command} --version" failed: ${err.message.trim()}`;
        resolvePromise({ version: null, error: reason });
        return;
      }
      // Some builds print the version among other noise; take the first
      // semver-looking token so we degrade gracefully rather than fail.
      const match = /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(stdout ?? "");
      if (!match) {
        resolvePromise({
          version: null,
          error: `could not parse a version from "${command} --version" output`,
        });
        return;
      }
      resolvePromise({ version: match[0].replace(/^v/, ""), error: null });
    });
  });
}

/**
 * Version of the Postman CLI that the committed spec (and therefore the shipped
 * completion scripts) was generated against.
 */
export function readSpecVersion(specPath) {
  try {
    const v = JSON.parse(readFileSync(specPath, "utf8")).postmanCliVersion;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * The CLI version these completions target.
 *
 * Two sources, in order:
 *   1. spec/commands.json — present in a git checkout, the real source of truth.
 *   2. this package's own version — release.yml runs `npm version <spec
 *      version>` before publishing, so an installed copy's version *is* the
 *      targeted Postman CLI version. This keeps the 348 kB spec out of the
 *      published tarball.
 * In a git checkout package.json holds the placeholder
 * "0.0.0-managed-by-spec". That is technically valid semver (a prerelease of
 * 0.0.0), so it must be rejected explicitly — otherwise every real CLI would
 * compare as "newer" and trigger a bogus drift warning.
 */
export function resolveTargetVersion({ specPath, packageJsonPath }) {
  const fromSpec = readSpecVersion(specPath);
  if (fromSpec) return fromSpec;

  try {
    const v = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
    const parsed = parseVersion(v);
    if (!parsed) return null;
    // Never trust a 0.0.0 placeholder as a real target version.
    if (parsed.major === 0 && parsed.minor === 0 && parsed.patch === 0) return null;
    return v;
  } catch {
    return null;
  }
}

/**
 * Ask npm for the latest published postman-cli version.
 * Never throws — offline is an expected state, so failure is reported as data.
 */
export async function fetchLatestVersion({
  url = REGISTRY_URL,
  timeoutMs = 5000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) return { version: null, error: `registry request failed: ${res.status}` };
    const body = await res.json();
    const version = typeof body?.version === "string" ? body.version : null;
    return version
      ? { version, error: null }
      : { version: null, error: "registry response had no version field" };
  } catch (err) {
    const offline = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      version: null,
      error: offline ? "registry request timed out" : `registry request failed: ${err.message}`,
    };
  }
}

/**
 * Decide what to report, given the three versions. Pure.
 *
 * `installed` / `spec` / `latest` may each be null (unknown). Returns a report:
 *   { level, lines, outdated, drifted }
 * where level is "ok" | "notice" | "warn" and lines are ready to print.
 */
export function buildReport({ installed, spec, latest }) {
  const lines = [];
  let level = "ok";
  const bump = (next) => {
    const rank = { ok: 0, notice: 1, warn: 2 };
    if (rank[next] > rank[level]) level = next;
  };

  if (!installed) {
    return {
      level: "notice",
      outdated: false,
      drifted: false,
      lines: [
        "Postman CLI not detected — install it with: npm install -g postman-cli",
        "(this package only provides shell completions; it does not include the CLI)",
      ],
    };
  }

  // 1. installed vs. latest published — the upgrade suggestion.
  const vsLatest = compareVersions(installed, latest);
  const outdated = vsLatest === -1;
  if (outdated) {
    bump("warn");
    lines.push(
      `Your Postman CLI is outdated: installed ${installed}, latest ${latest}.`,
      `  Upgrade with: ${UPGRADE_COMMAND}`,
    );
  } else if (vsLatest === 1) {
    lines.push(`Installed Postman CLI ${installed} is newer than npm latest ${latest}.`);
  } else if (vsLatest === 0) {
    lines.push(`Postman CLI ${installed} is up to date.`);
  }

  // 2. installed vs. the spec these completions were built from — the drift
  //    warning. Reported separately: being on the latest CLI does not guarantee
  //    the completions were regenerated for it yet, and vice versa.
  const vsSpec = compareVersions(installed, spec);
  const drifted = vsSpec !== null && vsSpec !== 0;
  if (drifted) {
    bump("warn");
    lines.push(
      `These completions were generated for Postman CLI ${spec}, but ${installed} is installed.`,
      vsSpec === -1
        ? "  Completions may offer commands your CLI does not have."
        : "  Completions may be missing commands your CLI supports.",
      "  Update them with: npm install -g postman-cli-completion@latest",
    );
  } else if (vsSpec === 0) {
    lines.push(`Completions match your installed CLI (${installed}).`);
  }

  return { level, lines, outdated, drifted };
}

/**
 * Run both comparisons and build the report.
 * `offline: true` skips the registry lookup entirely (no network, no delay).
 */
export async function checkVersions({
  specPath,
  packageJsonPath,
  offline = false,
  command = "postman",
  timeoutMs = 5000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const spec = resolveTargetVersion({ specPath, packageJsonPath });
  const [{ version: installed, error: installError }, latestResult] = await Promise.all([
    detectInstalledVersion({ command, timeoutMs }),
    offline
      ? Promise.resolve({ version: null, error: "skipped (offline)" })
      : fetchLatestVersion({ timeoutMs, fetchImpl }),
  ]);

  const report = buildReport({ installed, spec, latest: latestResult.version });
  return {
    ...report,
    installed,
    spec,
    latest: latestResult.version,
    installError,
    latestError: latestResult.error,
  };
}
