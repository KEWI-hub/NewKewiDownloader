// 6 · Everything else (88.8 – 108.0 s): beat-cut montage — queues & scheduler, site grabber,
// torrents, light/dark morph, platforms, a feature word-storm, then every lane collapses to a point.
import { h, st, clamp, lerp, seg, E, T, KText, spring, neonLine, glowDot, decay, beatPulse, noise1, rng, spec, ASSET, GRAD_PRISM, C, SPECTRUM, BEAT } from "../lib.js";
import { Win, ambient } from "./common.js";

const U = (p) => `${ASSET.work}/ui/${p}`;
let amb, wSched, wGrab, wTor, wDark, wLight, sweep, cv, cx, texts = [], storm = [], stormSub;
const WORDS = ["HTTP/2", "FTP · FTPS", "HLS & DASH", "BitTorrent", "Magnet links", "8K HDR", "MP3 · FLAC", "Subtitles", "Batch", "Clipboard", "Speed limiter", "Checksums", "Categories", "Mini window", "Tray", "Drop zone"];

export default {
  id: "montage",
  start: 88.8,
  end: 108.05,
  z: 6,
  build(root, ctx) {
    amb = ambient(root);
    wSched = new Win(root, 2160, 1350, { radius: 20 });
    wGrab = new Win(root, 2160, 1350, { radius: 20 });
    wTor = new Win(root, 680, 600, { radius: 14 });
    wDark = new Win(root, 2160, 1350, { radius: 20 });
    wLight = new Win(root, 2160, 1350, { radius: 20 });
    sweep = h("div", "", root, { position: "absolute", top: "-200px", height: "1480px", width: "260px", background: "linear-gradient(90deg, rgba(139,123,255,0) 0%, #8b7bff 20%, #46a8ff 35%, #2ed3a9 50%, #f2c14e 65%, #ff7f8f 80%, rgba(255,127,143,0) 100%)", filter: "blur(18px)", mixBlendMode: "screen", opacity: "0", transform: "rotate(12deg)" });
    cv = h("canvas", "", root);
    cv.width = ctx.W;
    cv.height = ctx.H;
    cx = cv.getContext("2d");
    const L = { x: 150, size: 104, weight: 760, tracking: -0.05, mask: true };
    const k = (txt, o, inT, mode, outT, outMode = "up", extra = {}) => {
      const kt = new KText(root, txt, { ...L, ...o }).anim("in", inT, mode, { stagger: 0.025, ...extra }).anim("out", outT, outMode, { dur: 0.22, stagger: 0.006 });
      texts.push(kt);
      return kt;
    };
    const tS = T("m_sched"), tG = T("m_grab"), tT = T("m_torrent"), tL = T("m_light"), tD = T("m_dark"), tW = T("m_win");
    k("Queues &", { y: 400 }, tS, "rise", tG - 0.18);
    k("scheduler.", { y: 515, gradient: GRAD_PRISM, seed: 3 }, tS + 0.1, "rise", tG - 0.15);
    k("Set it.", { y: 650, size: 46, weight: 600, color: "#c3c6d0", mask: false }, T("m_sched_txt"), "snap", tG - 0.18, "blur", { dur: 0.3 });
    k("Sleep.", { x: 300, y: 650, size: 46, weight: 600, color: "#c3c6d0", mask: false }, T("m_sched_txt") + 0.3, "snap", tG - 0.18, "blur", { dur: 0.3 });
    k("Done.", { x: 462, y: 650, size: 46, weight: 600, color: "#c3c6d0", mask: false }, T("m_sched_txt") + 0.6, "snap", tG - 0.18, "blur", { dur: 0.3 });
    k("Site grabber.", { y: 440 }, tG + 0.05, "slideR", tT - 0.18, "left", { dur: 0.5, stagger: 0.02 });
    k("Crawl a site. Keep what matters.", { y: 545, size: 40, weight: 560, color: "#a3a7b5", tracking: -0.01 }, tG + 0.45, "rise", tT - 0.18, "up", { stagger: 0.006 });
    k("Torrents &", { y: 400 }, tT + 0.05, "split", tL - 0.18, "split", { dur: 0.55, stagger: 0.015 });
    k("magnets.", { y: 515, gradient: GRAD_PRISM, seed: 7 }, tT + 0.15, "split", tL - 0.15, "split", { dur: 0.55, stagger: 0.015 });
    k("Debian DVD torrent → verified in under 40 s", { y: 640, size: 34, weight: 560, color: "#a3a7b5", tracking: -0.01 }, tT + 0.6, "rise", tL - 0.18, "up", { stagger: 0.005 });
    k("Your light.", { x: 150, y: 140, size: 96, color: "#111318", mask: true }, tL + 0.25, "rise", tD - 0.1, "up");
    k("Your dark.", { x: 150, y: 140, size: 96, mask: true, gradient: GRAD_PRISM, seed: 1 }, tD + 0.25, "rise", tW - 0.18, "up");
    // platforms
    const P = { x: 960, size: 190, weight: 800, align: "center", tracking: -0.055, mask: false };
    k("Windows", { ...P, y: 300 }, tW, "snap", T("m_storm") - 0.12, "zoom", { dur: 0.35, stagger: 0.02 });
    k("Linux", { ...P, y: 520 }, T("m_linux"), "split", T("m_storm") - 0.12, "zoom", { dur: 0.4, stagger: 0.02 });
    k("macOS", { ...P, y: 740, gradient: GRAD_PRISM, seed: 21 }, T("m_mac"), "slideR", T("m_storm") - 0.12, "zoom", { dur: 0.4, stagger: 0.02 });
    k("MSI · EXE · DEB · RPM · AppImage · DMG", { x: 960, y: 930, size: 34, weight: 560, color: "#a3a7b5", align: "center", tracking: 0.04, font: "mono", mask: true }, T("m_oneapp"), "rise", T("m_storm") - 0.12, "up", { stagger: 0.008 });
    // word storm
    const modes = ["snap", "zoom", "split", "scramble", "track", "flip", "glitch", "rays"];
    WORDS.forEach((w, i) => {
      const t0 = T("m_storm") + i * 0.3;
      const kt = new KText(root, w, { x: 960, y: 540, size: 150, weight: 800, align: "center", tracking: -0.05, gradient: i % 3 === 2 ? GRAD_PRISM : null, color: "#fff", seed: 30 + i });
      kt.anim("in", t0, modes[i % modes.length], { dur: 0.22, stagger: 0.012, order: "center" }).anim("out", t0 + 0.27, "blur", { dur: 0.06, stagger: 0 });
      storm.push(kt);
    });
    stormSub = h("div", "mono", root, { position: "absolute", left: "960px", top: "700px", transform: "translateX(-50%)", fontSize: "24px", color: "#888da1", letterSpacing: "0.14em", whiteSpace: "nowrap" });
    stormSub.textContent = "AND EVERYTHING ELSE YOU EXPECT";
  },
  update(t, ctx) {
    const out = { bloom: 0.38 };
    const tS = T("m_sched"), tG = T("m_grab"), tT = T("m_torrent"), tL = T("m_light"), tD = T("m_dark"), tW = T("m_win"), tSt = T("m_storm"), tC = T("m_collapse");
    const end = 108.0;
    // whip transitions between cards: each card slides in from the right, out to the left
    const card = (w, t0, t1, src, o = {}) => {
      const a = seg(t, t0 - 0.05, t0 + 0.35, E.outExpo);
      const b = seg(t, t1 - 0.25, t1 + 0.05, E.inExpo);
      const on = t > t0 - 0.06 && t < t1 + 0.06;
      if (!on) { w.pose({ cx: 0, cy: 0, o: 0 }); return; }
      w.src(src);
      const drift = (t - t0) * 12;
      w.pose({ cx: (o.cx ?? 1300) + (1 - a) * 1300 - b * 1800 - drift, cy: (o.cy ?? 560) + (o.fromBottom ? (1 - a) * 900 : 0), s: o.s ?? 0.56, ry: (o.ry ?? -16) + (1 - a) * -25 + b * 30, rx: o.rx ?? 3, rz: o.rz ?? 0, o: 1, sheen: seg(t, t0 + 0.2, t0 + 1.4), blur: 0 });
    };
    card(wSched, tS, tG, U("scheduler_dark/still.png"), { fromBottom: true });
    card(wGrab, tG, tT, U("grabber_dark/still.png"));
    card(wTor, tT, tL, U("torrent_crop.png"), { s: 1.12, cx: 1280, ry: -12 });
    if ((t > tS - 0.05 && t < tS + 0.35) || (t > tG - 0.25 && t < tG + 0.35) || (t > tT - 0.25 && t < tT + 0.35) || (t > tL - 0.25 && t < tL + 0.2)) out.mb = 6;
    // theme morph: dark window, spectral sweep reveals the light theme, then back
    const thOn = t > tL - 0.1 && t < tW + 0.05;
    if (thOn) {
      const a = seg(t, tL - 0.05, tL + 0.3, E.outExpo);
      const b = seg(t, tW - 0.3, tW, E.inExpo);
      const pose = { cx: 1010 + (1 - a) * 1300, cy: 600 + b * 200, s: 0.62 * (1 - 0.3 * b), ry: -10 + (1 - a) * -25, rx: 4 + b * 30, o: 1 - b, sheen: -1 };
      wDark.src(U("accent_prism/still.png"));
      wLight.src(U("main_light/still.png"));
      wDark.pose(pose);
      wLight.pose(pose);
      const s1 = seg(t, tL + 0.15, tL + 0.75, E.inOutCubic), s2 = seg(t, tD + 0.05, tD + 0.65, E.inOutCubic);
      const r = s2 > 0 ? 1 - s2 : s1;
      st(wLight.root, { clipPath: `inset(-2% ${((1 - r) * 100).toFixed(2)}% -2% -2%)` });
      const x = 340 + r * 1339;
      st(sweep, { opacity: ((s1 > 0 && s1 < 1) || (s2 > 0 && s2 < 1) ? 0.85 : 0).toFixed(2), left: (x - 130).toFixed(1) + "px" });
      // background lightens while light theme is showing
      const lit = s1 * (1 - s2);
      st(amb.root, { background: `rgb(${Math.round(lerp(7, 222, lit))},${Math.round(lerp(8, 225, lit))},${Math.round(lerp(11, 233, lit))})` });
      st(amb.pools, { opacity: (1 - 0.6 * lit).toFixed(2) });
    } else {
      wDark.pose({ cx: 0, cy: 0, o: 0 });
      wLight.pose({ cx: 0, cy: 0, o: 0 });
      st(sweep, { opacity: "0" });
      st(amb.root, { background: C.canvas });
    }
    for (const kt of texts) kt.update(t);
    // ---- storm + collapse canvas
    cx.clearRect(0, 0, ctx.W, ctx.H);
    if (t > tW - 0.2) {
      // background lanes: flash per platform beat / storm word
      const idx = Math.floor((t - tSt) / 0.3);
      const flash = t >= tSt && t < tC ? decay(t, tSt + idx * 0.3, 10) : beatPulse(t, tW) * 0.6;
      const col = t >= tSt ? spec(idx) : "#8b7bff";
      const col2 = (k) => (t >= tSt ? spec(idx + k) : spec(k));
      const coll = seg(t, tC, end - 0.05, E.inExpo);
      for (let k = 0; k < 16; k++) {
        const y = 90 + k * 60;
        const yy = lerp(y, 540, coll);
        const half = (lerp(980, 0, coll) + 0);
        const fromLeft = k % 2 === 0;
        const pr = (0.3 + 0.7 * ((k * 0.37 + t * (0.5 + (k % 5) * 0.1)) % 1));
        const x0 = fromLeft ? 960 - half - 200 * (1 - coll) : 960 + half + 200 * (1 - coll);
        const x1 = fromLeft ? lerp(x0, 960, pr * (1 - coll) + coll) : lerp(x0, 960, pr * (1 - coll) + coll);
        neonLine(cx, [[x0, yy], [x1, yy]], col2(k), { width: 2 + coll * 2, glow: 10 + 20 * coll, alpha: (0.18 + 0.5 * flash) * (t < tSt ? 0.6 : 1) + seg(t, tC - 0.2, tC + 0.3) * 0.5 + coll * 0.6, core: coll > 0.2 ? "rgba(255,255,255,0.8)" : null });
      }
      if (coll > 0) glowDot(cx, 960, 540, 100 + 500 * coll, "rgba(220,220,255,0.9)", coll);
      out.flash = Math.max(out.flash || 0, seg(t, end - 0.25, end, E.inQuad) * 0.9);
      if (coll > 0.3) out.ca = 5 * coll;
    }
    for (const kt of storm) kt.update(t);
    st(stormSub, { opacity: (seg(t, tSt + 0.1, tSt + 0.3) * (1 - seg(t, tC - 0.2, tC))).toFixed(2) });
    if (t > tSt && t < tC) out.ca = (out.ca || 0) + 1.5 * decay(t, tSt + Math.floor((t - tSt) / 0.3) * 0.3, 14);
    return out;
  },
};
