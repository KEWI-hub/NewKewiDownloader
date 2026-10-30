// 2 · The problem (11.4 – 21.0 s): the cold open shatters; one lonely, slow connection.
import { h, st, clamp, lerp, seg, E, T, KText, Shatter, neonLine, beatPulse, decay, noise1, ASSET, mixHex } from "../lib.js";

let sh, cv, c2, a1, a2, b1, b2, b3, b4, stats, layer, fname, pct, rate, eta;
const Y = 540;

export default {
  id: "problem",
  start: 11.4,
  end: 21.0,
  z: 3,
  snaps: [{ id: "co_end", t: 11.39 }],
  build(root, ctx) {
    root.style.background = "#060608";
    layer = h("div", "layer", root, { transformOrigin: "0px 540px" });
    cv = h("canvas", "", layer);
    cv.width = ctx.W;
    cv.height = ctx.H;
    c2 = cv.getContext("2d");
    const grey = "#9a9eac";
    a1 = new KText(layer, "Most downloads", { x: 160, y: 300, size: 84, weight: 560, color: "#80859a", mask: true, tracking: -0.03 });
    a2 = new KText(layer, "crawl.", { x: 152, y: 420, size: 168, weight: 800, color: "#c3c6d0", tracking: -0.05 });
    a1.anim("in", T("txt_most"), "rise", { dur: 0.7, stagger: 0.03 }).anim("out", T("slow_start") - 0.1, "up", { dur: 0.35, stagger: 0.01 });
    a2.anim("in", T("txt_crawl"), "crawl", { dur: 0.7, stagger: 0.16 }).anim("out", T("slow_start") - 0.05, "up", { dur: 0.4, stagger: 0.015 });
    const big = { x: 160, y: 330, size: 120, weight: 720, color: "#d6d8e0", mask: true, tracking: -0.045 };
    b1 = new KText(layer, "One connection.", big).anim("in", T("txt_oneconn"), "rise", { stagger: 0.025 }).anim("out", T("txt_onelane") - 0.12, "up", { dur: 0.3, stagger: 0.01 });
    b2 = new KText(layer, "One lane.", big).anim("in", T("txt_onelane"), "rise", { stagger: 0.03 }).anim("out", T("txt_waiting") - 0.12, "up", { dur: 0.3, stagger: 0.01 });
    b3 = new KText(layer, "Waiting…", { ...big, color: "#9a9eac" }).anim("in", T("txt_waiting"), "crawl", { dur: 0.6, stagger: 0.1 }).anim("out", T("riser1") + 0.5, "fade", { dur: 0.6, stagger: 0 });
    b4 = new KText(root, "Let it split.", { x: 960, y: 330, size: 128, weight: 760, color: "#ffffff", align: "center", tracking: -0.045, glow: "0 0 40px rgba(160,160,255,0.45)" });
    b4.anim("in", T("txt_split"), "glitch", { dur: 0.45, stagger: 0.02 }).anim("out", T("bridge_in") - 0.12, "blur", { dur: 0.12, stagger: 0 });
    stats = h("div", "layer", layer, { fontFamily: "JetBrains Mono, monospace", fontSize: "26px", color: grey });
    fname = h("div", "", stats, { position: "absolute", left: "160px", top: "580px" });
    fname.textContent = "ubuntu-26.04-desktop-amd64.iso · 1 GiB";
    rate = h("div", "", stats, { position: "absolute", right: "160px", top: "580px", textAlign: "right" });
    pct = h("div", "", stats, { position: "absolute", left: "160px", top: "470px", fontSize: "30px", color: "#c3c6d0" });
    eta = h("div", "", stats, { position: "absolute", right: "160px", top: "470px", textAlign: "right", fontSize: "30px", color: "#c3c6d0" });
    sh = new Shatter(root, ctx.W, ctx.H, { origin: [520, 470], cols: 10, rows: 6, seed: 4, dur: 0.85 });
  },
  update(t, ctx) {
    const W = ctx.W;
    c2.clearRect(0, 0, W, ctx.H);
    const t0 = T("line_draw");
    const slow = T("slow_start");
    const riser = T("riser1");
    const br = T("bridge_in");
    // the lonely line: draws in, crawls, then charges up and retracts into the beam
    const draw = seg(t, t0, t0 + 0.7, E.inOutCubic);
    const retract = seg(t, br - 0.22, br - 0.02, E.inExpo);
    const charge = seg(t, riser, br - 0.25, E.inQuad);
    const x1 = W * draw * (1 - retract) + 2;
    const jit = charge * charge * 3;
    const yy = Y + noise1(t * 40, 3) * jit;
    if (draw > 0) {
      const col = mixHex("#3a3d48", "#ffffff", charge);
      neonLine(c2, [[0, yy], [x1, yy]], col, { width: 2 + charge * 3, glow: 6 + charge * 26, alpha: 0.7 + 0.3 * charge, core: charge > 0.3 ? "rgba(255,255,255,0.9)" : null });
      // crawling progress fill
      const fill = Math.max(0, (t - slow) * 15) * (1 - retract);
      if (fill > 0) {
        neonLine(c2, [[0, yy], [fill, yy]], mixHex("#8a8fa0", "#ffffff", charge), { width: 6, glow: 10, alpha: 0.9, core: null });
        const pulse = beatPulse(t, slow);
        c2.fillStyle = `rgba(230,232,240,${0.5 + 0.5 * pulse})`;
        c2.beginPath();
        c2.arc(fill, yy, 5 + pulse * 3, 0, Math.PI * 2);
        c2.fill();
      }
      // drawing head
      if (draw < 1) {
        c2.fillStyle = "#fff";
        c2.beginPath();
        c2.arc(x1, yy, 4, 0, Math.PI * 2);
        c2.fill();
      }
    }
    // stats
    const so = seg(t, slow, slow + 0.5) * (1 - seg(t, riser + 0.6, riser + 1.2));
    stats.style.opacity = so.toFixed(3);
    if (so > 0) {
      const el = Math.max(0, t - slow);
      const got = el * 4.0; // MiB at 4.0 MiB/s
      pct.textContent = `${((got / 1024) * 100).toFixed(1)} %`;
      const left = Math.max(0, 256 - el);
      eta.textContent = `ETA ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
      rate.textContent = `1 connection · ${(4.0 + noise1(t * 3, 1) * 0.15).toFixed(1)} MiB/s`;
      st(stats, { filter: `brightness(${1 + 0.25 * beatPulse(t, slow)})` });
    }
    a1.update(t);
    a2.update(t);
    b1.update(t);
    b2.update(t);
    b3.update(t);
    b4.update(t);
    // slow push toward the left end while the riser builds
    const z = 1 + 0.14 * seg(t, riser, br, E.inCubic);
    st(layer, { transform: `scale(${z.toFixed(4)})` });
    // shatter of the cold open on top
    if (!ctx.snapMode && t < T("shatter1") + 1.5) sh.setImage(`${ASSET.work}/snap/co_end.jpg`);
    sh.update(ctx.snapMode ? -1 : t - T("shatter1"));
    const out = {};
    if (t < T("shatter1") + 0.5) out.mb = 4;
    out.ca = 2.5 * decay(t, T("txt_split"), 5) + charge * 1.5;
    return out;
  },
};
