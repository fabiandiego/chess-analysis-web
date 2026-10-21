# CLAUDE.md

Guía para Claude Code en este repositorio. Idioma del proyecto: español (código en inglés, comentarios en español). La UI es multilingüe: es / en / ru.

## Qué es

Tablero de análisis de ajedrez 100 % en el navegador, sin backend ni suscripciones:
**TypeScript + Vite + chessground (tablero de Lichess) + chess.js (reglas) + Stockfish WASM (motor)**.
Se despliega como sitio estático en GitHub Pages.

Objetivo a medio plazo del autor (estudiante de ingeniería): **escribir un motor propio** y enchufarlo
en la misma interfaz para compararlo contra Stockfish. Toda decisión de arquitectura debe mantener
esa puerta abierta (ver "Motor propio" abajo).

## Versiones y ramas

- `main` = **v1** publicada (etiqueta `v1.0.0`). Cada push a `main` despliega en GitHub Pages; solo
  arreglos de v1, siempre por PR. Al arreglar algo en `main`, llevarlo también a `v2` (merge `main` → `v2`).
- `v2` = **versión 2 en desarrollo** (`package.json` 2.0.0-dev.N). Los PR de v2 van con base `v2`; su CI
  corre en cada push pero no publica. v2 sale con un PR `v2` → `main` y la etiqueta `v2.0.0`.
- `CHANGELOG.md`: cada PR añade su línea en "Sin publicar"; al cerrar versión se le pone número y fecha.

## Comandos

Node 22.12+ (lo exige Vitest 5). Sitio publicado: https://fabiandiego.github.io/chess-analysis-web/

```bash
npm install        # postinstall: copia Stockfish a public/engine/ y genera src/openings/book.json
npm run dev        # servidor de desarrollo (Vite)
npm run typecheck  # tsc --noEmit
npm test           # vitest (tests/*.test.ts, entorno node)
npm run build      # copy-engine + build-openings + typecheck + vite build -> dist/
npm run preview    # sirve dist/ para probar el build
npm run e2e        # prueba de humo en Chromium (móvil + escritorio) sobre dist/; requiere build previo
```

Antes de dar una tarea por terminada: `npm run typecheck && npm test && npm run build`
(y `npm run e2e` si se toca el layout, la cabecera o el motor).

## Arquitectura

```
src/
  main.ts            UI: conecta Game <-> chessground <-> motor. `sync()` es la única vía de refresco.
  game.ts            Línea principal + cursor sobre chess.js. Sin árbol de variantes (llega en v2).
  engine/uci.ts      Parser UCI puro (sin DOM). Scores: UCI = bando que mueve; UI = blancas (toWhitePov).
  engine/engine.ts   UciEngine: Web Worker + máquina de estados idle/searching/stopping.
  ui/evalbar.ts      Barra de evaluación (curva logística tipo Lichess, cp acotado a ±1000).
  ui/promotion.ts    Selector de pieza al promocionar.
  openings/openings.ts  identifyOpening(): ECO + nombre por posición (transposiciones incluidas),
                     la más profunda de la línea hasta el cursor. Libro cargado bajo demanda (chunk aparte).
  review/classify.ts classifyMove(): mejor / excelente / buena / imprecisión / error / error grave por
                     puntos esperados perdidos (umbrales de chess.com, curva de Lichess). Puro. "Libro" lo decide main.ts.
  i18n/es.ts         Textos de la UI; fuente de verdad de las claves (`Messages`). en.ts y ru.ts se tipan con ella.
  i18n/i18n.ts       `t` (binding vivo), setLang, detectLang (guardado > navegador > es), lookup para `data-i18n`.
  ui/importer.ts     Panel "Mis partidas": busca por usuario y abre la partida (orienta el tablero al color del usuario).
  import/lichess.ts  GET lichess.org/api/games/user/{u} (NDJSON, pgnInJson). parseLichessNdjson es puro.
  import/chesscom.ts api.chess.com/pub/player/{u}/games/archives -> meses recientes EN SERIE (429 si se paraleliza).
  import/types.ts    ImportedGame normalizado, validación de usuario, ImportError con código (la UI lo traduce).
scripts/e2e-smoke.mjs    Playwright sobre dist/: sin scroll horizontal, Stockfish da líneas, sin errores JS.
scripts/copy-engine.mjs  Elige la variante "lite-single" del paquete npm `stockfish` y escribe manifest.json.
scripts/build-openings.mjs  data/openings/*.tsv (Lichess, CC0) -> src/openings/book.json (generado, no versionado).
tests/               vitest: game, uci, openings, import, i18n, classify.
.github/workflows/ci.yml  typecheck + test + build + e2e en cada push y PR; deploy a Pages solo desde main.
```

