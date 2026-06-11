# postman-cli-completion

Shell completion scripts for the [Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-overview/) (`postman`) on **zsh**, **bash**, and **fish**.

Completes:

- All top-level commands (`login`, `logout`, `collection`, `api`, `runner`, `spec`, `monitor`, `workspace`, `performance`, `flows`, `request`, `sdk`, `mock`, `application`, `simulate`) and their subcommands.
- Flags for each (sub)command — including all 40+ flags of `postman collection run`.
- Local file arguments such as `*.json` (collections, manifests) and `*.yaml`/`*.yml` (specs, simulate scenarios).

Dynamic completion of remote IDs (collection / workspace / monitor IDs) is **not** supported — paste those yourself.

## Install

Clone this repo somewhere, e.g. `~/.postman-cli-completion`:

```sh
git clone https://github.com/yokawasa/postman-cli-completion.git ~/.postman-cli-completion
```

### zsh

Add the completions directory to `fpath` and rerun `compinit`. Put this in `~/.zshrc`:

```sh
fpath=(~/.postman-cli-completion/completions/zsh $fpath)
autoload -Uz compinit && compinit
```

Or, for a quick test in the current shell:

```sh
source ~/.postman-cli-completion/completions/zsh/_postman
```

> **Note:** `compinit` must already be initialised in your shell for `source` to register the completion. Most zsh setups (oh-my-zsh, prezto, or a plain `.zshrc` that runs `autoload -Uz compinit && compinit`) do this automatically. If `postman <TAB>` still does nothing after sourcing, run `autoload -Uz compinit && compinit` first and try again.

### bash

Add to `~/.bashrc` (or `~/.bash_profile` on macOS):

```sh
source ~/.postman-cli-completion/completions/bash/postman.bash
```

Requires bash 4+ (`shopt -s extglob`). On macOS the system bash is 3.2 — install a newer bash via Homebrew (`brew install bash`) if needed.

### fish

Copy or symlink into fish's completion directory:

```sh
ln -s ~/.postman-cli-completion/completions/fish/postman.fish \
      ~/.config/fish/completions/postman.fish
```

Or source it in the current session:

```sh
source ~/.postman-cli-completion/completions/fish/postman.fish
```

## Verify (manual checklist)

After installing for your shell, open a fresh terminal and check each:

| Input | Expected |
| --- | --- |
| `postman <TAB>` | All 14 top-level commands appear |
| `postman col<TAB>` | Completes to `collection` |
| `postman collection <TAB>` | `migrate`, `lint`, `run` |
| `postman collection run <TAB>` | `*.json` files in the current directory |
| `postman collection run --<TAB>` | Flag list (`--environment`, `--iteration-data`, `--reporters`, …) |
| `postman collection run -r <TAB>` | `cli`, `json`, `junit`, `html` |
| `postman request <TAB>` | `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS` |
| `postman spec lint <TAB>` | `*.yaml` / `*.yml` / `*.json` files |
| `postman flows <TAB>` | `list`, `trigger`, `deploy`, `run`, `update`, `list-runs`, `get-run` |
| `postman --<TAB>` | `--silent`, `--color`, `--version`, `--help` |

## Versioning

These completions are written against **Postman CLI v1.35.2**. If the Postman CLI adds or renames commands/flags, the scripts will fall behind until updated. PRs welcome.

To check your installed version:

```sh
postman --version
```

## License

[MIT](./LICENSE) — see the LICENSE file.
