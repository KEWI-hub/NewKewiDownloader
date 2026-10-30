// Orchestrator: builds every scene once, then FILM.render(t) poses the whole film at time t
// and returns the per-frame post-FX parameters (shake, chromatic aberration, flash, motion
// blur sub-samples) that post.py applies. Driven frame by frame by render.mjs.
import * as L from "./lib.js";
import { SCENES } from "./scenes/index.js";

const q = new URLSearchParams(location.search);
const W = Number(q.get("w") ?? 1920);
const H = Number(q.get("h") ?? 1080);
const stage = document.getElementById("stage");
// ?notext=1 renders the picture without any typography (inset source for the 9:16 cut)
if (q.get("notext")) document.head.insertAdjacentHTML("beforeend", "<style>.ktext,.odo,.chip,.footnote,.mono{visibility:hidden!important}</style>");
Object.assign(stage.style, { width: W + "px", height: H + "px" });
document.body.style.width = W + "px";
document.body.style.height = H + "px";

// shake/CA/zoom-punch strengths for timeline sfx families (picture follows the sound design)
const IMPACT = { impact_big: 1.0, impact_drop: 1.0, impact_slam: 0.75, impact_final: 0.6, impact_soft: 0.25, glass_shatter: 0.45, type_slam: 0.22, power_down: 0.5, power_up: 0.35, pop_big: 0.2, success_hit: 0.2 };

const ctx = { W, H, stage, L, vertical: H > W };

async function init() {
  const tl = await fetch("../timeline.json").then((r) => r.json());
  L.setTimeline(tl);
  ctx.timeline = tl;
  await Promise.all([
    document.fonts.load('400 40px "InterVariable"'),
    document.fonts.load('800 40px "InterVariable"'),
    document.fonts.load('400 40px "JetBrains Mono"'),
  ]);
  await document.fonts.ready;
  for (const s of SCENES) {
    s.root = L.h("div", "scene", stage, { zIndex: String(s.z ?? 1) });
    s.root.dataset.scene = s.id;
    await s.build(s.root, ctx);
    s.root.style.display = "none";
  }
  window.FILM.snapshots = SCENES.flatMap((s) => s.snaps ?? []);
  return true;
}

function impacts(t) {
  let shake = 0, ca = 0, zoom = 0;
  for (const e of ctx.timeline.events) {
    const k = IMPACT[e.sfx];
    if (!k || t < e.t) continue;
    const a = t - e.t;
    if (a > 2) continue;
    shake += k * Math.exp(-a * 7);
    ca += k * Math.exp(-a * 9);
    zoom += k * Math.exp(-a * 10);
  }
  return { shake, ca, zoom };
}

async function render(t, opts = {}) {
  ctx.snapMode = !!opts.snap;
  const fx = { shake: [0, 0, 0], zoom: 1, ca: 0, flash: 0, mb: 1, bloom: 0.35, grain: 1, vignette: 1, fade: 1 };
  for (const s of SCENES) {
    const on = t >= s.start && t < s.end;
    if (s.root.style.display !== (on ? "" : "none")) s.root.style.display = on ? "" : "none";
    if (!on) continue;
    const r = (await s.update(t, ctx)) || {};
    if (r.ca) fx.ca += r.ca;
    if (r.flash) fx.flash = Math.max(fx.flash, r.flash);
    if (r.mb) fx.mb = Math.max(fx.mb, r.mb);
    if (r.bloom !== undefined) fx.bloom = r.bloom;
    if (r.fade !== undefined) fx.fade = Math.min(fx.fade, r.fade);
    if (r.shake) fx.shake[0] += r.shake;
  }
  const im = impacts(t);
  const sh = im.shake * 14 + fx.shake[0];
  fx.shake = [L.noise1(t * 22, 1) * sh, L.noise1(t * 22, 2) * sh, L.noise1(t * 15, 3) * sh * 0.04];
  fx.ca += im.ca * 6;
  fx.zoom = 1 + im.zoom * 0.025;
  if (ctx.snapMode) Object.assign(fx, { shake: [0, 0, 0], zoom: 1, ca: 0, flash: 0, mb: 1 });
  await L.settle();
  return fx;
}

window.FILM = { W, H, ready: null, render, snapshots: [], SCENES };
window.FILM.ready = init().catch((e) => { console.error(e); window.FILM.error = String(e.stack || e); return false; });
