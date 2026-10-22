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

- `main` = **desarrollo activo y versión publicada (1.x)**. Todo el trabajo va a `main` por PR; cada push
  despliega en GitHub Pages. Al cerrar una versión: número en `package.json` (1.1.0, 1.2.0…), fecha en
  el CHANGELOG y etiqueta `v1.x.0`.
- `v2` = **en pausa** (decisión del autor, 2026-10-22). Solo contiene el arranque: versión 2.0.0-dev.0,
  CI también en push a `v2` y un plan que ahora es la hoja de ruta de 1.x. No trabajar en ella salvo que
  el autor lo pida; si se retoma, primero merge `main` → `v2`.
- `CHANGELOG.md`: cada PR añade su línea en "Sin publicar"; al cerrar versión se le pone número y fecha.

## Estado y notas para la próxima sesión (actualizado 2026-10-22)

**Dónde se quedó:** v1.0.0 cerrada y publicada (commit `0b21754`). La rama `v2` está **en pausa**: el
desarrollo sigue en `main` como versiones 1.x (siguiente: 1.1.0). Trabajo nuevo: PR con base `main`.

**Pendiente inmediato:**
1. **Etiqueta/release `v1.0.0` sin crear en GitHub**: el proxy del entorno de Claude rechaza `git push`
   de etiquetas (HTTP 403; ramas sí) y no hay herramienta de GitHub para crear releases. Hacerlo a mano:
   Releases → Draft a new release → tag `v1.0.0` (crear al publicar) → target commit `0b21754`
   ("Versión 1.0.0") → pegar el apartado 1.0.0 de `CHANGELOG.md`. Alternativa propuesta y no hecha:
   un workflow de release que cree etiqueta y release desde Actions (decidir con el autor).
2. **Elegir la siguiente tarea de 1.x** (ver "Hoja de ruta"). No se ha empezado ninguna.

**Cómo trabaja el autor:** respuestas técnicas y basadas en datos; cuestionar lo que pide cuando choque
con medidas (p. ej. profundidad 10 para valorar → se dejó 10 para el análisis en vivo y 18 para la
valoración). Flujo habitual: rama de trabajo → commit → PR → push fast-forward a `main` **tras
confirmarlo con él** → comprobar el CI del push (y que se desplegó).

**Entorno de Claude Code en la web (lo que se aprendió):**
- El proxy bloquea `lichess.org`, `api.chess.com` y `*.github.io`: no se puede probar la importación
  real, su CORS ni el sitio publicado. `api.github.com` sí responde (sirve para seguir el CI con `curl`).
- `npm run e2e` en local falla porque Playwright 1.64 no encuentra su navegador. Ejecutar una copia del
  script con `chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })`
  y borrarla después (en CI funciona tal cual: instala su navegador).
- Stockfish se puede consultar en node para contrastar evaluaciones:
  `printf "uci\nposition fen <FEN>\ngo depth 18\n" | node node_modules/stockfish/bin/stockfish-19-lite-single.js`
- Partidas de prueba de la valoración: mate del pastor `1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#`
  (3…Nf6 error grave, 4.Qxf7# mejor); Ópera de Morphy (`1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5
  6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6
  15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#`): 15.Bxd7+ mejor, 9…b5 imprecisión/error (en el umbral, varía entre
  ejecuciones); recorrerla jugada a jugada ≈32 s en Chromium headless.

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
  game.ts            Línea principal + cursor sobre chess.js. Sin árbol de variantes (en la hoja de ruta).
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
- [x] CI en Node 24 (2026-10-22): `checkout` v7, `setup-node` v7, `upload-pages-artifact` v5 (la v4 aún
      fijaba `upload-artifact` en node20) y `deploy-pages` v5. Revisados sus cambios: v7 de checkout solo
      restringe forks en `pull_request_target`; setup-node v5+ activa caché sola (aquí `cache: npm` explícito);
      upload-pages-artifact v4+ excluye ficheros con punto (`dist/` no tiene).

## Rendimiento en móvil

- Análisis en vivo fijo: `LIVE_DEPTH` = 10 y `LIVE_LINES` = 3 (main.ts; sin selectores en la UI). Tras él, la
  búsqueda de valoración a 18 y el motor queda parado: nada de `go infinite`. El motor se para con la pestaña oculta.
  Recorrer la Opera de Morphy (33 plies) jugada a jugada: ~32 s (antes, con análisis infinito, ~112 s).
- Stockfish 19 lite-single: ~1,8 MB de `.wasm` (17.1 lite pesaba ~7,3 MB). Carga más rápida; en Chromium
  headless dio ~40 % menos nps que 17.1 lite (medida orientativa, no de fuerza). Para volver a 17.1:
  `stockfish@~17.1.0`, el script de copia sirve igual.

## Hoja de ruta (1.x)

Orden propuesto; confirmar alcance con el autor antes de empezar cada uno.

1. **Árbol de variantes**: jugar otra jugada en mitad de la partida crea una variante en vez de truncar
   la línea; navegar y promover variantes; exportar PGN con variantes. Afecta a `game.ts` (hoy línea +
   cursor), a la lista de jugadas y a `fensToCursor`/`positions` (aperturas y valoración).
2. **Análisis de partida completa**: valorar todas las jugadas en segundo plano (hoy solo las visitadas),
   gráfica de evaluación, precisión por jugador. `review/classify.ts` ya existe; faltan "brillante",
   "gran jugada" y "oportunidad perdida" (detectar sacrificios y jugadas únicas).
3. **Partidas guardadas**: caché en IndexedDB; importación con filtros por ritmo/fecha y paginación
   (Lichess `until`, meses anteriores de Chess.com). (La importación básica ya está en 1.0.0.)
4. **Motor propio** (ver abajo), con selector de motor y partidas motor contra motor.

Deuda (ver "Pendiente" arriba): CORS de las APIs de importación, revisión nativa de en/ru.

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
