// vitest/config re-exporta defineConfig de Vite y añade el tipo de la clave `test`.
import { defineConfig } from 'vitest/config';

// base './' => rutas relativas: el mismo build funciona en localhost
// y en GitHub Pages (https://<usuario>.github.io/<repo>/) sin tocar nada.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // El motor (.js + .wasm) se sirve tal cual desde public/engine.
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
