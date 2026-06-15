#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = resolve(REPO_ROOT, "spec/commands.json");
const REGISTRY = "https://registry.npmjs.org/postman-cli/latest";

async function main() {
  const current = JSON.parse(readFileSync(SPEC, "utf8")).postmanCliVersion;
  const res = await fetch(REGISTRY, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    process.stderr.write(`registry request failed: ${res.status}\n`);
    process.exit(2);
  }
  const body = await res.json();
  const latest = body.version;
  const outdated = current !== latest;
  process.stdout.write(`current=${current}\nlatest=${latest}\noutdated=${outdated}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(2);
});
