/** Fixed-capacity ring buffer for live samples (speed history, sparklines). */
export class Ring {
  private buf: number[] = [];
  private head = 0;

  constructor(readonly capacity: number) {}

  push(v: number) {
    if (this.buf.length < this.capacity) this.buf.push(v);
    else {
      this.buf[this.head] = v;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** Samples oldest → newest. */
  values(): number[] {
    return this.buf.length < this.capacity ? this.buf.slice() : [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  get size() {
    return this.buf.length;
  }

  max(): number {
    return this.buf.reduce((m, v) => (v > m ? v : m), 0);
  }
}

/** Smooth SVG path (Catmull-Rom → cubic Bézier) through samples scaled into w×h. */
export function smoothPath(values: number[], w: number, h: number, max?: number, pad = 2): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const top = (max ?? Math.max(...values, 1)) * 1.1 || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - pad - (Math.max(0, v) / top) * (h - pad * 2)] as const);
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1y = Math.min(h, Math.max(0, p1[1] + (p2[1] - p0[1]) / 6));
    const c2y = Math.min(h, Math.max(0, p2[1] - (p3[1] - p1[1]) / 6));
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(c1y)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return { line: d, area: `${d}L${f(w)} ${h}L0 ${h}Z` };
}
