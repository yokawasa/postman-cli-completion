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

export function splitSections(text) {
  const lines = text.split("\n");
  const sections = { usage: "", arguments: [], options: [], commands: [] };
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

function parsePositionals(usage) {
  const parts = usage.split(/\s+/).slice(2);
  return parts.flatMap((p) => {
    if (p.startsWith("[options]") || p === "[command]") return [];
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

  const node = { positionals, flags };

  if (sections.commands.length) {
    const subs = [];
    for (const e of sections.commands) {
      const meta = parseCommandEntry(e);
      if (meta.name === "help") continue;
      if (!COMMAND_NAME.test(meta.name)) continue;
      const child = introspectCommand([...path, meta.name], helpText);
      if (child === null) continue;
      subs.push({
        name: meta.name,
        aliases: meta.aliases,
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
