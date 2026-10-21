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
  // Regresión: navegar con ▶ no debe desplazar la página (antes scrollIntoView movía el tablero fuera de pantalla).
  r.scrollShift = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    document.getElementById('pgn-input').value =
      '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7 9. Qd2 O-O 10. O-O-O Nbd7 11. g4 b5 12. g5 b4 13. Ne2 Ne8 14. f4 a5 15. f5 a4 *';
    document.getElementById('btn-pgn').click();
    document.getElementById('btn-start').click();
    window.scrollTo(0, 0);
    await sleep(200);
    const before = window.scrollY;
    for (let i = 0; i < 25; i++) { document.getElementById('btn-next').click(); await sleep(40); }
    return Math.round(window.scrollY - before);
  });
  const problems = [...errors];
  if (r.scrollShift !== 0) problems.push(`▶ desplazó la página ${r.scrollShift}px`);
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
