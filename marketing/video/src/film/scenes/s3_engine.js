// 3 · The engine (21.0 – 43.4 s): beam hits the prism → 16 rays become 16 connection lanes,
// 15× benchmark slam, up to 32 connections, work stealing, 966 MiB/s, pull-the-plug resume,
// then the lanes fly into the real details window (match cut to scene 4).
import { h, st, clamp, lerp, seg, E, T, Seq, KText, Odo, neonLine, drawSparks, glowDot, beatPulse, decay, noise1, rng, spec, ASSET, GRAD_PRISM, C, SPECTRUM } from "../lib.js";
import { loadGeom } from "./common.js";

const LANE_Y = (k) => 252 + 38 * k;
const JOIN = 1000;
// final lane rects inside the details window at 43.2 s (window centre 960,560 · scale 0.7237)
export const DW = { cx: 960, cy: 560, s: 0.7237, w: 1520, h: 1200 };
const DW_LANE = (k) => ({ x0: 410 + 96 * DW.s, x1: 410 + 544 * DW.s, y: 125.8 + (484 + 46 * k) * DW.s });
const DW_PROG = [0.786, 0.643, 0.563, 0.563, 0.844, 0.791, 0.429, 0.558, 0.607, 0.786, 0.813, 0.813, 0.7, 0.6, 0.75, 0.66];

let ln, plate, G, cvU, cU, cvL, cL, masks = [], heads = [], speeds = [], root_, lay, t16, tFile, odo, odoLab, fmap, fmapSegs = [], fmapLab;
let cmp, rowA, rowB, barA, segB = [], labA, labB, valA, valB, big15, faster, foot, doneChip;
let t32, steal, odo966, sub966, plug, typed, lose, safeChip, crt;

const R = rng(77);
const V = Array.from({ length: 32 }, () => 0.09 + R() * 0.07); // lane speeds (fraction / s)
const P0 = Array.from({ length: 32 }, () => R() * 0.12);
const P1 = Array.from({ length: 32 }, () => 0.4 + R() * 0.35);

