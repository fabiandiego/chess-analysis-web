import { formatScore, winningChances, type Score } from '../engine/uci';

/** Barra vertical de evaluación (punto de vista de blancas). */
export class EvalBar {
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    root.classList.add('evalbar');
    root.innerHTML = '<div class="evalbar-fill"></div><span class="evalbar-label">—</span>';
    this.fill = root.querySelector('.evalbar-fill')!;
    this.label = root.querySelector('.evalbar-label')!;
  }

  set(score: Score | null, flipped: boolean): void {
    this.root.classList.toggle('flipped', flipped);
    if (!score) {
      this.fill.style.height = '50%';
      this.label.textContent = '—';
      return;
    }
    // winningChances ∈ [-1, 1] -> porcentaje de blancas ∈ [0, 100]
    const whitePct = 50 + 50 * winningChances(score);
    this.fill.style.height = `${whitePct.toFixed(1)}%`;
    this.label.textContent = formatScore(score);
    this.root.classList.toggle('black-better', whitePct < 50);
  }
}
