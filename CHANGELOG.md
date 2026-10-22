# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con
[SemVer](https://semver.org/lang/es/).

## [Sin publicar]

## [1.0.0] — 2026-10-21

Primera versión publicada en https://fabiandiego.github.io/chess-analysis-web/.

### Análisis
- Stockfish 19 "lite" de un hilo (WASM) en un Web Worker, con cliente UCI propio que evita la
  carrera al cambiar de posición (`stop` → `bestmove` → nueva búsqueda).
- Análisis en vivo fijo: 3 líneas (MultiPV) a profundidad 10. El motor se para al terminar y con la
  pestaña en segundo plano.
- Barra de evaluación (curva logística de Lichess) y flechas de colores con la evaluación en la punta;
  tocar una línea juega su primer movimiento.
- **Valoración de jugadas al estilo chess.com**: libro, mejor, excelente, buena, imprecisión, error y
  error grave según los puntos esperados perdidos (umbrales de chess.com, curva de Lichess), con
  insignia en el tablero, mejor alternativa, evaluación antes/después y marcas en la lista.
  Búsquedas propias a profundidad 18.
- **Nombre de la apertura y código ECO** por posición (detecta transposiciones), con la base de
  datos de Lichess (CC0).

### Partidas
- Tablero chessground con arrastrar y soltar, movimientos legales y selector de promoción.
- Lista de jugadas navegable con teclado (← → Inicio Fin, `F` gira el tablero) y ↺ Nueva partida.
- Cargar FEN/PGN, exportar PGN; la posición queda en la URL (`#fen=`).
- Importar partidas de Lichess y Chess.com por nombre de usuario.

### Interfaz
- Español, inglés y ruso (selector en la cabecera; por defecto, el idioma del navegador).
- Diseño adaptado a móvil, sin desbordamiento horizontal (comprobado en 320 px).

### Proyecto
- TypeScript 7, Vite 8, Vitest 5; `@lichess-org/chessground` (el paquete `chessground` está retirado
  en npm), chess.js 1.4.
- CI en GitHub Actions: typecheck, tests, build y prueba e2e con Playwright (iPhone SE, Pixel 7,
  escritorio); despliegue a GitHub Pages desde `main`.
- Licencia GPL-3.0-or-later.

### Limitaciones conocidas
- Sin árbol de variantes: jugar otra jugada en mitad de la partida trunca la línea.
- Solo se valoran las jugadas visitadas; no hay "brillante", "gran jugada" ni "oportunidad perdida".
- CORS de Lichess/Chess.com sin verificar desde `*.github.io`; traducciones en/ru sin revisión nativa.

[Sin publicar]: https://github.com/fabiandiego/chess-analysis-web/compare/v1.0.0...main
[1.0.0]: https://github.com/fabiandiego/chess-analysis-web/releases/tag/v1.0.0
