// Test end-to-end de code-search.
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
const project = path.join(tmpDir, 'proj');
mkdirSync(path.join(home, 'code-search'), { recursive: true });
mkdirSync(path.join(project, 'src'), { recursive: true });
mkdirSync(path.join(project, 'node_modules', 'x'), { recursive: true });
writeFileSync(path.join(home, 'code-search', 'config.json'), JSON.stringify({ allowedPaths: [project] }), 'utf8');
writeFileSync(path.join(project, 'src', 'a.js'), ['export function hello(nombre) {', '  return nombre;', '}', '', 'export class Foo {', '  metodo() {}', '}', '', 'const bar = (x) => x;'].join('\n'), 'utf8');
writeFileSync(path.join(project, 'src', 'b.py'), ['def procesar(datos):', '    return datos', ''].join('\n'), 'utf8');
writeFileSync(path.join(project, 'node_modules', 'x', 'skip.js'), 'export function oculto() {}\n', 'utf8');

function makeClient() {
  const entry = process.env.CODESEARCH_SERVER ? path.resolve(process.env.CODESEARCH_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'codesearch-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const hello = textOf(await client.callTool({ name: 'search', arguments: { path: project, query: 'hello' } }));
console.log('--- hello ---'); console.log(hello);
console.log('encuentra función:', hello.includes('[function] hello') && hello.includes('src/a.js:1'));
const foo = textOf(await client.callTool({ name: 'search', arguments: { path: project, query: 'Foo', kind: 'class' } }));
console.log('encuentra clase:', foo.includes('[class] Foo'));
const bar = textOf(await client.callTool({ name: 'search', arguments: { path: project, query: 'bar' } }));
console.log('encuentra const:', bar.includes('[const] bar') || bar.includes('[function] bar'));
const py = textOf(await client.callTool({ name: 'search', arguments: { path: project, query: 'procesar' } }));
console.log('encuentra python:', py.includes('src/b.py'));
console.log('ignora node_modules:', !hello.includes('oculto') && !py.includes('oculto'));
const none = textOf(await client.callTool({ name: 'search', arguments: { path: project, query: 'zzzz' } }));
console.log('sin resultados:', none.includes('Sin símbolos'));
const outside = await client.callTool({ name: 'search', arguments: { path: 'C:\\Windows', query: 'hello' } });
console.log('ruta fuera isError:', outside.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
console.log('OK');
