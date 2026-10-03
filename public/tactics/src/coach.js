// Tutorial coach: dims the screen, spotlights a 3D unit/tile or a DOM element, points at it with a bouncing
// arrow and shows a speech bubble. Steps complete when their check() turns true (polled every frame).
export class Coach {
  constructor(view) {
    this.view = view;
    this.el = document.createElement('div'); this.el.id = 'coach'; this.el.className = 'hidden';
    this.el.innerHTML = `<div class="spot none"></div><div class="arrow">▼</div><div class="bubble"></div>`;
    document.body.appendChild(this.el);
    this.spot = this.el.querySelector('.spot'); this.arrow = this.el.querySelector('.arrow'); this.bubble = this.el.querySelector('.bubble');
    this.step = null; this.raf = null;
  }

  /** Resolve a step target to a screen circle/rect. */
  locate(t) {
    if (!t) return null;
    if (t.unit) { const p = this.view.screenOf(t.unit.x, t.unit.y, 1.1); return { x: p.x, y: p.y, r: 70 }; }
    if (t.tile) { const p = this.view.screenOf(t.tile[0], t.tile[1], 0); return { x: p.x, y: p.y, r: 52 }; }
    if (t.el) {
      const e = document.querySelector(t.el); if (!e || !e.offsetParent) return null;
      const b = e.getBoundingClientRect(), pad = 8;
      return { rect: { left: b.left - pad, top: b.top - pad, width: b.width + pad * 2, height: b.height + pad * 2 }, x: b.left + b.width / 2, y: b.top, r: 0 };
    }
    return null;
  }

  /** step: { text, target?(), check?(), next? (button label), onNext?() } */
  show(step, index, total, { onSkip } = {}) {
    this.step = step;
    this.el.classList.remove('hidden');
    this.bubble.innerHTML = `<div class="stepn">Training · step ${index + 1} of ${total}</div>${step.text}
      <div class="row">${onSkip ? '<button class="btn" data-a="skip">Skip tutorial</button>' : ''}${step.next ? `<button class="btn gold" data-a="next">${step.next}</button>` : ''}</div>`;
    this.bubble.querySelector('[data-a=skip]')?.addEventListener('click', onSkip);
    this.bubble.querySelector('[data-a=next]')?.addEventListener('click', () => { this.nextClicked = true; });
    this.nextClicked = false;
    if (!this.raf) this.loop();
  }

  shake() { this.bubble.classList.remove('shake'); void this.bubble.offsetWidth; this.bubble.classList.add('shake'); }

  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    const s = this.step; if (!s) return;
    const loc = this.locate(s.target?.());
    const sp = this.spot.style;
    if (!loc) { this.spot.className = 'spot none'; this.arrow.style.display = 'none'; }
    else if (loc.rect) {
      this.spot.className = 'spot rect';
      Object.assign(sp, { left: `${loc.rect.left}px`, top: `${loc.rect.top}px`, width: `${loc.rect.width}px`, height: `${loc.rect.height}px` });
      this.arrow.style.display = ''; Object.assign(this.arrow.style, { left: `${loc.x}px`, top: `${loc.rect.top - 4}px` });
    } else {
      this.spot.className = 'spot';
      Object.assign(sp, { left: `${loc.x - loc.r}px`, top: `${loc.y - loc.r}px`, width: `${loc.r * 2}px`, height: `${loc.r * 2}px` });
      this.arrow.style.display = ''; Object.assign(this.arrow.style, { left: `${loc.x}px`, top: `${loc.y - loc.r - 4}px` });
    }
    // bubble: keep it away from the target
    const bw = this.bubble.offsetWidth, bh = this.bubble.offsetHeight;
    let bx = innerWidth / 2 - bw / 2, by = 110;
    if (loc) {
      const ty = loc.rect ? loc.rect.top : loc.y - loc.r, below = loc.rect ? loc.rect.top + loc.rect.height : loc.y + loc.r;
      bx = Math.min(innerWidth - bw - 12, Math.max(12, loc.x - bw / 2));
      by = ty - bh - 60 > 60 ? ty - bh - 60 : Math.min(innerHeight - bh - 12, below + 24);
    }
    Object.assign(this.bubble.style, { left: `${bx}px`, top: `${by}px` });
  }

  hide() { this.el.classList.add('hidden'); this.step = null; cancelAnimationFrame(this.raf); this.raf = null; }
}
