# Distribute Completions as an npm Package — Design

Tracking: [issue #12](https://github.com/yokawasa/postman-cli-completion/issues/12)

## Context

Issue #12 asks to make the Postman CLI shell completions installable via npm. Today
distribution is GitHub Releases + `git clone` only — users clone the repo and manually
wire each shell. An npm package gives a one-line `npm i -g` install and an idiomatic,
node-manager-agnostic way to enable completions for zsh, bash, and fish.

Facts that ground the design:

- Completion files are generated and committed: `completions/zsh/_postman`,
  `completions/bash/postman.bash`, `completions/fish/postman.fish`. CI (`ci.yml` →
  `generate:check`) guarantees the committed files match `spec/commands.json`, so we can
  **publish the committed files without regenerating at publish time**.
- `_postman` is **dual-mode**: a `#compdef postman` header plus a footer that invokes
  `_postman` when the file is loaded via `fpath` (function-body mode) and is a no-op when
  the file is `source`d directly. The same file therefore works for both
  `source <(...)` and `fpath` installation.
- Versioning source of truth is `spec/commands.json.postmanCliVersion` (currently
  `1.39.0`); `package.json` version is the placeholder `0.0.0-managed-by-spec`.
  `release.yml` reads the spec version, tags `vX.Y.Z`, and creates a GitHub Release.
- The npm name `postman-cli-completion` is **available**. The upstream CLI is the
  `postman-cli` package, whose command is `postman` — so our `bin` must **not** be named
  `postman` (collision).

Confirmed direction (decided with the maintainer):

1. **Installation UX = a `bin` command** (`postman-completion`) that prints the
   completion script to stdout — no postinstall magic.
2. **npm publish is automated in `release.yml`**, with the version synced from the spec.

## 1. Architecture overview

```
npm i -g postman-cli-completion
        │
        ├── installs bin: postman-completion  (does NOT shadow `postman`)
        └── ships completions/{zsh,bash,fish}/ inside the package

postman-completion bash   → prints completions/bash/postman.bash to stdout
postman-completion zsh    → prints completions/zsh/_postman to stdout
postman-completion fish   → prints completions/fish/postman.fish to stdout
postman-completion path zsh [--dir]  → prints the packaged file (or its dir) path
```

Per-shell wiring:

| Shell | Quick (current shell) | Persistent |
| --- | --- | --- |
| bash | `source <(postman-completion bash)` | add the same line to `~/.bashrc` |
| zsh  | `source <(postman-completion zsh)` | `fpath=("$(postman-completion path zsh --dir)" $fpath); autoload -Uz compinit && compinit` |
| fish | `postman-completion fish \| source` | symlink `postman-completion path fish` into `~/.config/fish/completions/` |

Why a `bin` command rather than postinstall auto-copy or raw `node_modules` paths:

- **Postinstall auto-copy** must guess the shell, the `fpath`/fish completions location,
  and edit dotfiles — brittle, non-idempotent, fails on permission-restricted global
  installs, and runs install-time code (npm is moving to disable install scripts).
- **Raw `node_modules` paths** like `$(npm root -g)/postman-cli-completion/...` are
  manager-dependent (nvm, volta, pnpm, bun differ) and leak package internals.
- A **stable `bin` command** that emits the script (the pattern used by `gh completion`,
  `deno completions`, `rustup completions`) is node-manager-agnostic and resolves its own
  file paths via `import.meta.url`.

## 2. `package.json` changes

```jsonc
{
  "name": "postman-cli-completion",
  "version": "0.0.0-managed-by-spec",   // placeholder; CI sets the real version at publish
  "description": "Shell completions for the Postman CLI (zsh, bash, fish)",
  "type": "module",
  // "private": true  ← REMOVED (npm refuses to publish private packages)
  "bin": { "postman-completion": "bin/postman-completion.mjs" },
  "files": [
    "bin/",
    "completions/zsh/_postman",
    "completions/bash/postman.bash",
    "completions/fish/postman.fish",
    "README.md",
    "LICENSE"
  ],
  "keywords": ["postman", "postman-cli", "completion", "zsh", "bash", "fish", "shell"],
  "repository": { "type": "git", "url": "git+https://github.com/yokawasa/postman-cli-completion.git" },
  "homepage": "https://github.com/yokawasa/postman-cli-completion#readme",
  "bugs": { "url": "https://github.com/yokawasa/postman-cli-completion/issues" },
  "prepublishOnly": "node scripts/generate.mjs --check && node --test tests/*.test.mjs",
  "engines": { "node": ">=20" },
  "license": "MIT"
}
```

- The `bin` name must not shadow `postman`.
- `files` is an allowlist; `scripts/`, `spec/`, `tests/`, `.github/` are excluded
  automatically, keeping the tarball small. (`package.json`, `README.md`, `LICENSE` are
  always included by npm regardless.)
- `prepublishOnly` is a defensive publish-time gate; it runs only on `npm publish`, never
  on consumer install.
- The committed `version` stays a placeholder — CI mutates it in the ephemeral runner
  only (see §4).

## 3. `bin/postman-completion.mjs`

A new executable ESM script (repo is `"type": "module"`), zero runtime dependencies.

- Shebang `#!/usr/bin/env node`.
- Resolve the package root from `import.meta.url`
  (`resolve(dirname(fileURLToPath(import.meta.url)), "..")`) — the same pattern as
  `scripts/generate.mjs` / `scripts/check-version.mjs`. Never resolve from
  `process.cwd()`, which is the user's shell directory.
- Subcommands:
  - `postman-completion <zsh|bash|fish>` → print that shell's completion file to stdout.
  - `postman-completion path <zsh|bash|fish>` → print the packaged file's absolute path.
  - `postman-completion path <shell> --dir` → print the file's directory (zsh `fpath`).
  - no-arg / `--help` → usage with per-shell copy-paste snippets.
  - unknown shell → error to stderr, non-zero exit.

## 4. Setting the npm version at publish time

The git-committed version stays `0.0.0-managed-by-spec`. CI mutates `package.json` in the
ephemeral runner just before publish, without committing or tagging (the workflow already
owns the `vX.Y.Z` git tag):

```sh
V=$(node -p "require('./spec/commands.json').postmanCliVersion")
npm version "$V" --no-git-tag-version --allow-same-version
```

`--no-git-tag-version` prevents npm from committing/tagging; `--allow-same-version` makes
re-runs safe.

## 5. `.github/workflows/release.yml` changes

- Add `id-token: write` to `permissions` (npm Trusted Publishing exchanges the GitHub
  Actions OIDC token for a short-lived credential; provenance uses the same token).
- Add `actions/setup-node@v6` (following the official npm recipe) with
  `node-version: "24"`, `registry-url: "https://registry.npmjs.org"`, and
  `package-manager-cache: false`. **setup-node must be v6+**: v4 defaulted a dummy
  `NODE_AUTH_TOKEN` and wrote `always-auth`, which shadowed OIDC and made npm publish
  anonymously → `404 Not Found` on the `PUT` ([setup-node issue #1440]). v6 removed that
  behavior, so `registry-url` with **no** token works with OIDC. `package-manager-cache: false`
  disables dependency caching for a clean release build. Trusted Publishing requires
  **npm CLI >= 11.5.1 and Node >= 22.14.0** (Node 24 satisfies Node; we still upgrade npm in
  the publish step since Node 24's bundled npm may predate 11.5.1).

[setup-node issue #1440]: https://github.com/actions/setup-node/issues/1440
- After the existing "Tag and release" step:
  - An npm idempotency guard mirroring the git-tag guard:
    `npm view "postman-cli-completion@$V" version` → set `skip=true` if it exists.
  - A publish step gated only on that guard (independent of the git-tag guard, so a
    missing publish can be repaired even after the tag exists):
    ```sh
    npm install -g npm@latest   # Trusted Publishing requires npm CLI >= 11.5.1
    npm version "$V" --no-git-tag-version --allow-same-version
    npm publish --provenance --access public
    ```
    No `NODE_AUTH_TOKEN` / `NPM_TOKEN` — authentication is via OIDC, and provenance is
    attached automatically under Trusted Publishing.

**Manual prerequisite (out-of-band):** configure a **Trusted Publisher** for the package on
npmjs.com — there is no long-lived token to store or rotate. On the package page → *Settings*
→ *Trusted Publisher* → **GitHub Actions**, set:

| Field | Value |
|---|---|
| Organization or user | `yokawasa` |
| Repository | `postman-cli-completion` |
| Workflow filename | `release.yml` |
| Environment | *(leave blank — the workflow uses none)* |

Once saved, `release.yml` publishes with no secret. This removes the entire `NPM_TOKEN` class
of failures (issue #17): expired/rotated tokens, 2FA prompts, and granular tokens that `403`
because they lack write/create rights on the package. Note the Trusted Publisher is configured
on an **existing** package's settings page, so the very first publish that *creates* the name
must still be done once manually (see §11); the package already exists (`1.39.2`), so this is
already satisfied and every subsequent release flows through OIDC.

## 6. README changes

Add an "Install via npm (recommended)" subsection at the top of `## Install`, keeping the
existing clone/manual instructions below as the "from source" alternative. Cover the
per-shell wiring from the §1 table, note that `postman-completion` does not shadow the
real `postman` CLI, retain the bash-4+/Homebrew caveat, and reference the existing zsh
`compinit` note for the `source <(...)` path.

## 7. Tests / CI

- New `tests/bin.test.mjs` (matches `tests/*.test.mjs`, runs under `node --test` in
  `ci.yml`): spawn `node bin/postman-completion.mjs <args>` and assert the `zsh` output's
  first line is `#compdef postman` and equals the on-disk file; `bash`/`fish` equal their
  files; `path zsh` is an existing absolute file and `path zsh --dir` its directory;
  unknown shell exits non-zero.
- `generate:check` is unaffected (generation is unchanged).
- Optional: add `npm pack --dry-run` to `ci.yml` to assert the tarball ships exactly
  `bin/` + 3 completion files + README + LICENSE.

## 8. Implementation roadmap

A single PR:

1. `package.json`: drop `private`, add `bin`/`files`/metadata/`prepublishOnly`.
2. `bin/postman-completion.mjs` (new).
3. `tests/bin.test.mjs` (new).
4. `.github/workflows/release.yml`: setup-node, npm guard, publish step.
5. `README.md`: npm install section.
6. (Optional) `ci.yml`: `npm pack --dry-run`.

Out-of-band: configure the npm Trusted Publisher (§5) before the next release fires.

## 9. Verification

1. `node bin/postman-completion.mjs zsh | head -1` → `#compdef postman`;
   `node bin/postman-completion.mjs path fish --dir` → an existing directory.
2. `npm test` (includes the new bin test); `npm run generate:check` stays clean.
3. `npm pack --dry-run` → only bin + 3 completions + README + LICENSE shipped.
4. End-to-end: `npm pack` → `npm i -g ./postman-cli-completion-*.tgz` → in a fresh shell
   run the per-shell snippet and check `postman <TAB>` against the README "Verify"
   checklist.
5. After the Trusted Publisher is configured (§5), trigger `release.yml` via
   `workflow_dispatch`; confirm the guard skips an already-published version and publishes a
   new one (`npm view postman-cli-completion version`).

## 10. Out of scope

- Dynamic remote-ID completion (already documented as unsupported).
- Homebrew or other package managers.

## 11. First publish (one-time, manual) — claiming the name

The automated `release.yml` publish (OIDC Trusted Publishing, §5) can only *update* an
existing package: a Trusted Publisher is configured on a package's settings page, which does
not exist until the name is claimed. The way to unblock the very first release (issue #17) is
to publish once locally to claim the name. After the package exists, configure the Trusted
Publisher and CI publishes every subsequent version automatically over OIDC.

```sh
# from a clean checkout of the latest main (so the published tarball has up-to-date completions)
git pull origin main
npm login                                                   # interactive; handles 2FA
npm version "$(node -p "require('./spec/commands.json').postmanCliVersion")" \
  --no-git-tag-version --allow-same-version                 # match the spec version
npm publish --access public
npm view postman-cli-completion version                     # confirm it is now published
```

**Why no `--provenance` here:** provenance is generated from a CI/CD OIDC token and only works
inside a supported runner (e.g. GitHub Actions). A local `npm publish --provenance` fails with
"provenance generation … not supported". Provenance is per-version, so this first version
simply ships without it; every later version published by `release.yml` attaches provenance.

`prepublishOnly` (`generate:check` + `node --test`) runs automatically as a publish-time gate.

**After claiming the name:** configure the npm **Trusted Publisher** on the now-existing
`postman-cli-completion` (§5) so CI publishes over OIDC with no stored token. No `release.yml`
change is needed — its `npm view …@<version>` guard skips the already-published version and
publishes only new ones.
