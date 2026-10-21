# Aperturas (ECO)

Copia de los `.tsv` de [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
(commit `a6189a30dc273ccb21fc2536a9a2fefd5592a67a`). Dominio público / CC0.

Columnas: `eco`, `name` (en inglés, como en Lichess), `pgn` (solo jugadas).

`scripts/build-openings.mjs` los convierte en `src/openings/book.json` (generado, no versionado):
un mapa posición → `[eco, name]`. Para actualizar: sustituir los `.tsv` y anotar aquí el commit.
