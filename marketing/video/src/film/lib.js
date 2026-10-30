// Prism film — motion library. Everything is a pure function of time t (seconds), so any frame
// can be rendered on its own, in any order, by any worker (frame-exact, deterministic).

export const FPS = 60;
export const BEAT = 0.6; // 100 BPM
export const BAR = 2.4;
export const SPECTRUM = ["#8b7bff", "#6a8cff", "#46a8ff", "#2fcbe6", "#2ed3a9", "#7ad66a", "#f2c14e", "#ff7f8f"];
export const C = {
  canvas: "#07080b", base: "#0d0e13", raised: "#14151c", text: "#eceef4", text2: "#a3a7b5", text3: "#888da1",
  accent: "#8e8cff", accentSolid: "#6461f2", success: "#3dd68c", warning: "#f5b544", danger: "#ff6b6b", info: "#5cc8f0",
};
export const GRAD_PRISM = "linear-gradient(90deg, #8b7bff 0%, #5d93ff 30%, #2fcbe6 58%, #7ad66a 80%, #f2c14e 100%)";

// ------------------------------------------------------------------ timeline
export const TL = { events: {}, data: null };
export function setTimeline(data) {
  TL.data = data;
  for (const e of data.events) TL.events[e.id] = e.t;
}
export function T(id) {
  const v = TL.events[id];
  if (v === undefined) throw new Error("unknown timeline event " + id);
  return v;
}

// ------------------------------------------------------------------ math & easing
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, x) => a + (b - a) * x;
export const inv = (a, b, x) => clamp((x - a) / (b - a));
export const E = {
  lin: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x ** 3,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inQuart: (x) => x ** 4,
  outQuart: (x) => 1 - (1 - x) ** 4,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  outQuint: (x) => 1 - (1 - x) ** 5,
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  outBack: (x, s = 1.70158) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2,
  inBack: (x, s = 1.70158) => (s + 1) * x ** 3 - s * x * x,
  outElastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
/** eased progress of t inside [a, b] */
export const seg = (t, a, b, e = E.lin) => e(clamp((t - a) / (b - a)));
/** damped spring step response (0 -> 1, overshoots), t in seconds since start */
export function spring(t, freq = 2.2, damp = 0.42) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * freq;
  const z = damp;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}
