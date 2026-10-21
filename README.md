# ♞ Análisis de ajedrez (web)

Tablero de análisis que corre entero en tu navegador con **Stockfish 19** (WebAssembly).
Sin cuentas, sin servidor, sin suscripción.

**En línea:** https://fabiandiego.github.io/chess-analysis-web/

**Stack:** TypeScript · Vite · [chessground](https://github.com/lichess-org/chessground) (tablero de Lichess) ·
[chess.js](https://github.com/jhlywa/chess.js) (reglas) · [stockfish.js](https://github.com/nmrugg/stockfish.js) (motor) ·
[chess-openings](https://github.com/lichess-org/chess-openings) (aperturas)

## Funciones

- Tablero con arrastrar y soltar, movimientos legales y selector de pieza al promocionar.
- Análisis en vivo con Stockfish 19 (WASM, un hilo) y 1–5 líneas (MultiPV), profundidad fija o infinita.
- Barra de evaluación y flechas de colores (verde, azul y naranja) con la evaluación en la punta;
  cada línea del panel lleva el color de su flecha. Tocar una línea juega su primer movimiento.
- **Valoración de la última jugada** como en la revisión de chess.com: libro, mejor, excelente, buena,
  imprecisión, error o error grave, con insignia en el tablero, la mejor alternativa y la evaluación
  antes/después; las jugadas ya valoradas quedan marcadas en la lista. Usa los umbrales de "puntos
  esperados" de chess.com con la curva de Lichess (chess.com ajusta la curva al rating, aquí no se conoce).
- **Nombre de la apertura y código ECO** (≈3 900 líneas de la base de datos de Lichess). Se reconoce
  por posición, así que detecta transposiciones; fuera de teoría se mantiene el último nombre, atenuado.
- Interfaz en **español, inglés o ruso** (selector en la cabecera; por defecto, el idioma del navegador).
- **Importar tus partidas de Lichess o Chess.com** por nombre de usuario (sin cuenta ni token).
- Lista de jugadas navegable (← → Inicio Fin, `F` para girar el tablero) y botón **↺ Nueva partida**.
- Cargar FEN/PGN y exportar PGN. La posición actual queda en la URL (`#fen=...`) para compartirla.
- Diseño adaptado a móvil: en pantallas táctiles la profundidad por defecto es 20 y el motor se para
  con la pestaña en segundo plano.

## Uso local

Requiere **Node 22.12 o superior** (lo exige Vitest 5; Vite 8 admite también 20.19+).

```bash
npm install     # instala y, en postinstall, copia Stockfish y genera el libro de aperturas
npm run dev     # http://localhost:5173
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Vite). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Tests unitarios (Vitest, entorno node). |
| `npm run build` | Copia el motor, genera el libro de aperturas, comprueba tipos y compila a `dist/`. |
| `npm run preview` | Sirve `dist/` para probar el build. |
| `npm run e2e` | Prueba de humo con Playwright sobre `dist/` (iPhone SE, Pixel 7 y escritorio). Requiere `npm run build` y un Chromium de Playwright (`npx playwright install chromium`). |

Antes de subir cambios: `npm run typecheck && npm test && npm run build`.

## Estructura

```
src/
  main.ts              UI: conecta partida, tablero y motor
  game.ts              Línea principal + cursor (sobre chess.js)
  engine/              Cliente UCI (Web Worker) y parser de `info`
  openings/            Identificación de la apertura (libro generado en build)
  import/              Descarga y normalización de partidas de Lichess / Chess.com
  i18n/                Textos de la interfaz: es.ts (referencia), en.ts, ru.ts
  ui/                  Barra de evaluación, promoción, importador
data/openings/         Base de datos de aperturas de Lichess (TSV)
scripts/               copy-engine, build-openings, e2e-smoke
tests/                 Vitest
```

`CLAUDE.md` tiene la arquitectura detallada y las invariantes que no hay que romper.

## Traducciones

Todos los textos están en `src/i18n/`. `es.ts` define las claves; `en.ts` y `ru.ts` se tipan contra
él, así que si falta una traducción `npm run typecheck` falla.

- **Añadir un texto:** clave en `es.ts`, luego en `en.ts` y `ru.ts`. En el código se usa `t.seccion.clave`;
  en `index.html`, atributos `data-i18n` (texto), `data-i18n-title`, `data-i18n-aria-label` o `data-i18n-placeholder`.
- **Añadir un idioma:** crear `src/i18n/xx.ts` con tipo `Messages` y añadirlo a `LANGS` en `src/i18n/i18n.ts`.
  `tests/i18n.test.ts` comprueba que todos los idiomas tienen las mismas claves y que las del HTML existen.

Los nombres de apertura se muestran en inglés en todos los idiomas: la base de datos de Lichess solo los tiene en inglés.

## Despliegue en GitHub Pages

1. En el repo: **Settings → Pages → Build and deployment → Source: GitHub Actions** (una sola vez).
2. Cada push a `main` ejecuta typecheck, tests, build y la prueba e2e; si todo pasa, publica `dist/`
   en `https://<usuario>.github.io/<repo>/`. Los pull requests ejecutan las mismas comprobaciones sin publicar.

## Rendimiento

Se usa la build **single-thread "lite"** de Stockfish (~1,8 MB de `.wasm`) porque GitHub Pages no permite
las cabeceras COOP/COEP necesarias para el multihilo. Es bastante más débil que Stockfish nativo
multihilo, pero de sobra para analizar partidas humanas. Detalles en `CLAUDE.md`.

## Licencias

- Este proyecto: **GPL-3.0-or-later** (texto completo en `LICENSE`), porque chessground y Stockfish son GPL-3.0.
- Stockfish: GPL-3.0; el build publica su licencia en `engine/STOCKFISH-LICENSE.txt`.
- chessground: GPL-3.0-or-later · chess.js: BSD-2-Clause.
- Base de datos de aperturas de Lichess: dominio público / CC0 (`data/openings/README.md`).
