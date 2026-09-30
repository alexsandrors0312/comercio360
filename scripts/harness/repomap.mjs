// scripts/harness/repomap.mjs — índice estrutural do Comércio 360 (sem dependências).
// Heurístico baseado em linhas; não é parser tree-sitter. Gera docs/ai/REPOMAP.md.
// Uso: node scripts/harness/repomap.mjs  (ou: npm run repomap)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "ai", "REPOMAP.md");
const CODE_DIRS = ["app", "lib", "packages", "scripts", "supabase", "tests"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".next-e2e", "coverage", "test-results", "playwright-report", ".agents", ".codex"]);
const CODE_EXT = new Set([".ts", ".tsx", ".mjs", ".js"]);
const MAX_SYMBOLS_PER_FILE = 80;
const MAX_TESTS_PER_FILE = 60;
const MAX_LINES_SIGNATURE = 8;
const MAX_LINE = 96;
const SHORT_RHS = 30;
const TEST_NAME_MAX = 52;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text, max = MAX_LINE) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function localDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Remove ": Tipo" dos parâmetros, preservando nomes, "?" e marcador de default.
function stripParamTypes(text) {
  const open = text.indexOf("(");
  if (open === -1) return text;
  let depth = 0;
  let quote = null;
  let out = "";
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      out += char;
      if (char === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; out += char; continue; }
    if (char === "(" || char === "[" || char === "{" || char === "<") { depth++; out += char; continue; }
    if (char === ")" || char === "]" || char === "}" || char === ">") {
      depth--;
      out += char;
      if (char === ")" && depth === 0) return out + text.slice(i + 1);
      continue;
    }
    if (char === ":" && depth === 1) {
      let j = i + 1;
      let inner = 0;
      while (j < text.length) {
        const next = text[j];
        if (next === "(" || next === "[" || next === "{" || next === "<") inner++;
        if (next === ")" || next === "]" || next === "}" || next === ">") inner--;
        if (inner < 0 || ((next === "," || next === ")") && inner === 0)) break;
        if (next === "=" && inner === 0) { out += " = …"; break; }
        j++;
      }
      if (out.endsWith(" = …")) { i = j; continue; }
      i = j;
      continue;
    }
    out += char;
  }
  return out;
}

function shortRhs(line, nameEnd) {
  const rhs = collapse(line.slice(nameEnd)).replace(/^=\s*/, "");
  if (rhs.length > SHORT_RHS || rhs.includes("=>") || rhs.includes("{") || rhs.includes("(") || rhs.startsWith("[")) return "…";
  return rhs;
}

function scanCodeFile(file) {
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inBlock = false;
  const push = (line, text) => {
    if (out.length >= MAX_SYMBOLS_PER_FILE) return;
    out.push(`- L${line + 1} ${truncate(text)}`);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (line.startsWith("/*")) { if (!line.includes("*/")) inBlock = true; continue; }
    if (line.startsWith("//") || line === "") continue;

    let match = line.match(/^['"]use (client|server)['"];?$/);
    if (match) { push(i, `"use ${match[1]}"`); continue; }

    match = line.match(/^export\s+default\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (match) {
      let sig = line.slice(match[0].length).trim();
      for (let j = i + 1; j < Math.min(lines.length, i + MAX_LINES_SIGNATURE) && !sig.endsWith("{") && !sig.endsWith(";"); j++) {
        sig += ` ${lines[j].trim()}`;
        if (lines[j].trim().endsWith("{")) break;
      }
      push(i, `export default function ${match[2]} ${truncate(collapse(stripParamTypes(sig)).replace(/\s*\{$/, "").replace(/,\s*\)/g, ")"), 60)}`);
      continue;
    }

    match = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (match) {
      let sig = line.slice(match[0].length).trim();
      for (let j = i + 1; j < Math.min(lines.length, i + MAX_LINES_SIGNATURE) && !sig.endsWith("{") && !sig.endsWith(";"); j++) {
        sig += ` ${lines[j].trim()}`;
        if (lines[j].trim().endsWith("{")) break;
      }
      const prefix = line.startsWith("export") ? "export " : "";
      push(i, `${prefix}function ${match[1]} ${truncate(collapse(stripParamTypes(sig)).replace(/\s*\{$/, "").replace(/,\s*\)/g, ")"), 64)}`);
      continue;
    }

    match = line.match(/^export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (match) { push(i, `class ${match[1]}`); continue; }

    match = line.match(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (match) { push(i, `export ${match[1]} ${match[2]} = ${shortRhs(line, match[0].length)}`); continue; }

    match = line.match(/^export\s+(interface|type)\s+([A-Za-z_$][\w$]*)/);
    if (match) {
      let sig = line.slice(match[0].length).trim();
      for (let j = i + 1; j < Math.min(lines.length, i + MAX_LINES_SIGNATURE) && !sig.endsWith("};") && !sig.endsWith("}"); j++) {
        sig += ` ${lines[j].trim()}`;
        if (lines[j].trim().endsWith("};") || lines[j].trim().endsWith("}")) break;
      }
      push(i, `export ${match[1]} ${match[2]} ${truncate(collapse(sig), 72)}`);
      continue;
    }

    match = line.match(/^export\s+\{([^}]*)\}/);
    if (match) { push(i, `export { ${collapse(match[1])} }`); }
  }
  return out;
}

function scanSqlFile(file) {
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const push = (line, text) => {
    if (out.length >= MAX_SYMBOLS_PER_FILE) return;
    out.push(`- L${line + 1} ${truncate(text)}`);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = collapse(lines[i]);
    if (line.startsWith("--") || line === "") continue;
    let match = line.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.]+)/i);
    if (match) { push(i, `CREATE TABLE ${match[1]}`); continue; }
    match = line.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s+ADD\s+(?:COLUMN\s+)?([\w"]+)/i);
    if (match) { push(i, `ALTER TABLE ${match[1]} ADD ${match[2]}`); continue; }
    match = line.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s+(ENABLE|DISABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/i);
    if (match) { push(i, `ALTER TABLE ${match[1]} ${match[2].toUpperCase()} RLS`); continue; }
    match = line.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\((.*)/i);
    if (match) {
      let args = match[2];
      for (let j = i + 1; j < Math.min(lines.length, i + MAX_LINES_SIGNATURE) && !/RETURNS/i.test(args) && !args.trim().endsWith(")"); j++) {
        args += ` ${collapse(lines[j])}`;
      }
      args = args.split(/RETURNS/i)[0].replace(/\)\s*$/, "").trim();
      push(i, `CREATE FUNCTION ${match[1]}(${args}) RETURNS …`);
      continue;
    }
    match = line.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?POLICY\s+([\w]+)\s+ON\s+([\w.]+)/i);
    if (match) { push(i, `CREATE POLICY ${match[1]} ON ${match[2]}`); continue; }
    match = line.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+([\w]+)/i);
    if (match) { push(i, `CREATE TRIGGER ${match[1]}`); continue; }
    match = line.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w]+)/i);
    if (match) { push(i, `CREATE INDEX ${match[1]}`); continue; }
    match = line.match(/^(GRANT|REVOKE)\s+(.+)$/i);
    if (match) {
      let stmt = match[2];
      if (!stmt.endsWith(";")) {
        for (let j = i + 1; j < Math.min(lines.length, i + MAX_LINES_SIGNATURE) && !lines[j].includes(";"); j++) {
          stmt += ` ${collapse(lines[j])}`;
        }
      }
      push(i, `${match[1].toUpperCase()} ${truncate(stmt.replace(/;$/, ""), 64)}`);
    }
  }
  return out;
}