/** short envelope 1 at t0 decaying */
export const decay = (t, t0, k = 6) => (t < t0 ? 0 : Math.exp(-(t - t0) * k));
/** pulse on every beat after t0 (kick pump) */
export const beatPulse = (t, t0 = 0, k = 7) => (t < t0 ? 0 : Math.exp(-(((t - t0) % BEAT + BEAT) % BEAT) * k));
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** stable hash noise in [-1, 1] */
export function hn(i, j = 0) {
  let x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
/** smooth 1D value noise in [-1,1] */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hn(i, seed), hn(i + 1, seed), u);
}
export function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (h, a) => {
  const [r, g, b] = hexRgb(h);
  return `rgba(${r},${g},${b},${a})`;
};
export function mixHex(a, b, x) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], x))).join(",")})`;
}
export const spec = (i) => SPECTRUM[((i % 8) + 8) % 8];

// ------------------------------------------------------------------ DOM helpers
export function h(tag, cls, parent, style) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) Object.assign(e.style, style);
  if (parent) parent.appendChild(e);
  return e;
}
export function svgEl(tag, attrs, parent) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
export function show(el, on) {
  el.style.display = on ? "" : "none";
}
/** set many style props, skipping unchanged values (cheap per-frame updates) */
export function st(el, props) {
  for (const k in props) {
    const v = props[k];
    if (el.style[k] !== v) el.style[k] = v;
  }
}

// ------------------------------------------------------------------ image sequences
export const ASSET = { work: "/work", repo: "" };
const pending = new Set();
/** set an <img> src and register its decode so the frame waits for it */
export function setSrc(img, url) {
  if (img.dataset.src === url) return;
  img.dataset.src = url;
  img.src = url;
  const p = img.decode().catch(() => {});
  pending.add(p);
  p.then(() => pending.delete(p));
}
export async function settle() {
  while (pending.size) await Promise.all([...pending]);
}
export class Seq {
  /** image sequence: dir with f_0000.png ... or 0000.png */
  constructor(parent, url, n, opts = {}) {
    this.url = url;
    this.n = n;
    this.pad = opts.pad ?? 4;
    this.prefix = opts.prefix ?? "f_";
    this.ext = opts.ext ?? "png";
    this.loop = opts.loop ?? false;
    this.img = h("img", opts.cls || "seq", parent, opts.style || {});
    this.img.draggable = false;
  }
  frameUrl(i) {
    return `${this.url}/${this.prefix}${String(i).padStart(this.pad, "0")}.${this.ext}`;
  }
  /** show frame for local time tl (s) */
  at(tl) {
    let i = Math.round(tl * FPS);
    if (this.loop) i = ((i % this.n) + this.n) % this.n;
    else i = clamp(i, 0, this.n - 1);
    setSrc(this.img, this.frameUrl(i));
    return i;
  }
}

// ------------------------------------------------------------------ kinetic typography
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/";
/**
 * Kinetic text: splits into words/letters; any number of timed in/out animations per letter.
 *   const k = new KText(root, "Many rays.", { x, y, size, weight, color | gradient, align, mask })
 *   k.anim("in", 7.2, "split", { dur: 0.7, stagger: 0.03, order: "random" }); k.anim("out", 10.8, "up")
 *   k.update(t)
 */
export class KText {
  constructor(parent, text, o = {}) {
    this.o = Object.assign({ x: 0, y: 0, size: 96, weight: 650, color: C.text, align: "left", font: "Inter", tracking: -0.035, line: 1.0, mask: false, seed: 7, glow: null, italic: false, upper: false, opacity: 1 }, o);
    this.anims = [];
    this.pulses = [];
    const r = rng(this.o.seed);
    this.root = h("div", "ktext", parent);
    const s = this.root.style;
    s.position = "absolute";
    s.left = this.o.x + "px";
    s.top = this.o.y + "px";
    s.fontFamily = this.o.font === "mono" ? "JetBrains Mono, ui-monospace, monospace" : "InterVariable, Inter, system-ui, sans-serif";
    s.fontSize = this.o.size + "px";
    s.fontWeight = this.o.weight;
    s.letterSpacing = this.o.tracking + "em";
    s.lineHeight = this.o.line;
    s.whiteSpace = "pre";
    s.color = this.o.color;
    if (this.o.fontFeatures) s.fontFeatureSettings = this.o.fontFeatures;
    s.transform = `translate(${this.o.align === "center" ? "-50%" : this.o.align === "right" ? "-100%" : "0"}, ${this.o.anchor === "top" ? "0" : "-50%"})`;
    s.textAlign = this.o.align;
    this.letters = [];
    const lines = (this.o.upper ? text.toUpperCase() : text).split("\n");
    for (const ln of lines) {
      const L = h("div", "kline", this.root);
      const words = ln.split(/( )/);
      for (const w of words) {
        if (w === "") continue;
        const wd = h("span", "kword", L);
        if (this.o.mask) wd.classList.add("kmask");
        for (const ch of w) {
          const sp = h("span", "kch", wd);
          sp.textContent = ch === " " ? " " : ch;
          this.letters.push({ el: sp, ch, rx: r() * 2 - 1, ry: r() * 2 - 1, rr: r() * 2 - 1, rs: r(), rnd: r() });
        }
      }
    }
    this.n = this.letters.length;
    const perm = this.letters.map((_, i) => i).sort((a, b) => this.letters[a].rnd - this.letters[b].rnd);
    perm.forEach((li, k) => (this.letters[li].rank = k));
    if (this.o.glow) this.root.style.textShadow = this.o.glow;
    this.gradientDone = false;
  }
  /** apply a CSS gradient continuous across letters (call after fonts are ready) */
  layoutGradient() {
    if (!this.o.gradient || this.gradientDone) return;
    const W = this.root.offsetWidth;
    for (const L of this.letters) {
      const x = L.el.offsetLeft + L.el.parentElement.offsetLeft;
      Object.assign(L.el.style, { backgroundImage: this.o.gradient, backgroundSize: `${W}px 100%`, backgroundPosition: `${-x}px 0`, webkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" });
    }
    this.gradientDone = true;
  }
  anim(dir, at, mode, opts = {}) {
    this.anims.push(Object.assign({ dir, at, mode, dur: dir === "in" ? 0.7 : 0.45, stagger: 0.03, order: "fwd", ease: null, dist: 1 }, opts));
    return this;
  }
  pulse(at, amt = 0.06, k = 8) {
    this.pulses.push({ at, amt, k });
    return this;
  }
  orderIndex(i, order) {
    const n = this.n;
    if (order === "rev") return n - 1 - i;
    if (order === "center") return Math.abs(i - (n - 1) / 2);
    if (order === "random") return this.letters[i].rank;
    return i;
  }
  update(t) {
    this.layoutGradient();
    let vis = false;
    const lp = { x: 0, y: 0, s: 1, r: 0, o: 1, b: 0, rx: 0 };
    let pulse = 0;
    for (const p of this.pulses) pulse += p.amt * decay(t, p.at, p.k);
    for (let i = 0; i < this.n; i++) {
      const L = this.letters[i];
      let x = 0, y = 0, s = 1, r = 0, o = this.o.opacity, b = 0, rx = 0, chr = null;
      let shown = this.anims.length === 0;
      for (const a of this.anims) {
        const start = a.at + this.orderIndex(i, a.order) * a.stagger;
        if (a.dir === "in") {
          if (t < start) { o = 0; shown = shown || false; continue; }
          shown = true;
          const raw = clamp((t - start) / a.dur);
          const res = IN[a.mode](raw, L, a, i, this, t - start);
          x += res.x || 0; y += res.y || 0; s *= res.s ?? 1; r += res.r || 0; o *= res.o ?? 1; b += res.b || 0; rx += res.rx || 0;
          if (res.ch) chr = res.ch;
        } else {
          if (t < start) continue;
          const raw = clamp((t - start) / a.dur);
          const res = OUT[a.mode](raw, L, a, i, this);
          x += res.x || 0; y += res.y || 0; s *= res.s ?? 1; r += res.r || 0; o *= res.o ?? 1; b += res.b || 0; rx += res.rx || 0;
        }
      }
      if (!shown) o = 0;
      s *= 1 + pulse;
      if (o > 0.001) vis = true;
      const el = L.el;
      const tr = `translate(${x.toFixed(2)}em, ${y.toFixed(3)}em) scale(${s.toFixed(4)}) rotate(${r.toFixed(2)}deg)${rx ? ` rotateX(${rx.toFixed(1)}deg)` : ""}`;
      st(el, { transform: tr, opacity: o.toFixed(3), filter: b > 0.05 ? `blur(${b.toFixed(1)}px)` : "none" });
      const want = chr ?? (L.ch === " " ? " " : L.ch);
      if (el.textContent !== want) el.textContent = want;
    }
    this.root.style.display = vis ? "" : "none";
    return vis;
  }
}
const IN = {
  rise: (p, L, a) => ({ y: (1 - (a.ease || E.outExpo)(p)) * 1.15 * a.dist }),
  drop: (p, L, a) => ({ y: -(1 - (a.ease || E.outExpo)(p)) * 1.15 * a.dist }),
  snap: (p, L, a) => { const e = (a.ease || E.outExpo)(p); return { s: 1 + (1 - e) * 0.9 * a.dist, b: (1 - e) * 18, o: clamp(p * 3) }; },
  zoom: (p, L, a) => { const e = (a.ease || E.outExpo)(p); return { s: 1 + (1 - e) * 4 * a.dist, b: (1 - e) * 24, o: clamp(p * 2.5) }; },
  slide: (p, L, a) => { const e = (a.ease || E.outExpo)(p); return { x: -(1 - e) * 0.7 * a.dist, o: clamp(p * 2.2), b: (1 - e) * 8 }; },
  slideR: (p, L, a) => { const e = (a.ease || E.outExpo)(p); return { x: (1 - e) * 0.7 * a.dist, o: clamp(p * 2.2), b: (1 - e) * 8 }; },
  split: (p, L, a) => { const e = (a.ease || E.outExpo)(p); const k = 1 - e; return { x: L.rx * 2.2 * k * a.dist, y: L.ry * 1.6 * k * a.dist, r: L.rr * 70 * k, s: 1 + k * (L.rs - 0.3), o: clamp(p * 2), b: k * 10 }; },
  rays: (p, L, a) => { const e = (a.ease || E.outExpo)(p); const k = 1 - e; return { x: (2.5 + L.rs * 2) * k * a.dist, y: (0.9 + L.ry * 0.6) * k * a.dist, s: 1 - k * 0.4, o: clamp(p * 2.5), b: k * 14 }; },
  track: (p, L, a, i, K) => { const e = (a.ease || E.outExpo)(p); return { x: (i - (K.n - 1) / 2) * (1 - e) * 0.45 * a.dist, o: clamp(p * 2), b: (1 - e) * 6 }; },
  crawl: (p, L, a) => { const e = (a.ease || E.inOutCubic)(p); return { x: -(1 - e) * 0.35, o: e }; },
  flip: (p, L, a) => { const e = (a.ease || E.outCubic)(p); return { rx: (1 - e) * -95, y: (1 - e) * 0.25, o: clamp(p * 2) }; },
  fade: (p) => ({ o: E.outCubic(p) }),
  scramble: (p, L, a, i, K, dt) => {
    const done = p >= 0.5 || L.ch === " ";
    const ch = done ? null : GLYPHS[Math.floor(Math.abs(hn(i, Math.floor(dt * 30))) * GLYPHS.length)];
    return { ch, o: clamp(p * 6) };
  },
  glitch: (p, L, a, i, K, dt) => {
    const k = 1 - E.outCubic(p);
    const j = Math.floor(dt * 40);
    return { x: hn(i, j) * 0.18 * k, y: hn(i + 50, j) * 0.06 * k, o: p < 0.6 ? (hn(i, j + 3) > -0.3 ? 1 : 0.15) : 1, s: 1 + Math.max(0, hn(i + 9, j)) * 0.15 * k };
  },
};
const OUT = {
  up: (p, L, a, i, K) => { const e = (a.ease || E.inCubic)(p); return { y: -e * 1.15 * a.dist, o: K.o.mask ? 1 - clamp((p - 0.55) / 0.45) : 1 - e, b: K.o.mask ? 0 : e * 8 }; },
  down: (p, L, a, i, K) => { const e = (a.ease || E.inCubic)(p); return { y: e * 1.15 * a.dist, o: K.o.mask ? 1 - clamp((p - 0.55) / 0.45) : 1 - e, b: K.o.mask ? 0 : e * 8 }; },
  blur: (p, L, a) => { const e = (a.ease || E.inCubic)(p); return { s: 1 + e * 0.35, b: e * 22, o: 1 - e }; },
  fade: (p, L, a) => ({ o: 1 - (a.ease || E.inOutCubic)(p) }),
  split: (p, L, a) => { const e = (a.ease || E.inCubic)(p); return { x: L.rx * 2.5 * e, y: L.ry * 1.8 * e, r: L.rr * 90 * e, o: 1 - e, b: e * 12 }; },
  zoom: (p, L, a) => { const e = (a.ease || E.inExpo)(p); return { s: 1 + e * 5, o: 1 - E.inCubic(p), b: e * 20 }; },
  left: (p, L, a) => { const e = (a.ease || E.inExpo)(p); return { x: -e * 3 * a.dist, o: 1 - e, b: e * 12 }; },
  right: (p, L, a) => { const e = (a.ease || E.inExpo)(p); return { x: e * 3 * a.dist, o: 1 - e, b: e * 12 }; },
  fall: (p, L, a) => { const e = (a.ease || E.inQuad)(p); return { y: e * 2.2, r: L.rr * 40 * e, o: 1 - E.inCubic(p) }; },
  track: (p, L, a, i, K) => { const e = (a.ease || E.inExpo)(p); return { x: (i - (K.n - 1) / 2) * e * 0.6, o: 1 - e, b: e * 10 }; },
};

// ------------------------------------------------------------------ odometer counter
/** rolling digits. fmt: e.g. "000.0" (digits & decimal point), value set per frame */
export class Odo {
  constructor(parent, o = {}) {
    this.o = Object.assign({ x: 0, y: 0, size: 160, weight: 700, color: C.text, align: "left", digits: 3, decimals: 1, suffix: "", suffixSize: 0.4, suffixColor: C.text2, lead: false, gradient: null }, o);
    this.root = h("div", "odo", parent, { position: "absolute", left: this.o.x + "px", top: this.o.y + "px", fontSize: this.o.size + "px", fontWeight: this.o.weight, color: this.o.color, fontFamily: "InterVariable, Inter, sans-serif", fontFeatureSettings: '"tnum" 1, "cv11" 1', letterSpacing: "-0.04em", lineHeight: "1", whiteSpace: "nowrap", display: "flex", alignItems: "baseline" });
    this.root.style.transform = `translate(${this.o.align === "center" ? "-50%" : this.o.align === "right" ? "-100%" : "0"}, -50%)`;
    this.cols = [];
    const total = this.o.digits + this.o.decimals;
    for (let i = 0; i < total; i++) {
      if (i === this.o.digits && this.o.decimals) h("span", "odo-dot", this.root).textContent = ".";
      const win = h("span", "odo-win", this.root);
      const strip = h("span", "odo-strip", win);
      for (let d = 0; d <= 10; d++) h("span", "odo-d", strip).textContent = String(d % 10);
      if (this.o.gradient) Object.assign(strip.style, { backgroundImage: this.o.gradient, webkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", backgroundSize: "100% 100%" });
      this.cols.push({ win, strip, pow: this.o.digits - 1 - i });
    }
    if (this.o.suffix) {
      const sfx = h("span", "odo-sfx", this.root, { fontSize: this.o.suffixSize + "em", color: this.o.suffixColor, marginLeft: "0.18em", letterSpacing: "-0.01em", fontWeight: 600 });
      sfx.textContent = this.o.suffix;
      this.sfx = sfx;
    }
  }
  set(v) {
    const top = 10 ** this.o.digits;
    v = clamp(v, 0, top - 10 ** -this.o.decimals);
    const lowestPow = -this.o.decimals;
    for (const c of this.cols) {
      const unit = 10 ** c.pow;
      const x = Math.round((v / unit) * 1e4) / 1e4;
      let pos;
      if (c.pow === lowestPow) pos = x % 10;
      else {
        const base = Math.floor(x);
        const rem = (v % unit) / unit;
        pos = (base + clamp((rem - 0.92) / 0.08)) % 10;
      }
      const hide = !this.o.lead && c.pow > 0 && v < unit;
      st(c.win, { opacity: hide ? "0" : "1", width: hide ? "0" : "" });
      st(c.strip, { transform: `translateY(${(-pos).toFixed(4)}em)` });
    }
  }
}

// ------------------------------------------------------------------ analytic particles
/**
 * Sparks emitted continuously (rate/s) between t0..t1; each spark's state is closed-form in t.
 * emitter(birth, rnd) -> {x, y, vx, vy, color, life, size}
 */
export function drawSparks(ctx, t, o) {
  const { t0, t1 = 1e9, rate, seed = 1, emitter, maxLife = 1.5, drag = 1.2, gravity = 0, streak = 0.035, alpha = 1 } = o;
  const iFrom = Math.max(0, Math.floor((t - maxLife - t0) * rate));
  const iTo = Math.floor((Math.min(t, t1) - t0) * rate);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = iFrom; i <= iTo; i++) {
    const R = rng(seed * 100003 + i * 7919);
    const birth = t0 + (i + R()) / rate;
    const age = t - birth;
    if (age < 0) continue;
    const s = emitter(birth, R);
    if (!s || age > s.life) continue;
    // velocity with exponential drag: x = x0 + v (1 - e^{-k a}) / k
    const k = s.drag ?? drag;
    const f = k > 0 ? (1 - Math.exp(-k * age)) / k : age;
    const x = s.x + s.vx * f;
    const y = s.y + s.vy * f + 0.5 * (s.g ?? gravity) * age * age;
    const vf = Math.exp(-k * age);
    const vx = s.vx * vf, vy = s.vy * vf + (s.g ?? gravity) * age;
    const life = age / s.life;
    const a = (1 - life) ** 1.5 * alpha * (s.a ?? 1);
    const sl = s.streak ?? streak;
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = a;
    ctx.lineWidth = s.size * (1 - life * 0.5);
    ctx.beginPath();
    ctx.moveTo(x - vx * sl, y - vy * sl);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();
}
/** soft radial glow */
export function glowDot(ctx, x, y, r, color, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = a;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
}
/** neon line: wide soft glow + bright core (additive) */
export function neonLine(ctx, pts, color, o = {}) {
  const { width = 3, glow = 18, alpha = 1, core = "rgba(255,255,255,0.85)", coreWidth = null } = o;
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  };
  ctx.globalAlpha = 0.22 * alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width + glow;
  ctx.filter = `blur(${glow * 0.45}px)`;
  path();
  ctx.stroke();
  ctx.filter = "none";
  ctx.globalAlpha = 0.9 * alpha;
  ctx.lineWidth = width;
  path();
  ctx.stroke();
  if (core) {
    ctx.globalAlpha = 0.8 * alpha;
    ctx.strokeStyle = core;
    ctx.lineWidth = coreWidth ?? Math.max(1, width * 0.35);
    path();
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ glass shatter
/** Build shards (jittered grid triangulation) over a full-frame image. Returns updater. */
export class Shatter {
  constructor(parent, W, H, o = {}) {
    this.o = Object.assign({ cols: 9, rows: 6, seed: 3, origin: [W / 2, H / 2], dur: 0.9, z: 900 }, o);
    this.W = W;
    this.H = H;
    const r = rng(this.o.seed);
    const { cols, rows } = this.o;
    const P = [];
    for (let j = 0; j <= rows; j++) {
      P.push([]);
      for (let i = 0; i <= cols; i++) {
        const edgeX = i === 0 || i === cols, edgeY = j === 0 || j === rows;
        const x = (i / cols) * W + (edgeX ? 0 : (r() - 0.5) * (W / cols) * 0.8);
        const y = (j / rows) * H + (edgeY ? 0 : (r() - 0.5) * (H / rows) * 0.8);
        P[j].push([x, y]);
      }
    }
    this.root = h("div", "shatter", parent, { position: "absolute", inset: "0", perspective: "1400px", perspectiveOrigin: `${this.o.origin[0]}px ${this.o.origin[1]}px` });
    this.shards = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
        const tris = r() > 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        for (const tri of tris) {
          const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          const div = h("div", "shard", this.root, { position: "absolute", inset: "0", clipPath: `polygon(${tri.map((p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(",")})`, transformOrigin: `${cx}px ${cy}px`, willChange: "transform" });
          const img = h("img", "", div, { position: "absolute", inset: "0", width: W + "px", height: H + "px" });
          const edge = svgEl("svg", { width: W, height: H, style: "position:absolute;inset:0;overflow:visible" }, div);
          svgEl("polygon", { points: tri.map((p) => p.join(",")).join(" "), fill: "rgba(200,205,255,0.05)", stroke: "rgba(225,228,255,0.9)", "stroke-width": 1.6 }, edge);
          this.shards.push({ div, img, edge, cx, cy, rnd: [r(), r(), r(), r(), r()] });
        }
      }
  }
  setImage(url) {
    for (const s of this.shards) setSrc(s.img, url);
  }
  /** p: seconds since break */
  update(dt) {
    const { origin, dur, z } = this.o;
    const on = dt >= 0 && dt <= dur * 1.4;
    this.root.style.display = on ? "" : "none";
    if (!on) return;
    for (const s of this.shards) {
      const dx = s.cx - origin[0], dy = s.cy - origin[1];
      const dist = Math.hypot(dx, dy) + 1;
      const delay = (dist / 1400) * 0.18 * (0.6 + s.rnd[4]);
      const a = clamp((dt - delay) / dur);
      const e = E.inCubic(a) * 0.65 + E.outCubic(a) * 0.35;
      const push = (420 + 900 * s.rnd[0]) * e;
      const tx = (dx / dist) * push, ty = (dy / dist) * push + 300 * e * e;
      const tz = z * (0.3 + s.rnd[1]) * e;
      const rx = (s.rnd[2] - 0.5) * 160 * e, ry = (s.rnd[3] - 0.5) * 160 * e, rz = (s.rnd[0] - 0.5) * 90 * e;
      const crackGlow = clamp(1 - dt / 0.3);
      st(s.div, { transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, ${tz.toFixed(1)}px) rotateX(${rx.toFixed(1)}deg) rotateY(${ry.toFixed(1)}deg) rotateZ(${rz.toFixed(1)}deg)`, opacity: (1 - E.inQuad(a)).toFixed(3) });
      st(s.edge, { opacity: (0.05 + 0.5 * crackGlow).toFixed(3) });
    }
  }
}
