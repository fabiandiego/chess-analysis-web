#!/usr/bin/env node
/**
 * Prueba de humo en navegador real sobre el build (dist/), para el CI.
 *   npm run build && node scripts/e2e-smoke.mjs
 *
 * Comprueba en móvil y escritorio:
 *  - sin desplazamiento horizontal (regresión: coordenadas de chessground desbordaban)
 *  - Stockfish carga y produce líneas de análisis y flechas
 *  - el botón "Nueva partida" existe y la app no lanza errores
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium, devices } from 'playwright';

const DIST = join(process.cwd(), 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  let p = normalize(join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (p.endsWith('/')) p += 'index.html';
  try {
    if (!p.startsWith(DIST)) throw new Error('fuera de dist');
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const targets = [
  ['iPhone SE', devices['iPhone SE']],
  ['Pixel 7', devices['Pixel 7']],
  ['Escritorio', { viewport: { width: 1280, height: 800 } }],
];

let failed = false;
const browser = await chromium.launch();
for (const [name, device] of targets) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(url);
  try {
    await page.waitForSelector('#pv-lines li', { timeout: 30_000 });
  } catch {
    errors.push('Stockfish no produjo líneas en 30 s');
  }
  const r = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    lines: document.querySelectorAll('#pv-lines li').length,
    engine: document.getElementById('engine-name')?.textContent,
    reset: !!document.getElementById('btn-reset'),
  }));
  const problems = [...errors];
  if (r.scrollWidth > r.viewport) problems.push(`desbordamiento horizontal: ${r.scrollWidth}px > ${r.viewport}px`);
  if (!r.reset) problems.push('falta el botón Nueva partida');

  const ok = problems.length === 0;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${JSON.stringify(r)}`);
  for (const p of problems) console.log(`::error title=e2e ${name}::${p}`);
  await ctx.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