### Invariantes que no hay que romper

1. **Carrera UCI al cambiar de posición**: nunca enviar `position`/`go` mientras hay una búsqueda viva.
   `UciEngine` hace `stop`, descarta las `info` hasta el `bestmove` y entonces lanza la petición pendiente.
   Además `main.ts` filtra `info` cuyo `req.fen !== analysisFen`.
2. **Motor single-thread**: GitHub Pages no permite cabeceras COOP/COEP, así que no hay
   `SharedArrayBuffer` y las builds multihilo de Stockfish no funcionan allí. Para pasar a multihilo
   (`Threads`): otro hosting con esas cabeceras, o un service worker que las inyecte
   (coi-serviceworker; la primera visita recarga la página). Se descartó de momento (2026-10-21).
3. **Rutas relativas** (`base: './'`, `new URL(..., document.baseURI)`): el sitio vive bajo
   `/<repo>/` en Pages. No usar rutas absolutas `/engine/...`.
4. `public/engine/` y `src/openings/book.json` están en .gitignore: se generan en `postinstall`/`build`.
5. **Móvil sin desbordamiento horizontal**: columnas con `minmax(0, …)` / `min-width: 0` y el override
   de `coords.files` en style.css (chessground.base.css las desplaza 24 px fuera del tablero).
   `npm run e2e` lo comprueba en iPhone SE (320 px) y Pixel 7.
6. **Nunca `scrollIntoView()`** para la lista de jugadas: desplaza la página entera. Usar `keepVisibleInside()`.
   `npm run e2e` comprueba que ▶ no mueve la página.
7. Colores de flechas en `ARROWS` (main.ts): el mismo color marca la línea en el panel. Mantenerlos sincronizados.
8. La clave del libro de aperturas es el FEN de chess.js sin contadores (`positionKey`), igual en el
   script y en tiempo de ejecución. No calcularla con otra librería: la casilla al paso podría diferir.
