/**
 * Envoltorio de un motor UCI que corre en un Web Worker.
 *
 * Es agnóstico del motor: hoy carga Stockfish (WASM); mañana puede cargar
 * un motor propio compilado a JS/WASM siempre que hable UCI por
 * postMessage. Así se pueden comparar ambos con la misma interfaz.
 *
 * Detalle importante (condición de carrera clásica en UCI):
 * al cambiar de posición hay que enviar `stop` y esperar el `bestmove`
 * de la búsqueda anterior antes de lanzar la nueva. Si no, las líneas
 * `info` de la búsqueda vieja se mezclarían con la posición nueva.
 */
import { parseBestMove, parseInfo, type BestMove, type InfoLine } from './uci';

export interface AnalysisRequest {
  fen: string;
  multiPv: number;
  /** Profundidad máxima; undefined => análisis infinito hasta `stop`. */
  depth?: number;
}

export interface EngineOptions {
  /** URL del script del worker (classic worker). */
  workerUrl: string | URL;
  /** Hash en MB. 32 MB es prudente para móvil. */
  hashMb?: number;
  onInfo?: (info: InfoLine, req: AnalysisRequest) => void;
  onBestMove?: (bm: BestMove, req: AnalysisRequest) => void;
  /** Todas las líneas crudas, útil para depurar. */
  onRawLine?: (line: string) => void;
}

type State = 'idle' | 'searching' | 'stopping';

export class UciEngine {
  readonly name: Promise<string>;
  private readonly worker: Worker;
  private readonly opts: EngineOptions;
  private state: State = 'idle';
  private current: AnalysisRequest | null = null;
  private pending: AnalysisRequest | null = null;
  private appliedMultiPv = 0;
  private waiters: Array<{ token: string; resolve: (line: string) => void }> = [];
  private readonly ready: Promise<void>;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.worker = new Worker(opts.workerUrl);
    this.worker.onmessage = (e: MessageEvent) => this.handleLine(String(e.data));
    this.worker.onerror = (e) => console.error('[engine] worker error', e.message);

    let resolveName!: (n: string) => void;
    this.name = new Promise((r) => (resolveName = r));

    this.ready = (async () => {
      this.send('uci');
      const idLines: string[] = [];
      const unsubscribe = this.tap((l) => { if (l.startsWith('id name ')) idLines.push(l.slice(8)); });
      await this.waitFor('uciok');
      unsubscribe();
      resolveName(idLines[0] ?? 'Motor UCI');
      this.send(`setoption name Hash value ${opts.hashMb ?? 32}`);
      await this.isReady();
    })();
  }

  /** Lanza (o reprograma) un análisis. Seguro de llamar en cada cambio de posición. */
  async analyze(req: AnalysisRequest): Promise<void> {
    await this.ready;
    if (this.state === 'idle') {
      void this.start(req);
    } else {
      // Hay una búsqueda en marcha: la paramos y dejamos la nueva en cola.
      this.pending = req;
      if (this.state === 'searching') {
        this.state = 'stopping';
        this.send('stop');
      }
    }
  }

  async stop(): Promise<void> {
    await this.ready;
    this.pending = null;
    if (this.state === 'searching') {
      this.state = 'stopping';
      this.send('stop');
    }
  }

  terminate(): void {
    this.worker.terminate();
  }

  // ------------------------------------------------------------------

  private async start(req: AnalysisRequest): Promise<void> {
    this.state = 'searching';
    this.current = req;
    if (req.multiPv !== this.appliedMultiPv) {
      this.send(`setoption name MultiPV value ${req.multiPv}`);
      this.appliedMultiPv = req.multiPv;
      await this.isReady();
    }
    // Si mientras esperábamos `readyok` llegó otra petición, salta a ella.
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      return this.start(next);
    }
    this.send(`position fen ${req.fen}`);
    this.send(req.depth ? `go depth ${req.depth}` : 'go infinite');
  }

  private handleLine(line: string): void {
    this.opts.onRawLine?.(line);
    for (const t of this.taps) t(line);

    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i]!;
      if (line.startsWith(w.token)) {
        this.waiters.splice(i, 1);
        w.resolve(line);
        break;
      }
    }

    if (line.startsWith('info ')) {
      // Mientras paramos, las info pertenecen a la posición vieja: se descartan.
      if (this.state !== 'searching' || !this.current) return;
      const info = parseInfo(line);
      if (info) this.opts.onInfo?.(info, this.current);
      return;
    }

    if (line.startsWith('bestmove')) {
      const finished = this.current;
      const wasStopping = this.state === 'stopping';
      this.state = 'idle';
      this.current = null;
      const bm = parseBestMove(line);
      if (bm && finished && !wasStopping) this.opts.onBestMove?.(bm, finished);
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        void this.start(next);
      }
    }
  }

  private send(cmd: string): void {
    this.worker.postMessage(cmd);
  }

  private waitFor(token: string): Promise<string> {
    return new Promise((resolve) => this.waiters.push({ token, resolve }));
  }

  private isReady(): Promise<string> {
    const p = this.waitFor('readyok');
    this.send('isready');
    return p;
  }

  private taps = new Set<(line: string) => void>();
  private tap(fn: (line: string) => void): () => void {
    this.taps.add(fn);
    return () => this.taps.delete(fn);
  }
}

/**
 * Crea Stockfish leyendo el manifest que genera scripts/copy-engine.mjs.
 * Se resuelve contra document.baseURI para funcionar también bajo
 * https://<usuario>.github.io/<repo>/.
 */
export async function createStockfish(opts: Omit<EngineOptions, 'workerUrl'>): Promise<UciEngine> {
  const base = new URL('engine/', document.baseURI);
  const res = await fetch(new URL('manifest.json', base));
  if (!res.ok) {
    throw new Error('No se encontró public/engine/manifest.json. Ejecuta `npm install` (postinstall copia Stockfish).');
  }
  const manifest = (await res.json()) as { script: string };
  return new UciEngine({ ...opts, workerUrl: new URL(manifest.script, base) });
}
