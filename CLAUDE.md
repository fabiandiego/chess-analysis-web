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

## Verificación inicial (hecha, 2026-10-20)

Comprobado con `npm install && npm run build` + prueba en Chromium headless (build servido bajo
`/chess-analysis-web/` y `npm run dev`), sin errores de consola:

- [x] Versiones: `@lichess-org/chessground ^10.5`, `chess.js ^1.4`, `stockfish ^19.0.1`, `vite ^8.3`,
      `vitest ^5`, `typescript ^7`. `package-lock.json` versionado; CI usa `npm ci`.
- [x] El paquete npm `chessground` está **retirado** ("no longer supported"); Lichess publica ahora
      `@lichess-org/chessground` (mismo repo y API, mismos subpaths `assets/*.css`, `api|types|draw`).
- [x] Stockfish 19 publica `bin/stockfish-19-lite-single.{js,wasm}` (sin hash); el script lo elige
      y vacía `public/engine/` antes de copiar para no arrastrar versiones viejas a `dist/`.
- [x] El `.js` carga su `.wasm` hermano como worker sin necesidad de `#ruta.wasm`.
- [x] `tests/game.test.ts` pasa contra chess.js real.
- [x] Manual: arrastre, promoción (selector), flechas MultiPV, barra, FEN/PGN, copiar PGN con
      cabeceras `SetUp`/`FEN`, teclado (←, Home, End), hash `#fen=` en la URL.

## Hoja de ruta sugerida

1. Árbol de variantes (en vez de truncar la línea principal) + exportar PGN con variantes.
2. Análisis de partida completa: evaluar cada ply, gráfica de evaluación, detectar errores/omisiones.
3. Guardar partidas en IndexedDB; importar desde la API pública de Lichess/Chess.com por usuario.
4. **Motor propio** (ver abajo).

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
y el texto completo de la GPL-3.0 en `LICENSE`.