function scanTestNames(file) {
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^(?:await\s+)?(describe|it|test)\(\s*(['"`])([^'"`]+)\2\s*,/);
    if (match) {
      out.push(`- L${i + 1} ${match[1]}('${truncate(match[3], TEST_NAME_MAX)}')`);
      if (out.length >= MAX_TESTS_PER_FILE) break;
    }
  }
  return out;
}

function relPath(file) {
  return relative(ROOT, file).split("\\").join("/");
}

const HARNESS_INTERNALS = new Set(["scripts/harness/validate.mjs", "scripts/harness/check-skills.mjs", "scripts/harness/repomap.mjs"]);
const HARNESS_NOTES = [
  "- scripts/harness/validate.mjs — validador de envelopes/resultados 0.1 (CLI: `node scripts/harness/validate.mjs task|result …`)",
  "- scripts/harness/check-skills.mjs — confere estrutura das seis skills",
  "- scripts/harness/repomap.mjs — gera este índice",
];

function main() {
  const codeFiles = [];
  for (const dir of CODE_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const ext = file.slice(file.lastIndexOf("."));
      if (CODE_EXT.has(ext) || ext === ".sql") codeFiles.push(file);
    }
  }
  codeFiles.sort();

  const sections = { code: [], tests: [], sql: [] };
  let symbols = 0;
  for (const file of codeFiles) {
    const rel = relPath(file);
    if (HARNESS_INTERNALS.has(rel)) continue;
    if (file.endsWith(".sql")) {
      const items = scanSqlFile(file);
      if (items.length) { sections.sql.push(`### ${rel}\n${items.join("\n")}`); symbols += items.length; }
    } else if (/^tests\//.test(rel) || /\.(test|spec)\./.test(rel)) {
      const tests = scanTestNames(file);
      if (tests.length) { sections.tests.push(`### ${rel}\n${tests.join("\n")}`); symbols += tests.length; }
    } else {
      const items = scanCodeFile(file);
      if (items.length) { sections.code.push(`### ${rel}\n${items.join("\n")}`); symbols += items.length; }
    }
  }

  const lines = [
    "# RepoMap — índice estrutural do Comércio 360",
    "",
    `Gerado em ${localDate()} por \`npm run repomap\`. Heurístico de linhas, sem dependências (aproximação deliberada de tree-sitter para não alterar o lockfile); tipos de parâmetros omitidos — leia o arquivo para o contrato completo. Regenerar após mudanças estruturais. Estimativa: ~4 bytes/token. Roteamento de documentos: \`context.md\` e \`docs/ai/H04_RESULTADOS_INDICE.md\`.`,
    "",
    "## Código e símbolos",
    "",
    ...(sections.code.length ? sections.code : ["(sem símbolos extraídos)"]),
    "",
    "## Scripts do harness",
    "",
    ...HARNESS_NOTES,
    "",
    "## Migrações SQL",
    "",
    ...(sections.sql.length ? sections.sql : ["(nenhuma migração encontrada)"]),
    "",
    "## Testes (describe/it/test)",
    "",
    ...(sections.tests.length ? sections.tests : ["(nenhum teste mapeado)"]),
    "",
  ];
  const content = lines.join("\n");
  writeFileSync(OUT, content, "utf8");
  const tokens = Math.round(content.length / 4);
  return { files: codeFiles.length - HARNESS_INTERNALS.size, symbols, bytes: content.length, tokens };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const stats = main();
  console.log(`REPOMAP.md: ${stats.files} arquivos, ${stats.symbols} símbolos, ${stats.bytes} bytes (~${stats.tokens} tokens estimados)`);
}
