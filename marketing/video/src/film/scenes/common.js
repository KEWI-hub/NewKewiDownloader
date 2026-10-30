// Shared scene building blocks.
import { h, svgEl, st, clamp, lerp, seg, E, setSrc, ASSET, C, SPECTRUM, decay } from "../lib.js";

/** load per-frame projected geometry exported by prism_scene.py */
export async function loadGeom(shot, n) {
  const out = new Array(n).fill(null);
  const B = 48;
  for (let i = 0; i < n; i += B) {
    await Promise.all(
      Array.from({ length: Math.min(B, n - i) }, (_, k) =>
        fetch(`${ASSET.work}/bl/${shot}/${String(i + k).padStart(4, "0")}.json`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (out[i + k] = j))
          .catch(() => {}),
      ),
    );
  }
  // fill gaps (frames not rendered yet) with nearest known
  let last = null;
  for (let i = 0; i < n; i++) (out[i] ? (last = out[i]) : (out[i] = last));
  for (let i = n - 1; i >= 0; i--) (out[i] ? (last = out[i]) : (out[i] = last));
  return out;
}

/** the Prism logo mark as an animatable inline SVG (geometry from assets/brand/logo-mark.svg) */
export function logoMark(parent, size, style = {}) {
  const svg = svgEl("svg", { viewBox: "0 0 64 64", width: size, height: size, fill: "none", style: "position:absolute;overflow:visible" }, parent);
  Object.assign(svg.style, style);
  const defs = svgEl("defs", {}, svg);
  defs.innerHTML = `<linearGradient id="lmg" x1="10" y1="8" x2="46" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#a9a7ff" stop-opacity=".75"/><stop offset=".55" stop-color="#6461f2" stop-opacity=".35"/><stop offset="1" stop-color="#4f4be0" stop-opacity=".55"/></linearGradient>
  <linearGradient id="lmr" x1="8" y1="8" x2="48" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#c9c8ff"/><stop offset=".5" stop-color="#6461f2"/><stop offset="1" stop-color="#8e8cff"/></linearGradient>
  <linearGradient id="lmb" x1="1" y1="0" x2="11" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#c9ccd8" stop-opacity="0"/><stop offset="1" stop-color="#e4e6ee"/></linearGradient>`;
  const beam = svgEl("path", { d: "M1.5 39.5L10.6 34.7", stroke: "url(#lmb)", "stroke-width": 3.2, "stroke-linecap": "round", pathLength: 1, "stroke-dasharray": "1 1" }, svg);
  const rayDefs = [["M41 31.5L61 16", "#ff7f8f"], ["M41.6 32.6L62 25", "#f2c14e"], ["M42 34L62.2 34", "#2ed3a9"], ["M42.2 35.4L62 43", "#46a8ff"], ["M42 36.6L61 51.5", "#8b7bff"]];
  const rays = rayDefs.map(([d, c]) => svgEl("path", { d, stroke: c, "stroke-width": 3.4, "stroke-linecap": "round", pathLength: 1, "stroke-dasharray": "1 1" }, svg));
  const tri = svgEl("path", { d: "M24.4 9.6a3 3 0 0 1 5.2 0l20.3 37.3a3 3 0 0 1-2.6 4.4H6.7a3 3 0 0 1-2.6-4.4z", fill: "url(#lmg)", stroke: "url(#lmr)", "stroke-width": 2, pathLength: 1, "stroke-dasharray": "1 1" }, svg);
  const inner = svgEl("path", { d: "M11.5 34.6L41.2 33.8", stroke: "#fff", "stroke-opacity": ".7", "stroke-width": 2, "stroke-linecap": "round", pathLength: 1, "stroke-dasharray": "1 1" }, svg);
  const glint = svgEl("path", { d: "M22.6 14.2L9.4 38.6", stroke: "#fff", "stroke-opacity": ".85", "stroke-width": 1.4, "stroke-linecap": "round", pathLength: 1, "stroke-dasharray": "1 1" }, svg);
  const draw = (el, p) => st(el, { strokeDashoffset: String(1 - clamp(p)), opacity: p > 0.001 ? "1" : "0" });
  return {
    svg,
    /** p in seconds since the draw starts */
    update(dt) {
      draw(tri, seg(dt, 0, 0.55, E.inOutCubic));
      tri.style.fillOpacity = String(seg(dt, 0.3, 0.8, E.outCubic));
      draw(beam, seg(dt, 0.15, 0.4, E.outCubic));
      draw(inner, seg(dt, 0.35, 0.55, E.outCubic));
      rays.forEach((r, i) => draw(r, seg(dt, 0.5 + i * 0.05, 0.85 + i * 0.05, E.outExpo)));
      draw(glint, seg(dt, 0.7, 0.95, E.outCubic));
    },
  };
}