export default {
  id: "engine",
  start: 21.0,
  end: 43.45,
  z: 4,
  async build(root, ctx) {
    root_ = root;
    root.style.background = C.canvas;
    G = await loadGeom("bridge", 540);
    crt = h("div", "layer", root, { transformOrigin: "50% 50%" });
    plate = new Seq(crt, `${ASSET.work}/bl/bridge`, 540, { prefix: "", pad: 4 });
    cvU = h("canvas", "", crt);
    cvU.width = ctx.W;
    cvU.height = ctx.H;
    cU = cvU.getContext("2d");
    // progress masks that turn the glowing rays into progress lanes
    lay = h("div", "layer", crt);
    for (let k = 0; k < 16; k++) {
      const m = h("div", "", lay, { position: "absolute", left: "0", top: LANE_Y(k) - 16 + "px", height: "32px", width: "1000px", background: "linear-gradient(90deg, rgba(7,8,11,0.86) 0px, rgba(7,8,11,0.93) 40px)" });
      h("div", "", m, { position: "absolute", left: "0", right: "0", top: "15px", height: "2px", background: SPECTRUM[k % 8], opacity: "0.22" });
      masks.push(m);
      const hd = h("div", "", lay, { position: "absolute", left: "0", top: LANE_Y(k) - 10 + "px", width: "4px", height: "20px", marginLeft: "-2px", borderRadius: "2px", background: "#fff", boxShadow: `0 0 10px #fff, 0 0 22px ${SPECTRUM[k % 8]}` });
      heads.push(hd);
      const sp = h("div", "mono", lay, { position: "absolute", right: "44px", top: LANE_Y(k) - 11 + "px", fontSize: "17px", color: "#9aa0b4", textAlign: "right" });
      speeds.push(sp);
    }
    ln = h("div", "layer", root, { transformOrigin: "50% 50%" });
    cvL = h("canvas", "", ln);
    cvL.width = ctx.W;
    cvL.height = ctx.H;
    cL = cvL.getContext("2d");
    t16 = new KText(crt, "16 connections.", { x: 150, y: 136, size: 92, weight: 720, tracking: -0.045, mask: true });
    t16.anim("in", T("txt_16conn"), "rise", { dur: 0.6, stagger: 0.025 }).anim("out", T("compare") - 0.25, "up", { dur: 0.25, stagger: 0.008 });
    t16.pulse(T("txt_onefile"), 0.03);
    tFile = new KText(crt, "One file.", { x: 150, y: 930, size: 92, weight: 720, tracking: -0.045, gradient: GRAD_PRISM, mask: true, seed: 5 });
    tFile.anim("in", T("txt_onefile"), "rise", { dur: 0.6, stagger: 0.035 }).anim("out", T("compare") - 0.25, "down", { dur: 0.25, stagger: 0.01 });
    odoLab = h("div", "mono", crt, { position: "absolute", right: "80px", top: "70px", fontSize: "20px", color: "#888da1", letterSpacing: "0.12em" });
    odoLab.textContent = "SPEED";
    odo = new Odo(crt, { x: 1840, y: 150, size: 96, weight: 720, digits: 2, decimals: 1, suffix: "MiB/s", align: "right", suffixSize: 0.34 });
    fmap = h("div", "", crt, { position: "absolute", left: JOIN + "px", top: "922px", width: "840px", height: "16px" });
    for (let k = 0; k < 16; k++) {
      const s = h("div", "", fmap, { position: "absolute", top: "0", height: "16px", left: (k * 840) / 16 + 1 + "px", width: 840 / 16 - 3 + "px", borderRadius: "3px", background: "rgba(255,255,255,0.07)", overflow: "hidden" });
      const f = h("div", "", s, { position: "absolute", left: "0", top: "0", bottom: "0", width: "0", background: SPECTRUM[k % 8], boxShadow: `0 0 12px ${SPECTRUM[k % 8]}` });
      fmapSegs.push({ s, f });
    }
    fmapLab = h("div", "mono", crt, { position: "absolute", left: JOIN + "px", top: "884px", fontSize: "18px", color: "#888da1", width: "840px", display: "flex", justifyContent: "space-between" });
    fmapLab.innerHTML = "<span>FILE MAP</span><span>16 SEGMENTS · ubuntu-26.04-desktop-amd64.iso</span>";

    // ---- comparison (30.0 – 33.6)
    cmp = h("div", "layer", root);
    const row = (y, name) => {
      const r = h("div", "", cmp, { position: "absolute", left: "160px", top: y + "px", width: "1600px" });
      const lab = h("div", "", r, { position: "absolute", left: "0", top: "-58px", fontSize: "30px", fontWeight: "650", color: C.text, letterSpacing: "-0.01em" });
      lab.innerHTML = name;
      const val = h("div", "mono", r, { position: "absolute", right: "0", top: "-52px", fontSize: "26px", color: "#a3a7b5", textAlign: "right" });
      const track = h("div", "", r, { position: "absolute", left: "0", top: "0", width: "1600px", height: "26px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)", overflow: "hidden" });
      return { r, lab, val, track };
    };
    rowA = row(330, '<span style="color:#8a8fa0">curl</span> &nbsp;·&nbsp; <span style="color:#a3a7b5;font-weight:500">1 connection</span>');
    barA = h("div", "", rowA.track, { position: "absolute", left: "0", top: "0", bottom: "0", width: "0", background: "linear-gradient(90deg,#5a5e6c,#8a8fa0)" });
    rowB = row(540, 'Prism &nbsp;·&nbsp; <span style="color:#a3a7b5;font-weight:500">16 connections</span>');
    for (let k = 0; k < 16; k++) {
      const s = h("div", "", rowB.track, { position: "absolute", top: "0", bottom: "0", left: (k * 1600) / 16 + "px", width: "0", background: SPECTRUM[k % 8], boxShadow: `0 0 18px ${SPECTRUM[k % 8]}` });
      const hd = h("div", "", rowB.track, { position: "absolute", top: "0", bottom: "0", width: "3px", background: "#fff", boxShadow: "0 0 10px #fff" });
      segB.push({ s, hd });
    }
    valA = rowA.val;
    valB = rowB.val;
    doneChip = h("div", "chip", cmp, { left: "1460px", top: "600px", color: C.success, fontSize: "22px", opacity: "0" });
    doneChip.innerHTML = "✓ &nbsp;Done · SHA-256 verified";
    big15 = new KText(cmp, "15×", { x: 150, y: 820, size: 300, weight: 800, tracking: -0.06, gradient: GRAD_PRISM, seed: 3 });
    big15.anim("in", T("slam15x"), "zoom", { dur: 0.45, stagger: 0.04, ease: E.outExpo }).anim("out", T("lanes32") - 0.3, "blur", { dur: 0.3, stagger: 0 });
    faster = new KText(cmp, "faster on throttled servers", { x: 700, y: 800, size: 58, weight: 620, color: C.text, tracking: -0.025, mask: true });
    faster.anim("in", T("txt_faster"), "rise", { dur: 0.55, stagger: 0.012 }).anim("out", T("lanes32") - 0.3, "up", { dur: 0.25, stagger: 0.004 });
    foot = h("div", "footnote", cmp, { left: "703px", top: "860px" });
    foot.textContent = "1 GiB · server limits each connection to 4 MiB/s · Prism 61.8 MiB/s vs curl 4.0 MiB/s (docs/benchmarks.md, scenario A)";

    // ---- 32 lanes, stealing, 966, plug
    t32 = new KText(root, "Up to 32 connections.", { x: 150, y: 110, size: 84, weight: 720, tracking: -0.045, mask: true });
    t32.anim("in", T("lanes32") + 0.15, "rise", { dur: 0.6, stagger: 0.018 }).anim("out", T("slam966") - 0.2, "up", { dur: 0.2, stagger: 0.005 });
    steal = h("div", "chip", root, { left: "150px", top: "968px", fontSize: "24px", color: C.text, opacity: "0" });
    steal.innerHTML = `<span style="color:${C.accent}">⤷</span>&nbsp; Done early? It takes half of the biggest remaining range.`;
    odo966 = new Odo(root, { x: 960, y: 500, size: 300, weight: 800, digits: 3, decimals: 0, suffix: "MiB/s", align: "center", suffixSize: 0.22, gradient: GRAD_PRISM });
    odo966.root.style.opacity = "0";
    sub966 = new KText(root, "raw throughput · 2 GiB written in 2.1 s", { x: 960, y: 690, size: 40, weight: 560, color: "#c3c6d0", align: "center", tracking: -0.01, mask: true });
    sub966.anim("in", T("slam966") + 0.6, "rise", { dur: 0.5, stagger: 0.008 }).anim("out", T("plug") - 0.5, "up", { dur: 0.3, stagger: 0.003 });
    plug = new KText(ln, "Pull the plug.", { x: 960, y: 520, size: 150, weight: 780, align: "center", tracking: -0.05, color: "#ffffff" });
    plug.anim("in", T("plug") - 0.35, "snap", { dur: 0.35, stagger: 0.02 });
    typed = h("div", "mono", root, { position: "absolute", left: "960px", top: "540px", transform: "translate(-50%,-50%)", fontSize: "30px", color: "#9aa0b4", whiteSpace: "pre" });
    lose = new KText(root, "Lose nothing.", { x: 960, y: 150, size: 120, weight: 760, align: "center", tracking: -0.05, gradient: GRAD_PRISM, mask: true, seed: 8 });
    lose.anim("in", T("txt_losenothing"), "rise", { dur: 0.6, stagger: 0.03 }).anim("out", T("engine_out"), "up", { dur: 0.35, stagger: 0.01 });
    safeChip = h("div", "chip", root, { left: "960px", top: "950px", transform: "translate(-50%,-50%)", color: C.success, opacity: "0", fontSize: "24px" });
    safeChip.innerHTML = "✓ &nbsp;Crash-safe resume · ETag / If-Range validated · data fsynced before state";
  },

  update(t, ctx) {
    const W = ctx.W, H = ctx.H;
    const out = { bloom: t < T("compare") ? 0.25 : 0.4 };
    const hit = T("drop");
    const tCmp = T("compare");
    const t32s = T("lanes32");
    const t966 = T("slam966");
    const tPlug = T("plug");
    const tUp = T("power_up");
    const tOut = T("engine_out");
    // ================= bridge plate phase (21.0 – 30.0)
    const plateOn = t < tCmp;
    plate.img.style.display = plateOn ? "" : "none";
    cU.clearRect(0, 0, W, H);
    lay.style.display = plateOn ? "" : "none";
    fmap.style.display = fmapLab.style.display = odo.root.style.display = odoLab.style.display = plateOn ? "" : "none";
    if (plateOn) {
      const fr = plate.at(t - 21.0);
      const g = G[fr];
      // sparks on the hit + sparks racing along the lanes
      if (g) {
        const E0 = g.beam[1];
        drawSparks(cU, t, { t0: hit, t1: hit + 0.1, rate: 1500, seed: 21, maxLife: 1.4, emitter: (b, r) => {
          const a = (r() - 0.5) * Math.PI * 1.2;
          const sp = 300 + r() * 1400;
          return { x: E0[0], y: E0[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + r() * 0.9, size: 1.2 + r() * 2.2, color: r() < 0.4 ? "#fff" : spec(Math.floor(r() * 8)), drag: 2.8 };
        } });
      }
      for (let k = 0; k < 16; k++) {
        drawSparks(cU, t, { t0: hit + 0.9 + k * 0.02, t1: T("compare") - 0.4, rate: 2.2, seed: 40 + k, maxLife: 1.2, streak: 0.06, emitter: (b, r) => ({ x: JOIN - 40, y: LANE_Y(k) + (r() - 0.5) * 3, vx: 900 + r() * 500, vy: 0, life: 1.1, size: 2, color: spec(k), drag: 0 }) });
      }
      // progress masks wipe in from the right (rays → progress lanes)
      const tm = T("lane_labels") - 0.5;
      for (let k = 0; k < 16; k++) {
        const wipe = seg(t, tm + k * 0.025, tm + 0.6 + k * 0.025, E.inOutQuart);
        const prog = clamp(P0[k] + V[k] * Math.max(0, t - tm) * 0.55);
        const hx = JOIN + (1920 - JOIN) * prog;
        const mx = lerp(1960, hx, wipe);
        st(masks[k], { transform: `translateX(${mx.toFixed(1)}px)`, display: wipe > 0 ? "" : "none" });
        st(heads[k], { transform: `translateX(${mx.toFixed(1)}px)`, opacity: wipe > 0.95 ? (0.85 + 0.15 * beatPulse(t, hit)).toFixed(2) : "0" });
        const sp = 3.6 + 0.6 * noise1(t * 1.5, k);
        speeds[k].textContent = `${String(k + 1).padStart(2, "0")}  ${sp.toFixed(1)} MiB/s`;
        st(speeds[k], { opacity: seg(t, T("lane_labels") + k * 0.035, T("lane_labels") + 0.2 + k * 0.035).toFixed(2) });
        // file map segment k mirrors lane k
        const fo = seg(t, T("filemap") + k * 0.03, T("filemap") + 0.45 + k * 0.03, E.outExpo);
        st(fmapSegs[k].s, { transform: `translateY(${((1 - fo) * (LANE_Y(k) - 922)).toFixed(1)}px) scaleX(${lerp(0.2, 1, fo).toFixed(3)})`, opacity: fo.toFixed(2) });
        st(fmapSegs[k].f, { width: (prog * 100).toFixed(1) + "%" });
      }
      st(fmapLab, { opacity: seg(t, T("filemap") + 0.3, T("filemap") + 0.7).toFixed(2) });
      const sc = seg(t, T("speed_count"), T("speed_count") + 2.2, E.outCubic);
      odo.set(61.8 * sc);
      st(odo.root, { opacity: seg(t, T("speed_count") - 0.1, T("speed_count") + 0.2).toFixed(2) });
      st(odoLab, { opacity: seg(t, T("speed_count") - 0.1, T("speed_count") + 0.2).toFixed(2) });
      out.flash = decay(t, hit, 8) * 0.25;
    }
    t16.update(t);
    tFile.update(t);
    // whip: everything slides left out of frame into the comparison
    const whip = seg(t, tCmp - 0.3, tCmp, E.inExpo);
    const whipIn = seg(t, tCmp, tCmp + 0.35, E.outExpo);
    st(crt, { transform: plateOn ? `translateX(${(-whip * 1400).toFixed(1)}px)` : "" });
    if (t > tCmp - 0.3 && t < tCmp + 0.35) out.mb = 8;

    // ================= comparison (30.0 – 33.6)
    const cmpOn = t >= tCmp && t < t32s + 0.4;
    cmp.style.display = cmpOn ? "" : "none";
    if (cmpOn) {
      const leave = seg(t, t32s - 0.3, t32s + 0.2, E.inExpo);
      st(cmp, { transform: `translateX(${((1 - whipIn) * 1400).toFixed(1)}px) translateY(${(-leave * 300).toFixed(1)}px)`, opacity: (1 - leave).toFixed(3) });
      const el = Math.max(0, t - tCmp - 0.2) * 8; // 8× time-lapse, simulated seconds
      const pA = Math.min(1, (el * 4.0) / 1024);
      const pB = Math.min(1, (el * 61.8) / 1024);
      st(barA, { width: (pA * 100).toFixed(2) + "%" });
      valA.textContent = `${(el > 0 ? 4.0 : 0).toFixed(1)} MiB/s · ${pA < 1 ? Math.min(el, 256).toFixed(1) : "256"} s`;
      valB.textContent = `${(pB < 1 && el > 0 ? 61.8 : 0).toFixed(1)} MiB/s · ${Math.min(el, 16.6).toFixed(1)} s`;
      for (let k = 0; k < 16; k++) {
        const pk = clamp(pB * (0.92 + 0.16 * ((k * 37) % 16) / 16));
        const done = pB >= 1;
        st(segB[k].s, { width: ((done ? 1 : pk) * 100) / 16 + "%" });
        st(segB[k].hd, { left: `calc(${(k * 100) / 16 + ((done ? 1 : pk) * 100) / 16}% - 2px)`, opacity: done ? "0" : "1" });
      }
      const tDone = tCmp + 0.2 + 16.6 / 8;
      st(doneChip, { opacity: seg(t, tDone, tDone + 0.2).toFixed(2), transform: `scale(${(0.8 + 0.2 * seg(t, tDone, tDone + 0.3, E.outBack)).toFixed(3)})` });
      big15.update(t);
      faster.update(t);
      st(foot, { opacity: (seg(t, T("txt_faster") + 0.3, T("txt_faster") + 0.8) * (1 - leave)).toFixed(2) });
    }

    // ================= canvas lanes (32 → 16), 966, plug, resume, fly into window
    cL.clearRect(0, 0, W, H);
    const lanesOn = t >= t32s - 0.1;
    if (lanesOn) {
      const n32 = t < t966 ? 32 : 16;
      const k966 = seg(t, t966 - 0.15, t966 + 0.25, E.inOutCubic); // 32 → 16 merge
      const fly = seg(t, tOut, tOut + 1.2, E.inOutQuint); // into the details window
      const crtOff = seg(t, tPlug + 0.3, tPlug + 0.62, E.inQuart);
      const crtOn = seg(t, tUp, tUp + 0.35, E.outQuart);
      const dark = t >= tPlug + 0.62 && t < tUp;
      // lane speeds: steady, 966 burst accelerates the heads (they wrap)
      for (let k = 0; k < 32; k++) {
        if (k >= 16 && t >= t966 + 0.25) break;
        const appear = seg(t, t32s + k * 0.012, t32s + 0.45 + k * 0.012, E.outExpo);
        const y32 = 168 + 24.2 * k;
        const y16 = 250 + 38 * (k % 16);
        let y = k < 16 ? lerp(y32, y16, k966) : lerp(y32, y16, k966);
        let x0 = 220, x1 = 1700;
        const burst = seg(t, t966, t966 + 0.3) * (1 - seg(t, t966 + 1.4, t966 + 2.0));
        // frozen while the power is out: time stops at the plug
        const tt = t >= tPlug + 0.3 && t < tUp ? tPlug + 0.3 : t < tUp ? t : t - (tUp - tPlug - 0.3);
        let prog = (P1[k] + V[k] * (tt - t32s) * 0.6) % 1;
        if (t >= t966) prog = (P1[k] + V[k] * (tt - t32s) * 0.6 + 4.5 * Math.max(0, Math.min(tt, t966 + 2.0) - t966) * (0.8 + 0.4 * V[k] * 6)) % 1;
        if (t > tOut - 0.6) prog = lerp(prog, DW_PROG[k % 16], seg(t, tOut - 0.6, tOut + 0.4, E.inOutCubic));
        // work stealing: lane 9 races to the end just before the steal; lane 22 sits mid-way
        if (k === 8 && t < t966) prog = t < T("steal") ? lerp(prog, 1, seg(t, T("steal") - 0.9, T("steal"), E.inCubic)) : 1;
        if (k === 21 && t < t966) prog = 0.42 + 0.05 * seg(t, t32s, t966);
        let alpha = appear;
        let width = k < 16 && t >= t966 ? 3.6 : 3.0;
        if (fly > 0) {
          const d = DW_LANE(k % 16);
          x0 = lerp(x0, d.x0, fly);
          x1 = lerp(x1, d.x1, fly);
          y = lerp(y, d.y, fly);
          width = lerp(width, 7, fly);
          if (k >= 12) alpha *= 1 - fly;
        }
        if (k >= 16) alpha *= 1 - k966;
        const col = spec(k);
        const hx = x0 + (x1 - x0) * prog * appear;
        cL.save();
        cL.globalAlpha = 0.25 * alpha;
        cL.strokeStyle = col;
        cL.lineWidth = Math.max(1, width * 0.4);
        cL.beginPath();
        cL.moveTo(x0, y);
        cL.lineTo(x1, y);
        cL.stroke();
        cL.restore();
        neonLine(cL, [[x0, y], [hx, y]], col, { width, glow: 12 + 16 * burst, alpha: alpha * (1 - 0.0 * fly), core: "rgba(255,255,255,0.55)" });
        cL.save();
        cL.globalAlpha = alpha;
        cL.fillStyle = "#fff";
        cL.shadowColor = col;
        cL.shadowBlur = 14;
        cL.fillRect(hx - 1.5, y - width * 2.2, 3, width * 4.4);
        cL.restore();
        // 966 speed streaks
        if (burst > 0.01) {
          const Rr = rng(500 + k);
          for (let s = 0; s < 3; s++) {
            const sx = ((Rr() * 2400 - (t - t966) * (2600 + Rr() * 1800)) % 2400 + 2400) % 2400 - 240;
            const len = 160 + Rr() * 420;
            cL.save();
            cL.globalCompositeOperation = "lighter";
            const gr = cL.createLinearGradient(sx, 0, sx + len, 0);
            gr.addColorStop(0, "rgba(255,255,255,0)");
            gr.addColorStop(1, col);
            cL.strokeStyle = gr;
            cL.globalAlpha = 0.7 * burst * alpha;
            cL.lineWidth = 2;
            cL.beginPath();
            cL.moveTo(sx, y + (Rr() - 0.5) * 16);
            cL.lineTo(sx + len, y + (Rr() - 0.5) * 2);
            cL.stroke();
            cL.restore();
          }
        }
      }
      // work stealing: lane 9 finishes, its connection jumps to the middle of lane 22's gap
      const ts = T("steal");
      if (t >= ts - 0.2 && t < t966 - 0.15) {
        const ya = 168 + 24.2 * 8, yb = 168 + 24.2 * 21;
        const p = seg(t, ts, ts + 0.5, E.inOutCubic);
        const xa = 1700, xb = 220 + (1700 - 220) * 0.735;
        const mx = lerp(xa, xb, p), my = lerp(ya, yb, p) - Math.sin(p * Math.PI) * 120;
        glowDot(cL, xa, ya, 60, spec(8), decay(t, ts, 4));
        if (p > 0 && p < 1) glowDot(cL, mx, my, 40, "#ffffff", 1);
        if (p >= 1) {
          const hx2 = xb + (1700 - xb) * 0.5 * seg(t, ts + 0.5, ts + 1.6);
          neonLine(cL, [[xb, yb], [hx2, yb]], spec(8), { width: 3, glow: 14, alpha: 1 });
          glowDot(cL, xb, yb, 50, spec(8), decay(t, ts + 0.5, 5));
        }
      }
      st(steal, { opacity: (seg(t, ts + 0.15, ts + 0.4) * (1 - seg(t, t966 - 0.3, t966 - 0.1))).toFixed(2), transform: `translateY(${((1 - seg(t, ts + 0.15, ts + 0.5, E.outCubic)) * 20).toFixed(1)}px)` });
      // 966
      const s966 = seg(t, t966, t966 + 0.4, E.outCubic);
      odo966.set(966 * s966);
      const o966 = seg(t, t966 - 0.05, t966 + 0.05) * (1 - seg(t, tPlug - 0.6, tPlug - 0.35));
      st(odo966.root, { opacity: o966.toFixed(2), transform: `translate(-50%,-50%) scale(${(1 + 0.6 * (1 - seg(t, t966, t966 + 0.35, E.outExpo))).toFixed(3)})`, filter: `blur(${(10 * (1 - seg(t, t966, t966 + 0.25))).toFixed(1)}px)` });
      if (t > t966 - 0.1 && t < t966 + 0.5) out.mb = 6;
      // CRT power cut and power up
      if (crtOff > 0 && t < tUp) {
        const sy = crtOff < 0.6 ? lerp(1, 0.004, crtOff / 0.6) : 0.004;
        const sx = crtOff < 0.6 ? 1 : lerp(1, 0.0, (crtOff - 0.6) / 0.4);
        st(ln, { transform: `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`, filter: `brightness(${(1 + 3 * crtOff).toFixed(2)})` });
      } else if (t >= tUp) {
        const sy = crtOn < 0.5 ? 0.004 : lerp(0.004, 1, (crtOn - 0.5) / 0.5);
        const sx = crtOn < 0.5 ? crtOn / 0.5 : 1;
        st(ln, { transform: crtOn < 1 ? `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})` : "", filter: crtOn < 1 ? `brightness(${(1 + 2 * (1 - crtOn)).toFixed(2)})` : "" });
      } else st(ln, { transform: "", filter: "" });
      ln.style.display = dark ? "none" : "";
      if (t > tPlug + 0.25 && t < tPlug + 0.7) out.flash = 0.25 * decay(t, tPlug + 0.62, 10);
      if (t >= tUp && t < tUp + 0.4) out.flash = 0.4 * decay(t, tUp + 0.1, 8);
      if (t > tOut - 0.1 && t < tOut + 1.25) out.mb = 4;
      // fly-out: lanes canvas fades as the real window takes over (scene 4 starts underneath at 43.2)
      st(cvL, { opacity: (1 - seg(t, T("app_in") - 0.05, T("app_in") + 0.2)).toFixed(3) });
    } else st(ln, { transform: "", filter: "", display: "none" });
    t32.update(t);
    sub966.update(t);
    plug.update(t);
    if (t >= tPlug + 0.62) plug.root.style.display = "none";
    // typed checkpoint line
    const ck = T("checkpoint");
    const line = "checkpoint 4,112 MiB  ·  fsync ✓  ·  state saved";
    const nch = Math.floor(seg(t, ck, ck + 0.5) * line.length);
    typed.textContent = t >= ck && t < tUp ? line.slice(0, nch) + (Math.floor(t * 4) % 2 ? "▍" : " ") : "";
    lose.update(t);
    st(safeChip, { opacity: (seg(t, T("txt_losenothing") + 0.4, T("txt_losenothing") + 0.7) * (1 - seg(t, tOut, tOut + 0.3))).toFixed(2) });
    // root background goes transparent at the very end so scene 4 shows through
    root_.style.background = t > T("app_in") - 0.05 ? "transparent" : C.canvas;
    crt.style.display = t < tCmp + 0.05 ? "" : "none";
    out.ca = (out.ca || 0) + (out.mb > 1 ? 2.0 : 0);
    return out;
  },
};
