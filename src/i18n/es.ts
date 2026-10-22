/**
 * Textos en español: fuente de verdad de las claves. en.ts y ru.ts se tipan
 * con `Messages`, así que tsc avisa si falta o sobra alguna traducción.
 *
 * Las claves usadas desde index.html (`data-i18n*`) deben ser strings;
 * tests/i18n.test.ts lo comprueba en los tres idiomas.
 */
export const es = {
  langName: 'Español',
  pageTitle: 'Análisis de ajedrez',
  header: {
    title: '♞ Análisis',
    loadingEngine: 'Cargando motor…',
    engineUnavailable: 'Motor no disponible',
    reset: '↺ Nueva partida',
    resetTitle: 'Volver a la posición inicial',
    language: 'Idioma',
  },
  nav: {
    label: 'Navegación',
    start: 'Ir al inicio',
    startKey: 'Ir al inicio (Inicio)',
    prev: 'Jugada anterior',
    prevKey: 'Jugada anterior (←)',
    next: 'Jugada siguiente',
    nextKey: 'Jugada siguiente (→)',
    end: 'Ir al final',
    endKey: 'Ir al final (Fin)',
    flip: 'Girar tablero',
    flipKey: 'Girar tablero (F)',
  },
  engine: {
    toggle: 'Motor',
    hint: 'El color de cada línea es el de su flecha en el tablero. Toca una línea para jugar su primer movimiento.',
    playLine: 'Jugar el primer movimiento de esta línea',
    calculating: 'Calculando…',
    stats: (depth: string, nps: string, nodes: string) => `prof. ${depth} · ${nps} nps · ${nodes} nodos`,
  },
  opening: { title: 'Apertura (base de datos de Lichess)' },
  moves: { label: 'Movimientos' },
  status: {
    whiteMates: 'Jaque mate: ganan blancas',
    blackMates: 'Jaque mate: ganan negras',
    stalemate: 'Tablas por ahogado',
    insufficient: 'Tablas por material insuficiente',
    threefold: 'Tablas por triple repetición',
    fiftyMoves: 'Tablas (regla de 50 movimientos)',
  },
  review: {
    title: 'Valoración de la última jugada (criterio de chess.com)',
    classes: {
      book: 'Libro', best: 'Mejor', excellent: 'Excelente', good: 'Buena',
      inaccuracy: 'Imprecisión', mistake: 'Error', blunder: 'Error grave',
    },
    verdict: {
      book: 'es una jugada de libro', best: 'es la mejor jugada', excellent: 'es excelente', good: 'es buena',
      inaccuracy: 'es una imprecisión', mistake: 'es un error', blunder: 'es un error grave',
    },
    bestWas: (san: string) => `Mejor era ${san}`,
    evalChange: (before: string, after: string) => `Evaluación ${before} → ${after}`,
    pending: (san: string) => `Valorando ${san}…`,
    engineOff: 'Activa el motor para valorar las jugadas.',
  },
  promotion: { label: 'Elige pieza de promoción', q: 'Dama', r: 'Torre', b: 'Alfil', n: 'Caballo' },
  io: {
    summary: 'Pegar FEN o PGN / exportar',
    load: 'Cargar',
    pgnPlaceholder: 'Pega aquí un PGN',
    loadPgn: 'Cargar PGN',
    copyPgn: 'Copiar PGN',
    pgnReadError: (url: string, err: string) => `No se pudo leer el PGN de ${url}: ${err}`,
    pgnErrors: {
      empty: (_detail: string) => 'El PGN está vacío.',
      syntax: (detail: string) => `PGN mal formado cerca de «${detail}».`,
      illegalMove: (detail: string) => `Jugada ilegal en el PGN: ${detail}.`,
    },
  },
  banner: { advance: 'usa ▶ para avanzar', original: 'ver original ↗' },
  importer: {
    title: 'Importar mis partidas',
    /** HTML fijo (sin datos del usuario). */
    stepsHtml:
      '1. Elige dónde juegas · 2. Escribe tu <b>nombre de usuario</b> · 3. Pulsa <b>Buscar</b> y toca una partida para analizarla. ' +
      'No hace falta contraseña: solo se leen tus partidas públicas.',
    site: 'Sitio',
    yourUser: 'Tu usuario de',
    placeholder: 'p. ej. MagnusCarlsen',
    search: 'Buscar mis partidas',
    searching: 'Buscando…',
    needUser: (site: string) => `Escribe tu nombre de usuario de ${site}.`,
    downloading: (site: string) => `Descargando tus últimas partidas de ${site}…`,
    found: (n: number) => `${n} ${n === 1 ? 'partida encontrada' : 'partidas encontradas'}. Toca una para analizarla.`,
    none: 'No hay partidas recientes de ajedrez estándar con ese usuario.',
    network: (site: string) =>
      `No se pudo conectar con ${site}. Revisa la conexión o si un bloqueador de contenido corta la petición.`,
    win: 'Ganaste',
    loss: 'Perdiste',
    draw: 'Tablas',
    asWhite: '⚪ Blancas',
    asBlack: '⚫ Negras',
    analyze: 'Analizar ›',
    speeds: {
      ultraBullet: 'ultrabullet', bullet: 'bala', blitz: 'blitz', rapid: 'rápida',
      classical: 'clásica', daily: 'diaria', correspondence: 'correspondencia',
    } as Record<string, string>,
    errors: {
      invalidUser: 'Nombre de usuario no válido (2–30 caracteres: letras, números, _ o -).',
      notFound: (user: string) => `No existe el usuario "${user}" o no tiene partidas públicas.`,
      rateLimited: 'Demasiadas peticiones: el servidor pide esperar. Prueba en un minuto.',
      http: (status: number) => `Error ${status} del servidor al descargar partidas.`,
      unexpected: (site: string) => `Respuesta inesperada de ${site}.`,
    },
  },
};

/** Forma de un diccionario: mismas claves y firmas que `es`. */
export type Messages = typeof es;
