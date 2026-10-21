# ♞ Análisis de ajedrez (web)

Tablero de análisis que corre entero en tu navegador con **Stockfish** (WebAssembly).
Sin cuentas, sin servidor, sin suscripción.

**Stack:** TypeScript · Vite · [chessground](https://github.com/lichess-org/chessground) · [chess.js](https://github.com/jhlywa/chess.js) · [stockfish.js](https://github.com/nmrugg/stockfish.js)

## Funciones (v0.1)

- Tablero con arrastrar y soltar, movimientos legales y promoción.
- Análisis en vivo con Stockfish 19 (WASM, un hilo) y 1–5 líneas (MultiPV), profundidad fija o infinita.
- Barra de evaluación, flechas de mejores jugadas, línea de variante en SAN (clic para jugarla).
- Lista de jugadas navegable (← → Inicio Fin, `F` para girar el tablero).
- Nombre de la apertura y código ECO (base de datos de [Lichess](https://github.com/lichess-org/chess-openings), CC0),
  reconocido por posición, así que detecta transposiciones.
- Cargar FEN/PGN, exportar PGN. La posición actual queda en la URL (`#fen=...`) para compartirla.

## Uso local

```bash
npm install
npm run dev
```

Requiere Node 20+.

## Despliegue gratuito en GitHub Pages

1. En el repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Cada push a `main` ejecuta tests, compila y publica en `https://<usuario>.github.io/<repo>/`.

## Rendimiento

Se usa la build **single-thread "lite"** de Stockfish porque GitHub Pages no permite las cabeceras
COOP/COEP necesarias para el multihilo. Es bastante más débil que Stockfish nativo multihilo,
pero de sobra para analizar partidas humanas. Ver `CLAUDE.md` para los detalles técnicos.

## Licencia

GPL-3.0-or-later (chessground y Stockfish son GPL-3.0).
