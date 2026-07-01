# Auto Catch-up Latest Postman CLI — Design

Tracking: [issue #2](https://github.com/yokawasa/postman-cli-completion/issues/2)

## Context

Issue #2 calls for two capabilities:

1. **Catch-up**: keep this repository in sync with the latest Postman CLI release so its completion scripts always reflect the current command surface.
2. **Auto release**: trigger a new release of this repository every time the Postman CLI ships a new version.

Current state of the repository:

- `completions/{zsh,bash,fish}/` are three hand-authored scripts (~1,038 lines total).
- The Postman CLI version `v1.35.2` is hard-coded only in the three header comments.
- There is no `.github/workflows/`, no `scripts/`, and no `package.json`.
- No git tag or GitHub Release exists yet.
- We are already on the `auto-catchup` branch.

Confirmed direction (decided with the maintainer):

- **Automation level — Full auto-merge.** CI detects a new upstream version, introspects it, opens a PR, and auto-merges it once all checks pass. A release follows immediately.
- **Versioning — fully aligned with Postman CLI.** Postman CLI `v1.35.2` ⇒ this repo `v1.35.2`. Completion-only fixes use build suffixes (e.g. `v1.35.2-1`).
- **Distribution — GitHub Release + tag only.** No Homebrew tap, no npm package for now.

---

## 1. Architecture overview

```
                 ┌─────────────────────────────────┐
                 │  npm registry: postman-cli      │
                 └────────────┬────────────────────┘
                              │ daily poll
                 ┌────────────▼────────────────────┐
                 │  .github/workflows/catchup.yml  │
                 │  1. npm view postman-cli version│
                 │  2. compare to spec/commands.json
                 │  3. npm i -g postman-cli@latest │
                 │  4. scripts/introspect.mjs      │
                 │  5. scripts/validate-diff.mjs   │
                 │  6. scripts/generate.mjs        │
                 │  7. lint + test                 │
                 │  8. open PR → enable auto-merge │
                 └────────────┬────────────────────┘
                              │ merge to main
                 ┌────────────▼────────────────────┐
                 │  .github/workflows/release.yml  │
                 │  - read version from spec       │
                 │  - git tag v<x.y.z> + push      │
                 │  - gh release create + assets   │
                 └─────────────────────────────────┘
```

`spec/commands.json` is the single source of truth. The three completion scripts are produced deterministically by a generator from that file.

---

## 2. Directory layout (after implementation)

```
postman-cli-completion/
├── .github/workflows/
│   ├── catchup.yml          # new: daily schedule
│   ├── release.yml          # new: fires on spec change
│   └── ci.yml               # new: PR checks (lint + test)
├── completions/             # existing — regenerated from spec going forward
│   ├── zsh/_postman
│   ├── bash/postman.bash
│   └── fish/postman.fish
├── docs/
│   └── auto-catchup.md      # this design document
├── scripts/                 # new
│   ├── introspect.mjs       # recursively parse `postman --help` → JSON
│   ├── generate.mjs         # spec → 3 shell scripts
│   ├── emitters/
│   │   ├── zsh.mjs
│   │   ├── bash.mjs
│   │   └── fish.mjs
│   ├── validate-diff.mjs    # safety net for suspicious diffs
│   └── check-version.mjs    # query npm registry
├── spec/                    # new
│   ├── commands.json        # generator input (introspect output)
│   └── overrides.json       # manual entries (dynamic --auth-<type>-<param>, etc.)
├── tests/                   # new
│   ├── fixtures/            # frozen `--help` outputs for past versions
│   ├── snapshots/           # generator golden output
│   └── generate.test.mjs
├── package.json             # new: npm scripts (introspect/generate/test)
├── README.md
└── LICENSE
```

---

## 3. `spec/commands.json` schema

```json
{
  "postmanCliVersion": "1.35.2",
  "introspectedAt": "2026-06-14T00:00:00Z",
  "global": {
    "flags": [
      { "long": "--version", "short": "-v", "description": "Print version" },
      { "long": "--help",    "short": "-h", "description": "Show help" },
      { "long": "--silent",                  "description": "Suppress all output" },
      { "long": "--color",                   "description": "Force color output" }
    ]
  },
  "commands": [
    {
      "name": "collection",
      "description": "Manage Postman collections",
      "subcommands": [
        {
          "name": "run",
          "description": "Run a collection",
          "positionals": [
            { "name": "collection", "valueType": "file", "patterns": ["*.json"] }
          ],
          "flags": [
            {
              "long": "--environment",
              "short": "-e",
              "valueType": "file",
              "patterns": ["*.json"],
              "description": "Environment file"
            }
          ]
        }
      ]
    }
  ]
}
```

`valueType` enum: `none` | `file` | `dir` | `string` | `number` | `enum`. When `enum`, accompany with `choices: []`.

`spec/overrides.json` carries everything `introspect` cannot derive:

```json
{
  "request": {
    "dynamicFlagPatterns": [
      {
        "template": "--auth-{type}-{param}",
        "examples": ["--auth-bearer-token", "--auth-basic-username"]
      }
    ]
  }
}
```

`generate.mjs` merges `commands.json` with `overrides.json`. `introspect.mjs` never touches overrides.

---

## 4. Introspection behavior

Postman CLI is built on `commander.js` (assumed), so `--help` output is machine-parseable:

```
$ postman --help
Usage: postman [options] [command]

Commands:
  login [options]
  collection
  api
  ...

Options:
  -v, --version  output the version number
  -h, --help     display help for command
```

Procedure:

1. Run `postman --help` to extract top-level commands and global flags.
2. For each top-level command, recurse: `postman <cmd> --help` to extract subcommands and flags.
3. Recurse further whenever a subcommand has its own subcommands.
4. Detect positional arguments from `Usage: postman <cmd> <sub> [options] <id>`-style `<...>` markers.
5. Infer `valueType`:
   - flag names containing `file`, `path`, `collection`, `environment`, `iteration-data` → `file`
   - `<number>` / `[number]` patterns → `number`
   - enum-like flags (e.g. `--reporters <reporter>`) that `--help` does not enumerate → fall back to `overrides.json`
6. Write to `spec/commands.json.new`, then validate before promoting it to `spec/commands.json`.

---

## 5. `validate-diff.mjs` safety net

`scripts/validate-diff.mjs old.json new.json` rejects (exits non-zero, fails CI, blocks auto-merge) when any of these holds:

| Suspicious pattern | Threshold |
|---|---|
| The number of top-level commands decreased | Any drop → fail |
| The total flag count dropped by 30% or more | Sudden loss likely indicates a parse error |
| A known fixed command (`collection`, `api`, `runner`, …) disappeared | Fail |
| `postmanCliVersion` is going backwards (semver) | Fail |

When this guard fires, the PR stays in `draft` state, the `automated` label is not applied, and a human must review.

---

## 6. Generator (emitter) strategy

Emitters are deterministic and idempotent: the same `commands.json` always yields byte-identical output.

**Shared header**:

```
# Zsh completion for Postman CLI (postman v{version})
# Auto-generated by scripts/generate.mjs — DO NOT EDIT
# Source: spec/commands.json
```

**zsh** (`scripts/emitters/zsh.mjs`)
- emit a `_postman_<cmd>()` function per command
- decide `_arguments -C` flag definitions, `->subcommand` state transitions, and `_files -g <pattern>` from the spec
- keep the trailing `compdef` + `funcstack` guard as a fixed template

**bash** (`scripts/emitters/bash.mjs`)
- keep the main `_postman()` `COMP_WORDS` parsing logic as a fixed template
- emit a `_postman_<cmd>()` function per command
- build the `global_flags` string from `spec.global.flags`
- close with `complete -F _postman postman`

**fish** (`scripts/emitters/fish.mjs`)
- the simplest because fish is declarative: emit one `complete -c postman -n <condition> -a <cmd> -d <desc>` line per entry
- keep `__postman_no_subcommand` / `__postman_using_subcommand` helpers as a fixed template

**Migration validation**

In the bootstrap PR (PR-1), diff the emitter output against the current hand-authored scripts. If unintended structural differences appear, tune the emitters to match the existing scripts. If byte-identical output is not achievable, lock down equivalence with behavioral tests (`tests/behavioral.test.mjs` that actually solicits completions from a real shell).

---

## 7. CI workflows

### 7.1 `.github/workflows/catchup.yml`

```yaml
name: catchup
on:
  schedule:
    - cron: "0 0 * * *"   # daily 00:00 UTC
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  catchup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }

      - id: check
        name: Check latest Postman CLI
        run: |
          LATEST=$(npm view postman-cli version)
          CURRENT=$(jq -r .postmanCliVersion spec/commands.json)
          echo "latest=$LATEST"   >> $GITHUB_OUTPUT
          echo "current=$CURRENT" >> $GITHUB_OUTPUT
          [ "$LATEST" != "$CURRENT" ] && echo "outdated=true" >> $GITHUB_OUTPUT || true

      - if: steps.check.outputs.outdated == 'true'
        name: Install Postman CLI @ latest
        run: npm install -g postman-cli@${{ steps.check.outputs.latest }}

      - if: steps.check.outputs.outdated == 'true'
        name: Introspect → spec
        run: node scripts/introspect.mjs --out spec/commands.json.new

      - if: steps.check.outputs.outdated == 'true'
        name: Validate diff
        run: node scripts/validate-diff.mjs spec/commands.json spec/commands.json.new

      - if: steps.check.outputs.outdated == 'true'
        name: Commit spec + regenerate
        run: |
          mv spec/commands.json.new spec/commands.json
          node scripts/generate.mjs

      - if: steps.check.outputs.outdated == 'true'
        name: Lint completion scripts
        run: |
          shellcheck completions/bash/postman.bash
          zsh -n completions/zsh/_postman
          fish -n completions/fish/postman.fish

      - if: steps.check.outputs.outdated == 'true'
        name: Run tests
        run: npm test

      - if: steps.check.outputs.outdated == 'true'
        id: pr
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.CATCHUP_TOKEN || secrets.GITHUB_TOKEN }}
          branch: catchup/postman-cli-${{ steps.check.outputs.latest }}
          commit-message: "chore: catch up to Postman CLI v${{ steps.check.outputs.latest }}"
          title: "chore: catch up to Postman CLI v${{ steps.check.outputs.latest }}"
          body: |
            Automated catch-up: v${{ steps.check.outputs.current }} → v${{ steps.check.outputs.latest }}
            Generated by `.github/workflows/catchup.yml`.
          labels: automated,catchup

      - if: steps.pr.outputs.pull-request-number != ''
        name: Enable auto-merge
        env: { GH_TOKEN: ${{ secrets.CATCHUP_TOKEN || secrets.GITHUB_TOKEN }} }
        run: gh pr merge --squash --auto ${{ steps.pr.outputs.pull-request-number }}
```

> **Downstream triggering (issue #22).** The PR-creation and auto-merge steps must
> *not* use the default `GITHUB_TOKEN`. GitHub deliberately suppresses further
> workflow runs for events (`push`, `pull_request`) produced by `GITHUB_TOKEN`, to
> prevent recursive runs. If the catchup merge is attributed to `GITHUB_TOKEN`, the
> merge push to `main` will **not** fire `ci.yml` or `release.yml`, so a new upstream
> version is caught up but never released. Provide a **fine-grained PAT** as repo
> secret `CATCHUP_TOKEN` (Contents: read/write, Pull requests: read/write) so the
> merge is attributed to a real user and the downstream workflows run. The
> `|| secrets.GITHUB_TOKEN` fallback keeps the workflow from erroring before the
> secret is configured (at the cost of downstream triggering until it is set).

### 7.2 `.github/workflows/ci.yml` (PR checks)

Fires on every PR, including `catchup/*`. All of these must succeed before auto-merge is allowed:

- `npm test` — generator snapshot tests
- `shellcheck` on the bash script
- `zsh -n` and `fish -n` for syntax checks
- `node scripts/generate.mjs --check` — regenerate from the spec and confirm there is no diff

### 7.3 `.github/workflows/release.yml`

```yaml
name: release
on:
  push:
    branches: [main]
    paths: ["spec/commands.json"]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - id: ver
        run: |
          V=$(jq -r .postmanCliVersion spec/commands.json)
          echo "tag=v$V" >> $GITHUB_OUTPUT

      - id: exists
        run: |
          if git rev-parse "refs/tags/${{ steps.ver.outputs.tag }}" >/dev/null 2>&1; then
            echo "skip=true" >> $GITHUB_OUTPUT
          fi

      - if: steps.exists.outputs.skip != 'true'
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: |
          git tag ${{ steps.ver.outputs.tag }}
          git push origin ${{ steps.ver.outputs.tag }}
          gh release create ${{ steps.ver.outputs.tag }} \
            --title "${{ steps.ver.outputs.tag }}" \
            --notes "Updated to support Postman CLI ${{ steps.ver.outputs.tag }}." \
            completions/zsh/_postman \
            completions/bash/postman.bash \
            completions/fish/postman.fish
```

Note: if a re-release is needed while the upstream Postman CLI version is unchanged (e.g. emitter bug fix), append a build suffix to `postmanCliVersion` such as `1.35.2-1`. The corresponding git tag becomes `v1.35.2-1`.

---

## 8. Package scripts (`package.json`)

```json
{
  "name": "postman-cli-completion",
  "version": "0.0.0-managed-by-spec",
  "type": "module",
  "private": true,
  "scripts": {
    "introspect": "node scripts/introspect.mjs",
    "generate": "node scripts/generate.mjs",
    "generate:check": "node scripts/generate.mjs --check",
    "test": "node --test tests/"
  },
  "devDependencies": {
    "semver": "^7.6.0"
  }
}
```

---

## 9. Implementation roadmap (three PRs)

| PR | Scope | Primary risk |
|---|---|---|
| **PR-1: bootstrap** | Add `scripts/`, `spec/commands.json`, `package.json`, `tests/`, `docs/auto-catchup.md`. Replace existing completion scripts with generator output (verify equivalence by hand and via snapshot). CI: add `ci.yml` only. | Emitters not perfectly matching the current scripts / introspection accuracy gaps |
| **PR-2: catchup workflow** | Add `.github/workflows/catchup.yml`. Rehearse via `workflow_dispatch`. Tune `validate-diff` thresholds. | npm registry rate limits / edge cases that crash introspection |
| **PR-3: release workflow + first release** | Add `.github/workflows/release.yml`. Bump `spec/commands.json` once to trigger `release.yml` and cut the initial `v1.35.2` release. | Idempotency on tag collision |

Each PR is independently reviewable and revertable.

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `postman --help` output format changes upstream | Introspection breaks | Keep prior `--help` outputs in `tests/fixtures/` and regression-test the parser. On failure, no catchup PR opens — humans still have time to intervene. |
| Dynamic flags such as `--auth-<type>-<param>` | Completion candidates lost | Maintain them in `spec/overrides.json`. `introspect` never overwrites overrides. |
| Full auto-merge ships a broken script | Bad release reaches users | (a) Make `ci.yml` checks (shellcheck, shell syntax, snapshot tests) required via branch protection. (b) Trust `validate-diff` thresholds. (c) Rollback is two commands: `gh release delete` + tag deletion + revert commit. |
| Major upstream restructuring (e.g. subcommand tree change) | Breaks downstream users | Treat major-version bumps as `validate-diff` failures (future enhancement). Today's design assumes Postman CLI v1.x. |
| Postman CLI is closed-source | No authoritative spec | `--help` is treated as ground truth. Humans confirm diffs on the PR. We may add a 24-hour soak before auto-merge as a follow-up safeguard. |

---

## 11. Verification plan

Before merging **PR-1**:
- `npm run generate && git diff completions/` is empty (regeneration matches existing) — or equivalence is locked in by `tests/behavioral.test.mjs`.
- Exercise `postman <TAB>` in all three shells: zsh (after `compdef _postman postman`), bash (after `source completions/bash/postman.bash`), fish (after `funcsave`).
- `npm test` passes.

Rehearse **PR-2**:
- Temporarily downgrade `spec/commands.json`'s `postmanCliVersion` (e.g. to `1.35.1`) and commit. Trigger `workflow_dispatch`. Confirm a catchup PR is opened. Close the PR, delete the branch, revert the version bump.

After merging **PR-3**:
- The merge of PR-3 should fire `release.yml`, creating tag `v1.35.2` and a GitHub Release.
- `gh release view v1.35.2` lists the three completion assets.

---

## 12. Out of scope

- Homebrew tap / formula publishing.
- npm publish of `postman-cli-completion`.
- Dynamic completion of remote IDs (collection / workspace / monitor IDs) — explicitly excluded by `README.md`.
- Migrations across major upstream versions (handled by a future enhancement to `validate-diff`).