9. **Textos de la UI siempre por `t`** (`src/i18n/`), nunca literales en main.ts/ui/*. Lo estático de
   index.html lleva `data-i18n` / `data-i18n-title` / `-aria-label` / `-placeholder` (el texto español
   del HTML es solo el respaldo). Las capas sin DOM (game.ts, import/*) devuelven **códigos**
   (`GameStatus`, `ImportError.code`) y la UI los traduce. Al añadir un texto: clave en es.ts → tsc
   obliga a ponerla en en.ts y ru.ts; tests/i18n.test.ts comprueba claves del HTML y paridad.
   Al cambiar de idioma no se reinicia el análisis: `applyLanguage()` repinta lo que ya está en pantalla.
10. **Valoración de jugadas** (main.ts): `evals` guarda la mejor evaluación multipv 1 *exacta* por
   `positionKey`, venga de donde venga. `nextRequest()` encadena (cada una desde `onBestMove`, misma
   cola: invariante 1 intacta): (1) valoración a `REVIEW_DEPTH` = 18 de la posición ANTERIOR si le
   falta, (2) análisis en vivo de la actual a `LIVE_DEPTH` = 10, (3) valoración a 18 de la actual.
   Las peticiones de valoración van en `reviewRequests` (WeakSet): no pintan líneas, y al terminar
   marcan su posición en `reviewDone` aunque no lleguen a 18 (mate visto antes); sin eso la valoración
   se quedaría "pendiente" para siempre. El análisis en vivo NO marca `reviewDone` (se queda en 10).
   Con profundidad 14 Stockfish lite no veía mates con sacrificio y salían valoraciones incoherentes.
   Símbolos y colores en `CLASS_STYLE`; en `customSvg` de chessground la casilla va de 0 a 100 desde su
   esquina superior izquierda (no desde el centro).

## Estado de verificación

Comprobado con `npm ci && npm run build` + Chromium headless (build servido bajo `/chess-analysis-web/`
y `npm run dev`), sin errores de consola:

- [x] Versiones: `@lichess-org/chessground ^10.5`, `chess.js ^1.4`, `stockfish ^19.0.1`, `vite ^8.3`,
      `vitest ^5`, `typescript ^7`. `package-lock.json` versionado; CI usa `npm ci` con `cache: npm`.
- [x] El paquete npm `chessground` está **retirado** ("no longer supported"); Lichess publica ahora
      `@lichess-org/chessground` (mismo repo y API, mismos subpaths `assets/*.css`, `api|types|draw`).
- [x] Stockfish 19 publica `bin/stockfish-19-lite-single.{js,wasm}` (sin hash); el script lo elige
      y vacía `public/engine/` antes de copiar para no arrastrar versiones viejas a `dist/`.
      El `.js` carga su `.wasm` hermano como worker sin necesidad de `#ruta.wasm`.
- [x] Los tests (`game`, `uci`, `openings`, `import`, `i18n`, `classify`) pasan contra chess.js real.
- [x] Manual: arrastre, promoción (selector), flechas MultiPV, barra, FEN/PGN, copiar PGN con
      cabeceras `SetUp`/`FEN`, teclado (←, Home, End), hash `#fen=` en la URL, nombre de apertura,
      cambio de idioma es/en/ru (persiste al recargar; sin restos en español en ru), valoración de
      jugadas (Opera de Morphy: 9…b5 error, 15.Bxd7+ mejor; 3…Nf6?? en el mate del pastor, error grave).

Pendiente:

- [ ] Prueba manual en un teléfono real (Safari iOS y Chrome Android): arrastrar piezas, promoción.
- [ ] Importación: confirmar que Lichess y Chess.com responden con CORS desde `*.github.io` (no se pudo
      comprobar desde el entorno de Claude: su proxy bloquea ambos dominios) y que los campos JSON reales coinciden con los usados (`players.*.user.name`, `winner`, `status`, `pgn`;
      `white.result`, `time_class`, `rules`, `end_time`). Si Chess.com no permite CORS, la alternativa
      sin backend es pegar el PGN manualmente; con backend, un proxy mínimo (p. ej. un Worker gratuito).
- [ ] Chess.com pide un User-Agent identificable; desde el navegador no se puede fijar. Vigilar 403/429.
- [ ] Revisión de las traducciones por hablantes nativos (`src/i18n/en.ts`, `src/i18n/ru.ts`).
- [ ] CI: GitHub avisa de que `actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4` (dentro de
      `upload-pages-artifact@v3`) y `deploy-pages@v4` usan Node 20 y los fuerza a Node 24. Funciona,
      pero conviene subir a las versiones mayores que usen Node 24.

## Rendimiento en móvil

- Análisis en vivo fijo: `LIVE_DEPTH` = 10 y `LIVE_LINES` = 3 (main.ts; sin selectores en la UI). Tras él, la
  búsqueda de valoración a 18 y el motor queda parado: nada de `go infinite`. El motor se para con la pestaña oculta.
  Recorrer la Opera de Morphy (33 plies) jugada a jugada: ~32 s (antes, con análisis infinito, ~112 s).
- Stockfish 19 lite-single: ~1,8 MB de `.wasm` (17.1 lite pesaba ~7,3 MB). Carga más rápida; en Chromium
  headless dio ~40 % menos nps que 17.1 lite (medida orientativa, no de fuerza). Para volver a 17.1:
  `stockfish@~17.1.0`, el script de copia sirve igual.

## Hoja de ruta sugerida

1. Árbol de variantes (en vez de truncar la línea principal) + exportar PGN con variantes.
2. Análisis de partida completa: evaluar cada ply en segundo plano (hoy solo se valoran las jugadas
   visitadas), gráfica de evaluación, resumen de precisión por jugador. La clasificación ya existe
   (`review/classify.ts`); faltan "brillante", "gran jugada" y "oportunidad perdida", que requieren
   detectar sacrificios y jugadas únicas.
3. ~~Importar desde Lichess/Chess.com~~ (hecho, v1.0.0). Siguiente: caché en IndexedDB, filtros por ritmo/fecha,
   paginación (Lichess `until`, meses anteriores de Chess.com).
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
