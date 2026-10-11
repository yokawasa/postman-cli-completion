#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0
  ? resolve(process.cwd(), args[outIdx + 1])
  : resolve(REPO_ROOT, "spec/commands.json");
const postmanBin = process.env.POSTMAN_BIN || "postman";

const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s) {
  return s.replace(ANSI, "");
}

function help(argv) {
  const out = execFileSync(postmanBin, [...argv, "--help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return stripAnsi(out);
}

function getVersion() {
  return execFileSync(postmanBin, ["--version"], { encoding: "utf8" }).trim();
}

// Postman CLI v1.73.0 reformatted the *top-level* `postman --help` from
// commander.js's "Usage:/Options:/Commands:" layout to a gh-style one with
// uppercase headings, commands grouped across several "<GROUP> COMMANDS"
// blocks, names suffixed with a colon (`api:`), and aliases split out into
// their own ALIAS COMMANDS block (issue #61). Subcommand help is still
// commander.js, so both layouts have to parse.
const UPPERCASE_HEADING = /^[A-Z][A-Z ]*$/;

export function isModernHelp(text) {
  return text.split("\n").some((l) => /^USAGE\s*$/.test(l));
}

function splitSectionsModern(text) {
  const lines = text.split("\n");
  const sections = {
    usage: "", arguments: [], options: [], commands: [], aliases: [],
  };

  // Command groups are additive: CORE/AGENT/AUTHENTICATION/ADDITIONAL all list
  // real commands, so their entries accumulate into one list.
  const acc = { arguments: [], options: [], commands: [], aliases: [] };
  let current = null;

  for (const line of lines) {
    if (UPPERCASE_HEADING.test(line.trim()) && /^\S/.test(line)) {
      const heading = line.trim();
      if (heading === "USAGE") { current = "usage"; continue; }
      if (heading === "FLAGS" || heading === "OPTIONS") { current = "options"; continue; }
      if (heading === "ARGUMENTS") { current = "arguments"; continue; }
      if (heading === "ALIAS COMMANDS") { current = "aliases"; continue; }
      if (/ COMMANDS$/.test(heading)) { current = "commands"; continue; }
      current = null;                       // EXAMPLES, LEARN MORE, …
      continue;
    }
    if (current === "usage") {
      if (!sections.usage && line.trim()) sections.usage = line.trim();
      continue;
    }
    if (current && line.trim()) acc[current].push(line);
  }

  for (const key of ["arguments", "options", "commands", "aliases"]) {
    if (acc[key].length) sections[key] = parseEntries(acc[key]);
  }
  // `api:` → `api`; the colon is purely decorative in this layout.
  for (const key of ["commands", "aliases"]) {
    for (const e of sections[key]) e.head = e.head.replace(/:$/, "");
  }
  return sections;
}

function splitSectionsLegacy(text) {
  const lines = text.split("\n");
  const sections = {
    usage: "", arguments: [], options: [], commands: [], aliases: [],
  };
  let i = 0;

  while (i < lines.length && !lines[i].startsWith("Usage:")) i++;
  if (i < lines.length) sections.usage = lines[i].replace(/^Usage:\s*/, "");

  let current = null;
  let acc = [];
  const flush = () => {
    if (current && acc.length) sections[current] = parseEntries(acc);
    acc = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^Arguments:\s*$/.test(line)) { flush(); current = "arguments"; continue; }
    if (/^Options:\s*$/.test(line))   { flush(); current = "options";   continue; }
    if (/^Commands:\s*$/.test(line))  { flush(); current = "commands";  continue; }
    if (/^\S/.test(line)) { flush(); current = null; continue; }
    if (current) acc.push(line);
  }
  flush();
  return sections;
}

export function splitSections(text) {
  return isModernHelp(text)
    ? splitSectionsModern(text)
    : splitSectionsLegacy(text);
}

// The gh-style FLAGS block lists only long forms, but the shorts it dropped
// (`postman -v`, `postman -h`) still work. Re-attach them so completions do not
// regress; keyed by long flag, applied to the root command only.
const ROOT_SHORT_FLAGS = { "--version": "-v", "--help": "-h" };

export function restoreRootShortFlags(flags) {
  for (const f of flags) {
    const short = ROOT_SHORT_FLAGS[f.long];
    if (short && !f.short) f.short = short;
  }
  return flags;
}

// ALIAS COMMANDS rows read `fl:  Alias for "flows"`. Fold them back onto the
// target so completions keep offering the short forms, as they did when
// commander.js rendered them inline (`flows|fl`).
export function parseAliasEntries(entries) {
  const byTarget = new Map();
  for (const e of entries) {
    const m = e.desc.match(/alias for ["'`]?([a-z][\w-]*)/i);
    if (!m) continue;
    const alias = e.head.replace(/:$/, "").trim();
    if (!COMMAND_NAME.test(alias)) continue;
    if (!byTarget.has(m[1])) byTarget.set(m[1], []);
    byTarget.get(m[1]).push(alias);
  }
  return byTarget;
}

export function parseEntries(lines) {
  const entries = [];
  let cur = null;
  const finish = () => {
    if (cur) {
      cur.head = cur.head.trim();
      cur.desc = cur.desc.replace(/\s+/g, " ").trim();
      entries.push(cur);
    }
    cur = null;
  };

  const isNewEntry = (content) => {
    if (!/  /.test(content)) return false;
    if (/^-{1,2}[a-zA-Z]/.test(content)) return true;
    if (/^[a-z][\w-]*\s/.test(content)) return true;
    return false;
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = raw.match(/^(\s+)(\S.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const content = m[2];

    if (indent <= 2 || isNewEntry(content)) {
      finish();
      const cols = content.split(/  +/);
      cur = { head: cols[0], desc: cols.slice(1).join(" ") };
    } else if (cur) {
      cur.desc += " " + content;
    }
  }
  finish();
  return entries;
}

const USAGE_PLACEHOLDERS = new Set([
  "[options]", "[command]", "[flags]", "[subcommand]", "<command>", "<subcommand>",
]);

function parsePositionals(usage) {
  const parts = usage.split(/\s+/).slice(2);
  return parts.flatMap((p) => {
    if (p.startsWith("[options]") || USAGE_PLACEHOLDERS.has(p)) return [];
    const m = p.match(/^[<\[](.+?)[>\]]$/);
    if (!m) return [];
    const name = m[1];
    return [{ name, valueType: inferValueType(name, name) }];
  });
}

function inferValueType(name, flagName) {
  const lower = (name || "").toLowerCase();
  const fname = (flagName || "").toLowerCase();
  if (/(^|-)(working-)?dir(ectory)?($|-)/.test(fname)) return "dir";
  if (/(^|-)(path|file|dir|directory|collection|environment|globals|iteration-data|cookie-jar|cert|key|cert-list|mock|simulate)/.test(lower)) {
    return "file";
  }
  if (lower === "n" || lower === "ms" || lower.endsWith("-count") || lower.endsWith("-delay")) {
    return "number";
  }
  return "string";
}

export function parseFlag(headRaw) {
  const head = headRaw.trim();
  const tokens = head.split(/\s+/);
  let short, long, value, valueOptional = false;

  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i].replace(/,$/, "");
    if (t.startsWith("--")) long = t;
    else if (t.startsWith("-") && t.length >= 2) short = t;
    else if (t.startsWith("<") || t.startsWith("[")) {
      value = t.replace(/^[<\[]|[>\]]$/g, "");
      valueOptional = t.startsWith("[");
    }
  }
  if (!long && !short) return null;

  const flag = { long, short };
  if (!short) delete flag.short;
  if (!long) delete flag.long;
  if (value !== undefined) {
    flag.valueType = inferValueType(value, long || short);
    flag.valueName = value;
    if (valueOptional) flag.valueOptional = true;
    if (flag.valueType === "file") {
      flag.patterns = guessPatterns(long || short, value);
    }
  }
  return flag;
}

function guessPatterns(name, value) {
  const n = (name + " " + value).toLowerCase();
  if (n.includes("cookie-jar")) return ["*.json"];
  if (n.includes("config")) return ["*.json"];
  if (n.includes("iteration-data")) return ["*.json", "*.csv"];
  if (n.includes("cert") || n.includes("key") || n.includes("ssl")) return ["*.pem", "*.crt", "*.key"];
  if (n.includes("simulate")) return ["*.sim.yaml", "*.yaml", "*.yml"];
  if (n.includes("spec") || n.includes("openapi")) return ["*.yaml", "*.yml", "*.json"];
  return ["*.json"];
}

export function parseCommandEntry(entry) {
  const tokens = entry.head.split(/\s+/);
  const nameTok = tokens[0];
  const [name, ...aliases] = nameTok.split("|");
  const positionals = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "[options]") continue;
    const m = t.match(/^[<\[](.+?)[>\]]$/);
    if (m) positionals.push({ name: m[1], valueType: inferValueType(m[1], m[1]) });
  }
  return { name, aliases, positionals, description: entry.desc };
}

const COMMAND_NAME = /^[a-z][\w-]*$/;
const MAX_DEPTH = 6;

function introspectCommand(path, parentHelp = null) {
  if (path.length > MAX_DEPTH) {
    throw new Error(`recursion depth exceeded at ${path.join(" ")}`);
  }
  const helpText = help(path);
  if (parentHelp && helpText === parentHelp) {
    return null;
  }
  const sections = splitSections(helpText);
  const positionals = parsePositionals(sections.usage);

  const flags = sections.options
    .map((e) => {
      const f = parseFlag(e.head);
      if (!f) return null;
      f.description = e.desc;
      if ((f.long && /[<>[\]]/.test(f.long)) || (f.short && /[<>[\]]/.test(f.short))) {
        f.dynamic = true;
      }
      return f;
    })
    .filter(Boolean);

  const node = {
    positionals,
    flags: path.length === 0 ? restoreRootShortFlags(flags) : flags,
  };

  if (sections.commands.length) {
    const aliasesByTarget = parseAliasEntries(sections.aliases || []);
    const subs = [];
    for (const e of sections.commands) {
      const meta = parseCommandEntry(e);
      if (meta.name === "help") continue;
      if (!COMMAND_NAME.test(meta.name)) continue;
      const child = introspectCommand([...path, meta.name], helpText);
      if (child === null) continue;
      subs.push({
        name: meta.name,
        aliases: [...meta.aliases, ...(aliasesByTarget.get(meta.name) || [])],
        description: meta.description,
        positionals: meta.positionals.length ? meta.positionals : child.positionals,
        flags: child.flags,
        ...(child.subcommands ? { subcommands: child.subcommands } : {}),
      });
    }
    node.subcommands = subs;
  }

  return node;
}

function main() {
  const version = getVersion();
  process.stderr.write(`Introspecting postman v${version}…\n`);
  const root = introspectCommand([]);

  // An empty command list always means the help layout changed under us, never
  // that `postman` genuinely has no commands. Fail here rather than writing a
  // hollow spec and leaving validate-diff to report the symptom (issue #61).
  if (!root?.subcommands?.length) {
    throw new Error(
      `parsed 0 top-level commands from \`${postmanBin} --help\` — ` +
      `the help output format likely changed; update splitSections()`
    );
  }

  const spec = {
    postmanCliVersion: version,
    introspectedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    global: { flags: root.flags },
    commands: (root.subcommands || []).map((c) => ({
      name: c.name,
      aliases: c.aliases?.length ? c.aliases : undefined,
      description: c.description,
      positionals: c.positionals?.length ? c.positionals : undefined,
      flags: c.flags?.length ? c.flags : undefined,
      subcommands: c.subcommands?.length ? c.subcommands : undefined,
    })),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + "\n");
  process.stderr.write(`Wrote ${outPath}\n`);
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  try {
    main();
  } catch (err) {
    if (err.code === "ENOENT") {
      process.stderr.write(`error: postman CLI not found (POSTMAN_BIN=${postmanBin})\n`);
    } else {
      process.stderr.write(`error: ${err.message}\n`);
    }
    process.exit(1);
  }
}
