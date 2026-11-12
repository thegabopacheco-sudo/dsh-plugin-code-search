#!/usr/bin/env node
// dsh-plugin-code-search — busca símbolos en un proyecto local.
// Tools: status, search.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'code-search', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'code-search');
const MAX_FILES = 3000;
const MAX_DEPTH = 6;
const MAX_BYTES = 200 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', '.cache', 'target', 'coverage', 'vendor']);
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.php', '.rb']);
const PATTERNS = [
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm },
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm },
  { kind: 'function', regex: /^\s*def\s+([A-Za-z_]\w*)/gm },
  { kind: 'function', regex: /^\s*func\s+([A-Za-z_]\w*)/gm },
  { kind: 'class', regex: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
  { kind: 'const', regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/gm },
  { kind: 'export', regex: /^\s*export\s+(?:default\s+)?(?:const|let|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm },
];
const log = (m) => process.stderr.write(`[codesearch] ${m}\n`);

function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { allowedPaths: [] }; }
function allowedRoots() { const configured = loadConfig().allowedPaths; return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item)); }
function isAllowed(target) { const resolved = path.resolve(target); return allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }

function indexProject(rootInner) {
  const root = path.resolve(rootInner);
  if (!existsSync(root)) throw new Error(`la ruta no existe: ${root}`);
  if (!statSync(root).isDirectory()) throw new Error(`no es un directorio: ${root}`);
  if (!isAllowed(root)) throw new Error(`ruta no permitida: ${root} (revisa allowedPaths)`);
  const symbols = [];
  let files = 0;
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || files >= MAX_FILES) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files >= MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1); continue; }
      if (!CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      let stat = null;
      try { stat = statSync(full); } catch { continue; }
      if (stat.size > MAX_BYTES) continue;
      let text = '';
      try { text = readFileSync(full, 'utf8'); } catch { continue; }
      files++;
      const lines = text.split('\n');
      for (const pattern of PATTERNS) {
        pattern.regex.lastIndex = 0;
        let match;
        while ((match = pattern.regex.exec(text)) && symbols.length < 20000) {
          const line = text.slice(0, match.index).split('\n').length;
          symbols.push({ kind: pattern.kind, name: match[1], file: path.relative(root, full).split(path.sep).join('/'), line, excerpt: (lines[line - 1] || '').trim().slice(0, 160) });
        }
      }
    }
  };
  walk(root, 1);
  const unique = new Map();
  for (const symbol of symbols) unique.set(`${symbol.kind}|${symbol.name}|${symbol.file}|${symbol.line}`, symbol);
  return { root, files, symbols: [...unique.values()] };
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Code Search: busca símbolos en un proyecto local (funciones, clases, consts, exports).',
    '',
    'Herramientas: status, search.',
    '',
    'Reglas:',
    '- Solo lectura, sin índices externos: escanea archivos de código locales.',
    '- Devuelve archivo, línea y extracto; no inventes símbolos.',
    '- Respeta allowedPaths y omite node_modules/.git/build.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-code-search', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool(
    'status',
    { title: 'Estado', description: 'Rutas permitidas y modo.', inputSchema: z.object({}) },
    async () => textResult([`Rutas permitidas: ${allowedRoots().join(', ')}`, 'Modo: solo lectura'].join('\n')),
  );
  server.registerTool(
    'search',
    { title: 'Buscar símbolos', description: 'Busca símbolos por nombre y tipo.', inputSchema: z.object({ path: z.string().min(2), query: z.string().min(2).max(120), kind: z.enum(['function', 'class', 'const', 'export']).optional(), limit: z.number().int().min(1).max(200).optional() }) },
    async (args) => {
      const index = indexProject(args.path);
      const query = args.query.toLowerCase();
      let symbols = index.symbols.filter((symbol) => symbol.name.toLowerCase().includes(query));
      if (args.kind) symbols = symbols.filter((symbol) => symbol.kind === args.kind);
      symbols = symbols.slice(0, args.limit ?? 50);
      if (symbols.length === 0) return textResult(`Sin símbolos para "${args.query}" en ${index.files} archivos.`);
      return textResult([
        `Resultados: ${symbols.length} de ${index.symbols.length} símbolos (${index.files} archivos)`,
        '',
        ...symbols.map((symbol) => `- [${symbol.kind}] ${symbol.name} · ${symbol.file}:${symbol.line} · ${symbol.excerpt}`),
      ].join('\n'));
    },
  );
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log('code-search listo');
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
