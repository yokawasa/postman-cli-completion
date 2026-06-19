#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// bin/ lives one level under the package root. Resolve completion files relative
// to this module (NOT process.cwd(), which is the user's shell directory).
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  zsh: resolve(PKG_ROOT, "completions/zsh/_postman"),
  bash: resolve(PKG_ROOT, "completions/bash/postman.bash"),
  fish: resolve(PKG_ROOT, "completions/fish/postman.fish"),
};

const USAGE = `postman-completion — shell completions for the Postman CLI

Note: this installs the command "postman-completion"; it does NOT shadow the
real "postman" CLI (install that separately via "npm i -g postman-cli").

Usage:
  postman-completion <zsh|bash|fish>          Print the completion script to stdout
  postman-completion path <zsh|bash|fish>     Print the packaged file's absolute path
  postman-completion path <shell> --dir       Print the file's directory (for zsh fpath)
  postman-completion --help                   Show this help

Wire it into your shell:

  # bash — add to ~/.bashrc (requires bash 4+)
  source <(postman-completion bash)

  # zsh — quick test in the current shell (compinit must be initialised)
  source <(postman-completion zsh)

  # zsh — persistent, add to ~/.zshrc
  fpath=("$(postman-completion path zsh --dir)" $fpath)
  autoload -Uz compinit && compinit

  # fish — in the current session
  postman-completion fish | source
`;

function die(message) {
  process.stderr.write(`postman-completion: ${message}\n`);
  process.exit(1);
}

function emit(shell) {
  const file = FILES[shell];
  if (!file) die(`unknown shell: ${shell} (expected zsh, bash, or fish)`);
  process.stdout.write(readFileSync(file, "utf8"));
}

function printPath(args) {
  const dirOnly = args.includes("--dir");
  const shell = args.find((a) => a !== "--dir");
  const file = FILES[shell];
  if (!file) die(`unknown shell: ${shell ?? "(none)"} (expected zsh, bash, or fish)`);
  process.stdout.write(`${dirOnly ? dirname(file) : file}\n`);
}

function main(argv) {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(USAGE);
    return;
  }

  if (cmd === "path") {
    printPath(rest);
    return;
  }

  if (cmd in FILES) {
    emit(cmd);
    return;
  }

  die(`unknown command: ${cmd}\n\n${USAGE}`);
}

main(process.argv.slice(2));
