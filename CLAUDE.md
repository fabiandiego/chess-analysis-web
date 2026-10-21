# CLAUDE.md

Guía para Claude Code en este repositorio. Idioma del proyecto: español (código en inglés, comentarios y UI en español).

## Qué es

Tablero de análisis de ajedrez 100 % en el navegador, sin backend ni suscripciones:
**TypeScript + Vite + chessground (tablero de Lichess) + chess.js (reglas) + Stockfish WASM (motor)**.
Se despliega como sitio estático en GitHub Pages.

Objetivo a medio plazo del autor (estudiante de ingeniería): **escribir un motor propio** y enchufarlo
en la misma interfaz para compararlo contra Stockfish. Toda decisión de arquitectura debe mantener
esa puerta abierta (ver "Motor propio" abajo).

## Comandos

```bash
npm install        # postinstall copia Stockfish a public/engine/ (scripts/copy-engine.mjs)
npm run dev        # servidor de desarrollo (Vite)
npm run typecheck  # tsc --noEmit
npm test           # vitest (tests/*.test.ts, entorno node)
npm run build      # copy-engine + typecheck + vite build -> dist/
npm run preview    # sirve dist/ para probar el build
npm run e2e        # prueba de humo en Chromium (móvil + escritorio) sobre dist/; requiere build previo
```

Antes de dar una tarea por terminada: `npm run typecheck && npm test && npm run build`.

## Arquitectura

```
src/
  main.ts            UI: conecta Game <-> chessground <-> motor. `sync()` es la única vía de refresco.
  game.ts            Línea principal + cursor sobre chess.js. Sin árbol de variantes (v0.1).
  engine/uci.ts      Parser UCI puro (sin DOM). Scores: UCI = bando que mueve; UI = blancas (toWhitePov).
  engine/engine.ts   UciEngine: Web Worker + máquina de estados idle/searching/stopping.
  ui/evalbar.ts      Barra de evaluación (curva logística tipo Lichess, cp acotado a ±1000).
  ui/promotion.ts    Selector de pieza al promocionar.
  ui/importer.ts     Panel "Mis partidas": busca por usuario y abre la partida (orienta el tablero al color del usuario).
  import/lichess.ts  GET lichess.org/api/games/user/{u} (NDJSON, pgnInJson). parseLichessNdjson es puro.
  import/chesscom.ts api.chess.com/pub/player/{u}/games/archives -> meses recientes EN SERIE (429 si se paraleliza).
  import/types.ts    ImportedGame normalizado, validación de usuario, errores HTTP legibles.
scripts/e2e-smoke.mjs    Playwright sobre dist/: sin scroll horizontal, Stockfish da líneas, sin errores JS.
scripts/copy-engine.mjs  Elige la variante "lite-single" del paquete npm `stockfish` y escribe manifest.json.
tests/               vitest.
.github/workflows/ci.yml  typecheck + test + build + deploy a Pages en cada push a main.
```

### Invariantes que no hay que romper

1. **Carrera UCI al cambiar de posición**: nunca enviar `position`/`go` mientras hay una búsqueda viva.
   `UciEngine` hace `stop`, descarta las `info` hasta el `bestmove` y entonces lanza la petición pendiente.
   Además `main.ts` filtra `info` cuyo `req.fen !== analysisFen`.
2. **Motor single-thread**: GitHub Pages no permite cabeceras COOP/COEP, así que no hay
   `SharedArrayBuffer` y las builds multihilo de Stockfish no funcionan allí. Si algún día se cambia
   de hosting, se puede pasar a multihilo (`Threads`) añadiendo esas cabeceras.
3. **Rutas relativas** (`base: './'`, `new URL(..., document.baseURI)`): el sitio vive bajo
   `/<repo>/` en Pages. No usar rutas absolutas `/engine/...`.