/** a floating UI window plate (image or sequence) in 3D with shadow, rim light and glass sheen */
export class Win {
  constructor(parent, w, h, o = {}) {
    this.w = w;
    this.h = h;
    this.o = Object.assign({ radius: 14 }, o);
    this.root = h_("div", "win3d", parent, { width: w + "px", height: h + "px", left: "0", top: "0" });
    this.shadow = h_("div", "winshadow", this.root, { borderRadius: this.o.radius + "px" });
    if (o.backdrop !== false) this.back = h_("div", "", this.root, { position: "absolute", inset: "0", borderRadius: this.o.radius + "px", background: "rgba(13,14,19,0.82)", backdropFilter: "blur(24px) saturate(1.3)" });
    this.img = h_("img", "", this.root, { position: "absolute", inset: "0", width: "100%", height: "100%", borderRadius: this.o.radius + "px" });
    this.sheenBox = h_("div", "sheen", this.root, { borderRadius: this.o.radius + "px" });
    this.sheen = h_("div", "", this.sheenBox);
    this.rim = h_("div", "rim", this.root, { borderRadius: this.o.radius + "px" });
  }
  src(url) {
    setSrc(this.img, url);
  }
  /** pose: cx, cy = screen centre; s = scale; rx, ry, rz degrees; z px; o opacity; sheen 0..1 */
  pose({ cx, cy, s = 1, rx = 0, ry = 0, rz = 0, z = 0, o = 1, sheen = -1, persp = 2200, blur = 0 }) {
    st(this.root, {
      transform: `translate(${(cx - this.w / 2).toFixed(1)}px, ${(cy - this.h / 2).toFixed(1)}px) perspective(${persp}px) translateZ(${z.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${s.toFixed(4)})`,
      opacity: clamp(o).toFixed(3),
      display: o <= 0.001 ? "none" : "",
      filter: blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : "none",
    });
    st(this.sheen, { left: `${lerp(-40, 120, sheen)}%`, opacity: sheen < 0 || sheen > 1 ? "0" : "1" });
  }
}
function h_(tag, cls, parent, style) {
  return h(tag, cls, parent, style);
}

/** full-frame ambient background: near-black canvas with the accent light pools of the app */
export function ambient(parent, o = {}) {
  const d = h("div", "layer", parent, { background: o.bg ?? C.canvas });
  const pools = h("div", "layer", d, {
    background: o.pools ?? "radial-gradient(55% 60% at 12% 8%, rgba(100,97,242,0.30) 0%, transparent 70%), radial-gradient(45% 55% at 5% 100%, rgba(47,203,230,0.14) 0%, transparent 70%), radial-gradient(40% 45% at 70% 110%, rgba(255,127,143,0.08) 0%, transparent 70%)",
  });
  return { root: d, pools };
}

/** mouse cursor (macOS/Windows-neutral arrow) */
export function cursor(parent) {
  const c = h("div", "", parent, { position: "absolute", left: "0", top: "0", width: "34px", height: "44px", zIndex: "50", filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.5))" });
  c.innerHTML = `<svg width="34" height="44" viewBox="0 0 17 22"><path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  const ring = h("div", "", parent, { position: "absolute", left: "0", top: "0", width: "80px", height: "80px", borderRadius: "50%", border: "3px solid rgba(255,255,255,0.9)", zIndex: "49", opacity: "0" });
  return {
    at(x, y, press = 0, clickDt = -1) {
      st(c, { transform: `translate(${x - 4}px, ${y - 2}px) scale(${1 - press * 0.12})` });
      if (clickDt >= 0 && clickDt < 0.5) {
        const p = clickDt / 0.5;
        st(ring, { opacity: String((1 - p) * 0.9), transform: `translate(${x - 40}px, ${y - 40}px) scale(${0.2 + p * 1.2})` });
      } else st(ring, { opacity: "0" });
    },
    show(on) {
      c.style.display = on ? "" : "none";
      if (!on) ring.style.opacity = "0";
    },
  };
}

export function chip(parent, html, style = {}) {
  const c = h("div", "chip", parent, style);
  c.innerHTML = html;
  return c;
}
export { SPECTRUM, decay };
