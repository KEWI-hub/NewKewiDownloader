// 7 · Outro (108.0 – 121.2 s): rays retract into the prism, the prism turns to camera and
// becomes the app icon (geometry-locked hand-off), wordmark, tagline, platforms, fade.
import { h, st, clamp, lerp, seg, E, T, Seq, KText, drawSparks, glowDot, decay, noise1, spec, ASSET, GRAD_PRISM, C, SPECTRUM, setSrc } from "../lib.js";
import { loadGeom } from "./common.js";

const RAY_COLORS = ["#ff7f8f", "#f2c14e", "#7ad66a", "#2ed3a9", "#2fcbe6", "#46a8ff", "#6a8cff", "#8b7bff"];
let G, plate, bg, cv, cx, icon, iconGlow, sheenBox, sheen, word, tag, oneb, cta;
const ICON_TRI_W = 503.8 / 1024; // triangle width / icon size (assets/brand/app-icon.svg)
const ICON_CX = 446 / 1024, ICON_CY = 582 / 1024; // triangle centroid inside the icon
const LOCK = { size: 230, cx: 700, cy: 455 };

export default {
  id: "outro",
  start: 108.0,
  end: 121.3,
  z: 7,
  async build(root, ctx) {
    G = await loadGeom("outro", 324);
    bg = h("div", "layer", root, { background: "radial-gradient(60% 60% at 50% 45%, rgba(100,97,242,0.22) 0%, rgba(7,8,11,1) 70%)" });
    plate = new Seq(root, `${ASSET.work}/bl/outro`, 324, { prefix: "", pad: 4 });
    cv = h("canvas", "", root);
    cv.width = ctx.W;
    cv.height = ctx.H;
    cx = cv.getContext("2d");
    iconGlow = h("div", "", root, { position: "absolute", left: "0", top: "0", width: "900px", height: "900px", marginLeft: "-450px", marginTop: "-450px", borderRadius: "50%", background: "radial-gradient(50% 50% at 50% 50%, rgba(142,140,255,0.55) 0%, rgba(100,97,242,0.18) 35%, rgba(100,97,242,0) 70%)", mixBlendMode: "screen", opacity: "0" });
    icon = h("div", "", root, { position: "absolute", left: "0", top: "0", width: "1024px", height: "1024px", transformOrigin: "0 0", opacity: "0" });
    const img = h("img", "", icon, { position: "absolute", inset: "0", width: "1024px", height: "1024px" });
    img.src = "/assets/brand/app-icon.svg";
    sheenBox = h("div", "", icon, { position: "absolute", left: "64px", top: "64px", width: "896px", height: "896px", borderRadius: "206px", overflow: "hidden", mixBlendMode: "screen" });
    sheen = h("div", "", sheenBox, { position: "absolute", top: "-30%", height: "160%", width: "26%", background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.35), rgba(255,255,255,0))", transform: "rotate(20deg)" });
    word = new KText(root, "Prism", { x: LOCK.cx + LOCK.size / 2 + 40, y: LOCK.cy + 4, size: 196, weight: 660, tracking: -0.04, mask: true });
    word.anim("in", T("wordmark"), "rise", { dur: 0.8, stagger: 0.055 });
    tag = new KText(root, "Download everything, beautifully.", { x: 960, y: 690, size: 64, weight: 640, align: "center", tracking: -0.03 });
    tag.anim("in", T("tagline"), "track", { dur: 1.0, stagger: 0 });
    oneb = new KText(root, "One beam. Many rays.", { x: 960, y: 780, size: 36, weight: 600, align: "center", tracking: -0.01, gradient: GRAD_PRISM, mask: true, seed: 2 });
    oneb.anim("in", T("oneb"), "rise", { dur: 0.6, stagger: 0.02 });
    cta = h("div", "", root, { position: "absolute", left: "960px", top: "930px", transform: "translateX(-50%)", display: "flex", gap: "26px", alignItems: "center", fontFamily: "JetBrains Mono", fontSize: "22px", letterSpacing: "0.16em", color: "#a3a7b5", whiteSpace: "nowrap", opacity: "0" });
    cta.innerHTML = `<span>WINDOWS</span><span style="width:5px;height:5px;border-radius:50%;background:#6461f2"></span><span>LINUX</span><span style="width:5px;height:5px;border-radius:50%;background:#2fcbe6"></span><span>MACOS</span>`;
  },
  update(t, ctx) {
    const out = { bloom: t < T("icon_flash") ? 0.25 : 0.4 };
    const t0 = 108.0;
    const tf = T("icon_flash");
    const lt = t - t0;
    const fr = plate.at(lt);
    const g = G[fr];
    const plateO = 1 - seg(t, tf + 0.05, tf + 0.45);
    plate.img.style.opacity = plateO.toFixed(3);
    plate.img.style.display = plateO <= 0 ? "none" : "";
    cx.clearRect(0, 0, ctx.W, ctx.H);
    // sparks sucked back along the retracting rays
    if (g && t < tf) {
      g.rays.forEach((ray, k) => {
        const [a, b] = ray;
        const dx = a[0] - b[0], dy = a[1] - b[1];
        const len = Math.hypot(dx, dy) || 1;
        drawSparks(cx, t, { t0: t0, t1: t0 + 1.6, rate: 14, seed: 70 + k, maxLife: 0.7, streak: 0.05, emitter: (birth, r) => {
          const sp = 900 + r() * 600;
          return { x: b[0] + (r() - 0.5) * 8, y: b[1], vx: (dx / len) * sp, vy: (dy / len) * sp, life: 0.55, size: 1.8, color: RAY_COLORS[k], drag: 0 };
        } });
      });
    }
    // flash at the hand-off
    if (g) glowDot(cx, g.centroid[0], g.centroid[1], 700, "rgba(235,235,255,0.95)", decay(t, tf, 3.5) * (t >= tf ? 1 : 0) + 0.25 * seg(t, tf - 0.8, tf, E.inCubic) * (t < tf ? 1 : 0));
    // icon: appears exactly on the prism silhouette, then glides into the lockup
    const gF = G[Math.min(323, Math.round((tf - t0) * 60))];
    if (gF) {
      const [A, B, Cc] = gF.prism;
      const triW = Math.hypot(Cc[0] - B[0], Cc[1] - B[1]);
      const S0 = (triW / ICON_TRI_W) * 0.86;
      const x0 = gF.centroid[0] - ICON_CX * S0, y0 = gF.centroid[1] - ICON_CY * S0;
      const m = seg(t, tf + 0.25, tf + 1.1, E.inOutQuint);
      const S1 = LOCK.size / (896 / 1024);
      const x1 = LOCK.cx - S1 / 2, y1 = LOCK.cy - S1 / 2;
      const S = lerp(S0, S1, m), x = lerp(x0, x1, m), y = lerp(y0, y1, m);
      const io = seg(t, tf - 0.02, tf + 0.12);
      st(icon, { opacity: io.toFixed(3), transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(S / 1024).toFixed(5)})`, filter: `brightness(${(1 + 1.5 * decay(t, tf, 5)).toFixed(3)})` });
      st(sheen, { left: `${lerp(-40, 130, seg(t, tf + 1.2, tf + 2.2, E.inOutCubic))}%` });
      const gc = [x + 0.5 * S, y + 0.5 * S];
      st(iconGlow, { opacity: (io * (0.5 + 0.5 * decay(t, tf, 2))).toFixed(3), transform: `translate(${gc[0].toFixed(1)}px, ${gc[1].toFixed(1)}px) scale(${(S / 700).toFixed(3)})` });
    }
    word.update(t);
    tag.update(t);
    oneb.update(t);
    st(cta, { opacity: seg(t, T("cta"), T("cta") + 0.6).toFixed(2), letterSpacing: `${lerp(0.4, 0.16, seg(t, T("cta"), T("cta") + 1.2, E.outCubic)).toFixed(3)}em` });
    out.flash = 0.45 * decay(t, tf, 6) * (t >= tf ? 1 : 0) + seg(t, t0 - 0.05, t0 + 0.15) * 0 + 0.6 * decay(t, t0, 7);
    out.fade = 1 - seg(t, T("fade"), 120.6, E.inOutCubic);
    return out;
  },
};