4. `public/engine/` está en .gitignore: se genera desde node_modules, no se versiona.
5. **Móvil sin desbordamiento horizontal**: columnas con `minmax(0, …)` / `min-width: 0` y el override
   de `coords.files` en style.css (chessground.base.css las desplaza 24 px fuera del tablero).
   `npm run e2e` lo comprueba en iPhone SE (320 px) y Pixel 7.
6. Colores de flechas en `ARROWS` (main.ts): el mismo color marca la línea en el panel. Mantenerlos sincronizados.

## Estado de verificación

El código se escribió en un entorno sin acceso a npm ni a lichess.org/chess.com. El primer CI
(install + typecheck + test + build) pasó, lo que confirma:

- [x] Las versiones de `package.json` resuelven e instalan.
- [x] chessground exporta `assets/*.css` y los tipos `api|types|draw`.
- [x] `copy-engine.mjs` encuentra Stockfish y el motor llega a `dist/engine/`.
- [x] `tests/game.test.ts` pasa contra chess.js real.

Pendiente (requiere navegador real):

- [ ] Generar y subir `package-lock.json`; cambiar el CI a `npm ci` con `cache: npm`.
- [x] Stockfish 17.1 lite-single carga su `.wasm` como worker y analiza (probado en Chromium, móvil y escritorio).
- [ ] Prueba manual en un teléfono real (Safari iOS y Chrome Android): arrastrar piezas, promoción.
- [ ] Importación: confirmar que Lichess y Chess.com responden con CORS desde `*.github.io` y que los
      campos JSON reales coinciden con los usados (`players.*.user.name`, `winner`, `status`, `pgn`;
      `white.result`, `time_class`, `rules`, `end_time`). Si Chess.com no permite CORS, la alternativa
      sin backend es pegar el PGN manualmente; con backend, un proxy mínimo (p. ej. un Worker gratuito).
- [ ] Chess.com pide un User-Agent identificable; desde el navegador no se puede fijar. Vigilar 403/429.

## Rendimiento en móvil

- En pantallas táctiles la profundidad por defecto es 20 (no infinita) y el motor se para con la pestaña oculta.
- Stockfish 17.1 lite pesa ~7,3 MB de `.wasm`. El paquete `stockfish` 19 trae un lite-single de ~1,7 MB
  (red más pequeña: carga más rápida, algo más débil). Candidato si la carga en móvil resulta lenta.

## Hoja de ruta sugerida

1. Cerrar la lista de verificación anterior y subir `package-lock.json`.
2. Árbol de variantes (en vez de truncar la línea principal) + exportar PGN con variantes.
3. Análisis de partida completa: evaluar cada ply, gráfica de evaluación, detectar errores/omisiones.
4. ~~Importar desde Lichess/Chess.com~~ (hecho, v0.2). Siguiente: caché en IndexedDB, filtros por ritmo/fecha,
   paginación (Lichess `until`, meses anteriores de Chess.com).
5. **Motor propio** (ver abajo).

## Motor propio

`UciEngine` acepta cualquier URL de worker que hable UCI por `postMessage`. Plan:

- `src/myengine/` en TypeScript: bitboards (BigInt es lento; usar pares de `Uint32` o mailbox 0x88
  para empezar), generación de movimientos validada con **perft**, negamax + alfa-beta + quiescence,
  profundización iterativa, tabla de transposición con Zobrist.
- Un `worker.ts` que implemente el bucle UCI y se cargue con
  `new Worker(new URL('./myengine/worker.ts', import.meta.url), { type: 'module' })`.
- Selector de motor en la UI y modo "partida motor contra motor" para medir progreso.
- Tests de perft en `tests/perft.test.ts` con los conteos de referencia (posición inicial, Kiwipete...).

## Licencia

chessground y Stockfish son GPL-3.0, así que el proyecto se distribuye como **GPL-3.0-or-later**.
Al publicar el sitio se distribuye Stockfish: mantener `STOCKFISH-LICENSE.txt` (lo copia el script)
y añadir el texto completo de la GPL-3.0 en `LICENSE`.
