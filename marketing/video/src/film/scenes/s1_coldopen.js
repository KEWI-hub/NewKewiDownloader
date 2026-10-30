// 1 · Cold open (0 – 11.4 s): beam → prism → rays; "One beam. Many rays."; logo lockup.
import { h, st, clamp, lerp, seg, E, T, Seq, KText, drawSparks, glowDot, neonLine, rng, spec, decay, GRAD_PRISM, ASSET, noise1 } from "../lib.js";
import { loadGeom, logoMark } from "./common.js";

const RAY_COLORS = ["#ff7f8f", "#f2c14e", "#7ad66a", "#2ed3a9", "#2fcbe6", "#46a8ff", "#6a8cff", "#8b7bff"];
let G, plate, cv, cx2, flare, flare2, txtA, txtB, block, mark, word, sub;

export default {
  id: "coldopen",
  start: 0,
  end: 11.4,
  z: 2,
  async build(root, ctx) {
    G = await loadGeom("coldopen", 756);
    plate = new Seq(root, `${ASSET.work}/bl/coldopen`, 756, { prefix: "", pad: 4 });
    cv = h("canvas", "", root);
    cv.width = ctx.W;
    cv.height = ctx.H;
    cx2 = cv.getContext("2d");
    flare = h("div", "", root, { position: "absolute", left: "0", top: "0", width: "1800px", height: "10px", marginLeft: "-900px", marginTop: "-5px", borderRadius: "50%", background: "radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,1) 0%, rgba(200,205,255,0.55) 25%, rgba(140,140,255,0) 100%)", mixBlendMode: "screen", filter: "blur(2px)", opacity: "0" });
    flare2 = h("div", "", root, { position: "absolute", left: "0", top: "0", width: "700px", height: "700px", marginLeft: "-350px", marginTop: "-350px", borderRadius: "50%", background: "radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.9) 0%, rgba(160,160,255,0.35) 22%, rgba(100,97,242,0) 70%)", mixBlendMode: "screen", opacity: "0" });
    // type block (upper right, above the rays)
    block = h("div", "layer", root);
    txtA = new KText(block, "One beam.", { x: 1080, y: 250, size: 132, weight: 680, tracking: -0.045, mask: true, glow: "0 0 40px rgba(180,180,255,0.25)" });
    txtB = new KText(block, "Many rays.", { x: 1080, y: 395, size: 132, weight: 680, tracking: -0.045, gradient: GRAD_PRISM, seed: 11 });
    txtA.anim("in", T("txt_onebeam"), "rise", { dur: 0.75, stagger: 0.045 });
    txtB.anim("in", T("txt_manyrays"), "rays", { dur: 0.9, stagger: 0.035, order: "rev" });
    txtA.pulse(T("txt_manyrays"), 0.03);
    // lockup
    const lock = h("div", "", block, { position: "absolute", left: "1080px", top: "150px" });
    mark = logoMark(lock, 132, { left: "0", top: "0" });
    word = new KText(block, "Prism", { x: 1240, y: 216, size: 150, weight: 650, tracking: -0.035, mask: true });
    word.anim("in", T("wordmark_in"), "rise", { dur: 0.8, stagger: 0.05 });
    sub = h("div", "", block);
  },
  update(t, ctx) {
    const fr = plate.at(t);
    const g = G[fr];
    const hit = T("hit1");
    // ---- 2D light on top of the 3D plate
    cx2.clearRect(0, 0, ctx.W, ctx.H);
    if (g) {
      const E0 = g.beam[1];
      // dust motes drifting in the dark
      const R = rng(5);
      cx2.save();
      cx2.globalCompositeOperation = "lighter";
      for (let i = 0; i < 90; i++) {
        const x = ((R() * ctx.W + t * (8 + R() * 14)) % ctx.W);
        const y = ((R() * ctx.H - t * (3 + R() * 6) + ctx.H) % ctx.H);
        const near = Math.exp(-((y - E0[1]) ** 2) / 60000);
        const a = (0.05 + 0.25 * near * seg(t, 1.0, 4.8)) * (0.6 + 0.4 * Math.sin(t * 2 + i));
        cx2.fillStyle = `rgba(200,205,255,${a.toFixed(3)})`;
        cx2.fillRect(x, y, 1.6, 1.6);
      }
      cx2.restore();
      // the thin beam travelling in from the left edge before the 3D beam reaches the frame
      if (t > 1.2 && t < hit) {
        const S0 = g.beam[0];
        const k = (0 - S0[0]) / (E0[0] - S0[0]);
        const P = [0, S0[1] + (E0[1] - S0[1]) * k];
        const u = 0.82 * seg(t, 1.2, 4.3, (x) => 0.45 * x + 0.55 * x * x);
        const hd = [lerp(P[0], E0[0], u), lerp(P[1], E0[1], u)];
        const a = seg(t, 1.2, 1.6) * (1 - seg(t, 4.25, 4.55));
        neonLine(cx2, [P, hd], "#dfe3ff", { width: 2.2, glow: 16, alpha: a, core: "rgba(255,255,255,0.95)" });
        glowDot(cx2, hd[0], hd[1], 70, "rgba(235,238,255,0.9)", a);
        glowDot(cx2, hd[0], hd[1], 14, "#ffffff", a);
      }
      // sparks bursting at the hit
      drawSparks(cx2, t, { t0: hit, t1: hit + 0.12, rate: 1400, seed: 9, maxLife: 1.6, emitter: (b, r) => {
        const a = (r() - 0.5) * Math.PI * 1.3 - 0.25;
        const sp = 400 + r() * 1500;
        return { x: E0[0], y: E0[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + r() * 1.0, size: 1.2 + r() * 2.4, color: r() < 0.4 ? "#ffffff" : RAY_COLORS[Math.floor(r() * 8)], drag: 2.6 };
      } });
      // sparks streaming along every ray
      g.rays.forEach((ray, k) => {
        const [a, b] = ray;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        drawSparks(cx2, t, { t0: hit + 0.25 + k * 0.03, rate: 10, seed: 30 + k, maxLife: 1.4, streak: 0.05, emitter: (birth, r) => {
          const sp = 700 + r() * 500;
          const off = (r() - 0.5) * 6;
          return { x: a[0] - (dy / len) * off, y: a[1] + (dx / len) * off, vx: (dx / len) * sp, vy: (dy / len) * sp, life: 0.9 + r() * 0.5, size: 1.4 + r() * 1.4, color: RAY_COLORS[k], drag: 0.2, a: 0.9 };
        } });
      });
      // anamorphic streak + bloom ball on the hit
      const f = decay(t, hit, 3.2);
      st(flare, { transform: `translate(${E0[0]}px, ${E0[1]}px) scaleX(${(0.4 + 0.9 * seg(t, hit, hit + 0.5, E.outExpo)).toFixed(3)})`, opacity: (f * 0.95).toFixed(3) });
      st(flare2, { transform: `translate(${E0[0]}px, ${E0[1]}px) scale(${(0.4 + 1.2 * seg(t, hit, hit + 0.4, E.outExpo)).toFixed(3)})`, opacity: (f * 0.8).toFixed(3) });
    }
    // ---- type
    const sh = T("logo_in");
    const k = seg(t, sh, sh + 0.9, E.inOutQuint);
    // headline shrinks into the tagline line under the lockup
    txtA.root.style.left = lerp(1080, 1088, k) + "px";
    txtA.root.style.top = lerp(250, 360, k) + "px";
    txtA.root.style.fontSize = lerp(132, 50, k) + "px";
    txtB.root.style.left = lerp(1080, 1088 + txtA.root.offsetWidth + 14, k) + "px";
    txtB.root.style.top = lerp(395, 360, k) + "px";
    txtB.root.style.fontSize = lerp(132, 50, k) + "px";
    txtA.update(t);
    txtB.update(t);
    mark.update(t - sh - 0.45);
    word.update(t);
    // drifting block
    st(block, { transform: `translate(${noise1(t * 0.3, 4) * 6}px, ${noise1(t * 0.3, 8) * 4}px)` });
    const out = { bloom: 0.22 };
    out.flash = decay(t, hit, 9) * 0.35;
    // fade in from black
    out.fade = seg(t, 0.0, 0.9);
    return out;
  },
};
