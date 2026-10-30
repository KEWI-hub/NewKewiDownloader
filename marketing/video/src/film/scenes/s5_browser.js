// 5 · Browser + video (66.6 – 88.8 s): app shatters into a (generic, logo-free) browser; a click
// opens Prism in 257 ms; a video page gets the floating "Download video" pill + quality menu;
// "Thousands of sites"; spectral rays bend into a download arrow that dives into the montage.
import { h, st, clamp, lerp, seg, E, T, KText, Odo, Shatter, spring, neonLine, glowDot, drawSparks, decay, beatPulse, noise1, rng, spec, ASSET, GRAD_PRISM, C, setSrc, SPECTRUM } from "../lib.js";
import { Win, ambient, cursor } from "./common.js";

const U = (p) => `${ASSET.work}/ui/${p}`;
let amb, sh, scene, bro, page1, page2, player, playerImg, pill, menu, menuItems = [], toast, cur, dlg, vdlg, cv, cx, wall, tiles = [];
let tClick, t257, t257sub, odo257, tAny, t8k, tSound, tSites, tEvery;
const BW = 1440, BH = 860; // browser size (px, before scale)

function browser(parent) {
  const b = h("div", "", parent, { position: "absolute", left: "0", top: "0", width: BW + "px", height: BH + "px", borderRadius: "16px", overflow: "hidden", background: "#1d1e25", boxShadow: "0 50px 140px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)", transformOrigin: "50% 50%" });
  const bar = h("div", "", b, { position: "absolute", left: "0", top: "0", right: "0", height: "92px", background: "#24252d", borderBottom: "1px solid rgba(255,255,255,0.06)" });
  // traffic-light-neutral window controls + tabs (no browser branding)
  const tab = (x, w, txt, active, dot) => {
    const tb = h("div", "", bar, { position: "absolute", left: x + "px", top: "8px", width: w + "px", height: "36px", borderRadius: "10px 10px 0 0", background: active ? "#1d1e25" : "transparent", color: active ? "#e6e7ee" : "#8a8fa0", fontSize: "15px", display: "flex", alignItems: "center", gap: "10px", padding: "0 14px", whiteSpace: "nowrap", overflow: "hidden" });
    tb.innerHTML = `<span style="width:14px;height:14px;border-radius:4px;background:${dot};flex:none"></span>${txt}`;
    return tb;
  };
  tab(16, 280, "Index of /debian-cd/current/…", true, "#5a6072");
  tab(300, 240, "New tab", false, "#3a3d48");
  const addr = h("div", "", bar, { position: "absolute", left: "120px", right: "120px", top: "50px", height: "34px", borderRadius: "17px", background: "#15161b", color: "#c9ccd6", fontSize: "16px", display: "flex", alignItems: "center", padding: "0 18px", gap: "10px", fontFamily: "InterVariable" });
  const nav = h("div", "", bar, { position: "absolute", left: "18px", top: "56px", color: "#6d7284", fontSize: "18px", letterSpacing: "14px" });
  nav.textContent = "‹ › ↻";
  const ctrls = h("div", "", bar, { position: "absolute", right: "16px", top: "16px", color: "#6d7284", fontSize: "16px", letterSpacing: "18px" });
  ctrls.textContent = "–□×";
  const content = h("div", "", b, { position: "absolute", left: "0", top: "92px", right: "0", bottom: "0", overflow: "hidden" });
  return { b, addr, content };
}

export default {
  id: "browser",
  start: 66.6,
  end: 88.8,
  z: 5,
  snaps: [{ id: "app_end", t: 66.58 }],
  build(root, ctx) {
    amb = ambient(root, { pools: "radial-gradient(50% 55% at 80% 15%, rgba(100,97,242,0.28) 0%, transparent 70%), radial-gradient(45% 50% at 10% 90%, rgba(47,203,230,0.14) 0%, transparent 70%)" });
    scene = h("div", "layer", root, { perspective: "2400px" });
    wall = h("div", "layer", root, { perspective: "1200px" });
    const R = rng(12);
    const glyphs = ["▶", "♪", "◉", "✦", "▣", "◆", "●", "▲", "♫", "⬤"];
    for (let i = 0; i < 70; i++) {
      const d = h("div", "", wall, { position: "absolute", left: "0", top: "0", width: "180px", height: "120px", borderRadius: "22px", background: `linear-gradient(135deg, ${spec(i)}33, rgba(20,21,28,0.85))`, border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "44px", color: spec(i + 3), boxShadow: "0 20px 50px rgba(0,0,0,0.5)" });
      d.textContent = glyphs[i % glyphs.length];
      tiles.push({ d, x: (R() - 0.5) * 3600, y: (R() - 0.5) * 1900, z: -R() * 3000, r: R() });
    }
    bro = browser(scene);
    bro.addr.innerHTML = `<span style="color:#6d7284">🔒︎</span>&nbsp;https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/`;
    // page 1: plain directory listing
    page1 = h("div", "layer", bro.content, { background: "#fbfbfd", color: "#111318", padding: "40px 64px", fontFamily: "InterVariable" });
    page1.innerHTML = `<div style="font-size:34px;font-weight:700;letter-spacing:-0.02em;margin-bottom:22px">Index of /debian-cd/current/amd64/iso-dvd/</div>
      <div style="font-family:'JetBrains Mono';font-size:19px;line-height:2.15">
      <div style="color:#5e6373;border-bottom:1px solid #e3e5ea;margin-bottom:6px">Name<span style="position:absolute;left:900px">Last modified</span><span style="position:absolute;left:1180px">Size</span></div>
      ${[["Parent Directory", "", "-"], ["SHA256SUMS", "2026-09-06 10:12", "1.1K"], ["SHA256SUMS.sign", "2026-09-06 10:12", "833"], ["debian-13.1.0-amd64-DVD-1.iso", "2026-09-06 10:09", "3.7G"], ["debian-13.1.0-amd64-DVD-2.iso", "2026-09-06 10:09", "4.4G"], ["debian-13.1.0-amd64-DVD-3.iso", "2026-09-06 10:10", "4.4G"], ["debian-update-13.1.0-amd64-DVD-1.iso", "2026-09-06 10:11", "4.2G"]].map(([n, d, s], i) => `<div id="row${i}" style="position:relative"><span style="color:#2a5bd7;text-decoration:underline;text-underline-offset:4px">${n}</span><span style="position:absolute;left:836px;color:#5e6373">${d}</span><span style="position:absolute;left:1116px;color:#5e6373">${s}</span></div>`).join("")}
      </div>`;
    // page 2: video page (dark), player shows our own prism film
    page2 = h("div", "layer", bro.content, { background: "#0f1014", color: "#e6e7ee", fontFamily: "InterVariable" });
    player = h("div", "", page2, { position: "absolute", left: "64px", top: "28px", width: "1040px", height: "585px", borderRadius: "14px", overflow: "hidden", background: "#000" });
    playerImg = h("img", "", player, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover" });
    const scrub = h("div", "", player, { position: "absolute", left: "0", right: "0", bottom: "0", height: "70px", background: "linear-gradient(0deg, rgba(0,0,0,0.7), transparent)" });
    h("div", "", scrub, { position: "absolute", left: "20px", right: "20px", bottom: "22px", height: "5px", borderRadius: "3px", background: "rgba(255,255,255,0.25)" });
    this.prog = h("div", "", scrub, { position: "absolute", left: "20px", bottom: "22px", height: "5px", borderRadius: "3px", background: "#ff7f8f", width: "30%" });
    const meta = h("div", "", page2, { position: "absolute", left: "64px", top: "636px", width: "1040px" });
    meta.innerHTML = `<div style="font-size:28px;font-weight:700;letter-spacing:-0.02em">One beam. Many rays. — Prism launch film (4K HDR)</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:18px;color:#a3a7b5;font-size:18px"><span style="width:44px;height:44px;border-radius:50%;background:${GRAD_PRISM}"></span><span><b style="color:#e6e7ee">Prism Studio</b><br>2.4M views · 2 days ago</span></div>`;
    const side = h("div", "", page2, { position: "absolute", left: "1140px", top: "28px", width: "240px" });
    side.innerHTML = Array.from({ length: 5 }, (_, i) => `<div style="height:120px;border-radius:12px;margin-bottom:18px;background:linear-gradient(135deg, ${spec(i * 2)}55, #1b1c22)"></div>`).join("");
    // floating in-page pill (design: dialogs.html)
    pill = h("div", "", page2, { position: "absolute", left: "818px", top: "48px", height: "48px", padding: "0 20px 0 16px", borderRadius: "24px", display: "flex", alignItems: "center", gap: "10px", fontSize: "19px", fontWeight: "650", color: "#fff", background: "rgba(22,22,32,0.62)", border: "1px solid rgba(255,255,255,0.2)", backdropFilter: "blur(16px) saturate(1.5)", boxShadow: "0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.18)", transformOrigin: "100% 50%" });
    pill.innerHTML = `<svg width="22" height="22" viewBox="0 0 64 64"><path d="M24.4 9.6a3 3 0 0 1 5.2 0l20.3 37.3a3 3 0 0 1-2.6 4.4H6.7a3 3 0 0 1-2.6-4.4z" fill="rgba(160,158,255,.5)" stroke="#c9c8ff" stroke-width="4"/><path d="M41 31.5L61 16M42 34L62 34M42 36.6L61 51.5" stroke="#8b7bff" stroke-width="5" stroke-linecap="round"/></svg>Download video<span style="opacity:.6;margin-left:4px">▾</span>`;
    menu = h("div", "", page2, { position: "absolute", left: "700px", top: "106px", width: "386px", padding: "8px", borderRadius: "16px", background: "rgba(24,25,33,0.82)", border: "1px solid rgba(255,255,255,0.14)", backdropFilter: "blur(22px) saturate(1.5)", boxShadow: "0 30px 80px rgba(0,0,0,0.6)", transformOrigin: "80% 0%" });
    const items = [["4320p · 8K", "HDR", "MP4"], ["2160p · 4K", "HDR", "MP4"], ["1440p60", "", "MP4"], ["1080p60", "", "MP4"], ["720p", "", "MP4"], null, ["Audio only", "", "MP3 · 320k"]];
    for (const it of items) {
      if (!it) { h("div", "", menu, { height: "1px", background: "rgba(255,255,255,0.1)", margin: "6px 10px" }); menuItems.push(null); continue; }
      const r = h("div", "", menu, { height: "46px", borderRadius: "10px", display: "flex", alignItems: "center", padding: "0 14px", fontSize: "19px", fontWeight: "600", gap: "10px", color: "#e6e7ee" });
      r.innerHTML = `<span>${it[0]}</span>${it[1] ? `<span style="font-size:13px;font-weight:700;padding:3px 7px;border-radius:6px;background:rgba(142,140,255,0.2);color:#b9b7ff">${it[1]}</span>` : ""}<span style="margin-left:auto;font-family:'JetBrains Mono';font-size:15px;color:#888da1">${it[2]}</span>`;
      menuItems.push(r);
    }
    toast = h("div", "chip", scene, { left: "0", top: "0", fontSize: "20px", opacity: "0" });
    toast.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:${C.accent};box-shadow:0 0 10px ${C.accent}"></span>Downloading · 16 connections · 61.8 MiB/s`;
    dlg = new Win(root, 1200, 880, { radius: 26 });
    vdlg = new Win(root, 1360, 1280, { radius: 26 });
    cv = h("canvas", "", root);
    cv.width = ctx.W;
    cv.height = ctx.H;
    cx = cv.getContext("2d");
    cur = cursor(root);
    tClick = new KText(root, "Click any link.", { x: 960, y: 80, size: 72, weight: 720, align: "center", tracking: -0.04, mask: true }).anim("in", T("txt_clickany"), "rise", { stagger: 0.025 }).anim("out", T("txt_257") - 0.2, "up", { dur: 0.25, stagger: 0.01 });
    odo257 = new Odo(root, { x: 150, y: 170, size: 150, weight: 800, digits: 3, decimals: 0, suffix: "ms", align: "left", suffixSize: 0.4, gradient: GRAD_PRISM });
    odo257.root.style.opacity = "0";
    t257sub = new KText(root, "from a browser click to Prism", { x: 154, y: 270, size: 34, weight: 560, color: "#a3a7b5", mask: true, tracking: -0.01 }).anim("in", T("txt_257") + 0.3, "rise", { stagger: 0.008 }).anim("out", T("video_in") - 0.3, "up", { dur: 0.25, stagger: 0.003 });
    tAny = new KText(root, "Any video.", { x: 150, y: 140, size: 120, weight: 760, tracking: -0.05, mask: true }).anim("in", T("txt_anyvideo"), "rise", { stagger: 0.04 }).anim("out", T("txt_8k") - 0.15, "up", { dur: 0.25, stagger: 0.01 });
    t8k = new KText(root, "Up to 8K HDR.", { x: 150, y: 140, size: 120, weight: 760, tracking: -0.05, mask: true, gradient: GRAD_PRISM, seed: 9 }).anim("in", T("txt_8k"), "rise", { stagger: 0.03 }).anim("out", T("txt_sound") - 0.15, "up", { dur: 0.25, stagger: 0.01 });
    tSound = new KText(root, "Or just the sound.", { x: 150, y: 140, size: 120, weight: 760, tracking: -0.05, mask: true }).anim("in", T("txt_sound"), "rise", { stagger: 0.025 }).anim("out", T("txt_sites") - 0.3, "up", { dur: 0.25, stagger: 0.01 });
    tSites = new KText(root, "Thousands of sites.", { x: 960, y: 540, size: 140, weight: 780, align: "center", tracking: -0.05 }).anim("in", T("txt_sites"), "zoom", { dur: 0.6, stagger: 0.02, order: "center" }).anim("out", T("arrow_form") - 0.1, "zoom", { dur: 0.3, stagger: 0.01 });
    tEvery = new KText(root, "Download everything.", { x: 960, y: 930, size: 104, weight: 780, align: "center", tracking: -0.05, gradient: GRAD_PRISM, seed: 14 }).anim("in", T("arrow_slam"), "snap", { dur: 0.45, stagger: 0.02, order: "center" }).anim("out", T("arrow_dive") + 0.3, "down", { dur: 0.4, stagger: 0.01 });
    sh = new Shatter(root, ctx.W, ctx.H, { origin: [960, 540], cols: 11, rows: 7, seed: 9, dur: 0.8 });
  },
  update(t, ctx) {
    const out = { bloom: 0.38 };
    const t0 = T("browser_in");
    const tcl = T("click_link");
    const tvi = T("video_in");
    const tpi = T("pill_in");
    const tcp = T("click_pill");
    const tmp3 = T("pick_mp3");
    const tcm = T("click_mp3");
    const tsi = T("txt_sites");
    const taf = T("arrow_form");
    const tas = T("arrow_slam");
    const tad = T("arrow_dive");
    // ---- browser pose
    const bin = spring(t - t0 + 0.6, 1.1, 0.7);
    const dim = seg(t, tcl + 0.15, tcl + 0.5) * (1 - seg(t, T("click_start2") + 0.2, T("click_start2") + 0.7)) + seg(t, tcm + 0.1, tcm + 0.4);
    const away = seg(t, tsi - 0.4, tsi + 0.3, E.inCubic);
    const s = 0.86 * (1 - 0.08 * dim);
    st(bro.b, { transform: `translate(${960 - BW / 2}px, ${590 - BH / 2 + (1 - bin) * 500 + away * 120}px) rotateX(${((1 - bin) * 30 + 6 * dim + away * 30).toFixed(2)}deg) rotateY(${(noise1(t * 0.2, 1) * 2).toFixed(2)}deg) translateZ(${(-dim * 200 - away * 1600).toFixed(1)}px) scale(${s.toFixed(4)})`, filter: `brightness(${(1 - 0.45 * clamp(dim)).toFixed(3)}) blur(${(clamp(dim) * 2 + away * 6).toFixed(1)}px)`, opacity: (clamp(bin * 1.4) * (1 - away)).toFixed(3), display: t > tsi + 0.4 ? "none" : "" });
    // page switch at video_in
    const sw = seg(t, tvi - 0.15, tvi + 0.35, E.inOutQuart);
    st(page1, { transform: `translateX(${(-sw * 100).toFixed(2)}%)` });
    st(page2, { transform: `translateX(${((1 - sw) * 100).toFixed(2)}%)` });
    bro.addr.innerHTML = t < tvi ? `<span style="color:#6d7284">⌂</span>&nbsp;https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/` : `<span style="color:#6d7284">⌂</span>&nbsp;https://video.example.com/watch?v=prism-launch`;
    // hover/click highlight on the ISO row
    const row = page1.querySelector("#row3");
    if (row) row.style.background = t > tcl - 0.5 && t < tcl + 1 ? "rgba(42,91,215,0.10)" : "transparent";
    // player content: our own film (cold-open plates) playing
    if (t > tvi - 0.5) {
      const ft = 4.6 + ((t - tvi + 0.5) % 6.5);
      setSrc(playerImg, `${ASSET.work}/bl/coldopen/${String(Math.round(ft * 60)).padStart(4, "0")}.png`);
      this.prog.style.width = `${(30 + (t - tvi) * 1.2).toFixed(2)}%`;
    }
    // pill + menu
    const pp = spring(t - tpi, 2.2, 0.5);
    st(pill, { opacity: t > tpi ? clamp(pp * 1.5).toFixed(3) : "0", transform: `translateY(${((1 - pp) * -20).toFixed(1)}px) scale(${(0.85 + 0.15 * pp - (t > tcp && t < tcp + 0.1 ? 0.05 : 0)).toFixed(3)})` });
    const mo = seg(t, tcp + 0.05, tcp + 0.3, E.outCubic) * (1 - seg(t, tcm + 0.05, tcm + 0.25));
    st(menu, { opacity: mo.toFixed(3), transform: `scale(${(0.92 + 0.08 * mo).toFixed(3)}) translateY(${((1 - mo) * -10).toFixed(1)}px)` });
    menuItems.forEach((it, i) => {
      if (!it) return;
      const a = seg(t, tcp + 0.08 + i * 0.045, tcp + 0.35 + i * 0.045, E.outCubic);
      const hl = (i === 0 && t > T("txt_8k") && t < tmp3) || (i === 6 && t >= tmp3);
      st(it, { opacity: a.toFixed(3), transform: `translateX(${((1 - a) * 18).toFixed(1)}px)`, background: hl ? "rgba(142,140,255,0.22)" : "transparent" });
    });
    // ---- cursor choreography (browser coords → screen; browser at 0.86 scale, centred 960,590)
    const B2S = (x, y) => [960 + (x - BW / 2) * 0.86, 590 + (y - BH / 2) * 0.86];
    const pts = [
      [t0 + 1.8, B2S(1100, 700)], [tcl - 0.05, B2S(300, 92 + 40 + 34 + 22 + 41 * 3 + 30)],
      [tcl + 0.6, B2S(300, 300)],
      [T("click_start2") - 0.05, [960 + (1032 - 600) * 0.62, 560 + (826 - 440) * 0.62]],
      [tvi + 0.4, [1300, 700]], [tcp - 0.05, B2S(1010, 92 + 72)], [tmp3 - 0.1, B2S(1010, 92 + 72)], [tmp3 + 0.4, B2S(900, 92 + 106 + 8 + 46 * 5 + 13 + 23)], [tcm + 0.6, B2S(900, 92 + 106 + 8 + 46 * 5 + 13 + 23)],
    ];
    let cp = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ta, A] = pts[i], [tb, B] = pts[i + 1];
      if (t >= ta && t <= tb) {
        const k = E.inOutCubic(seg(t, ta, tb));
        cp = [lerp(A[0], B[0], k) + Math.sin(k * Math.PI) * 30, lerp(A[1], B[1], k) - Math.sin(k * Math.PI) * 40];
      }
    }
    cur.show(!!cp && t < tsi - 0.5);
    if (cp) {
      const clicks = [tcl, T("click_start2"), tcp, tcm];
      let cd = -1, press = 0;
      for (const c of clicks) if (t >= c && t < c + 0.5) { cd = t - c; press = t < c + 0.1 ? 1 : 0; }
      cur.at(cp[0], cp[1], press, cd);
    }
    // ---- Prism capture dialog pops out of the browser at the click
    const dt = t - (tcl + 0.18);
    const dsp = spring(dt, 2.2, 0.5);
    const shrink = seg(t, T("click_start2") + 0.1, T("click_start2") + 0.6, E.inCubic);
    const [cxk, cyk] = B2S(300, 300);
    dlg.src(U(`capture_dark/f_${String(clamp(Math.round(dt * 60), 0, 299)).padStart(4, "0")}.png`));
    dlg.pose({ cx: lerp(lerp(cxk, 960, clamp(dsp)), 1520, shrink), cy: lerp(lerp(cyk, 560, clamp(dsp)), 980, shrink), s: lerp(0.08, 0.62, dsp) * (1 - 0.9 * shrink), z: (1 - clamp(dsp)) * -300, rx: (1 - clamp(dsp)) * 20, o: dt > 0 ? clamp(dsp * 2) * (1 - seg(t, T("click_start2") + 0.45, T("click_start2") + 0.6)) : 0 });
    const ta2 = seg(t, T("click_start2") + 0.45, T("click_start2") + 0.75, E.outBack) * (1 - seg(t, tvi - 0.3, tvi));
    st(toast, { opacity: ta2.toFixed(2), transform: `translate(${(1130 + (1 - ta2) * 60).toFixed(1)}px, 940px)` });
    tClick.update(t);
    const k257 = seg(t, T("txt_257"), T("txt_257") + 0.35, E.outCubic);
    odo257.set(257 * k257);
    st(odo257.root, { opacity: (seg(t, T("txt_257") - 0.05, T("txt_257") + 0.05) * (1 - seg(t, tvi - 0.3, tvi))).toFixed(2), transform: `translate(0,-50%) scale(${(1 + 0.4 * (1 - seg(t, T("txt_257"), T("txt_257") + 0.3, E.outExpo))).toFixed(3)})` });
    t257sub.update(t);
    tAny.update(t);
    t8k.update(t);
    tSound.update(t);
    // ---- real Download video dialog
    const vdt = t - (tcm + 0.12);
    const vsp = spring(vdt, 2.0, 0.5);
    vdlg.src(U("video_dark/f_0359.png"));
    vdlg.pose({ cx: 1180, cy: 560, s: 0.58 * (0.85 + 0.15 * vsp), o: vdt > 0 ? clamp(vsp * 1.5) * (1 - away) : 0, rx: (1 - vsp) * 12, z: -away * 900 });
    // ---- "Thousands of sites": tiles fly through
    const wk = seg(t, tsi - 0.3, taf + 0.2);
    wall.style.display = wk > 0 && wk < 1 ? "" : "none";
    if (wk > 0 && wk < 1) {
      for (const tl of tiles) {
        const z = tl.z + (t - tsi + 0.3) * 1700;
        const zz = ((z + 3000) % 3600) - 3000;
        const o = clamp((zz + 3000) / 800) * clamp((600 - zz) / 400) * (1 - seg(t, taf - 0.3, taf));
        st(tl.d, { transform: `translate3d(${(960 + tl.x - 90).toFixed(1)}px, ${(540 + tl.y - 60).toFixed(1)}px, ${zz.toFixed(1)}px) rotateY(${(tl.r * 40 - 20).toFixed(1)}deg)`, opacity: o.toFixed(3) });
      }
    }
    tSites.update(t);
    // ---- rays bend into a download arrow
    cx.clearRect(0, 0, ctx.W, ctx.H);
    const dive = seg(t, tad, tad + 1.2, E.inExpo);
    const slam = decay(t, tas, 9);
    if (t > taf - 0.1) {
      const tip = [960, 800 + dive * 900];
      const scale = 1 + 0.08 * slam + 0.03 * beatPulse(t, tas);
      cx.save();
      cx.translate(960, 560 + dive * 900);
      cx.scale(scale, scale);
      cx.translate(-960, -560 - dive * 900);
      for (let k = 0; k < 8; k++) {
        // concentric bend: horizontal ribbon from the left turns down into the shaft,
        // then the rays spread to the arrow-head's top edge and converge on the tip
        const D = dive * 900;
        const Rk = 220 + (k - 3.5) * 13;
        const Cx = 740, Cy = 470 + D;
        const pts = [[-200, Cy - Rk]];
        for (let i = 0; i <= 18; i++) {
          const a = (i / 18) * (Math.PI / 2);
          pts.push([Cx + Math.sin(a) * Rk, Cy - Math.cos(a) * Rk]);
        }
        pts.push([Cx + Rk, 600 + D]);
        pts.push([960 + (k - 3.5) * 44, 640 + D]);
        pts.push([960, 800 + D]);
        // reveal by length
        const p = seg(t, taf + k * 0.05, taf + 0.85 + k * 0.05, E.inOutCubic);
        const total = pts.reduce((acc, q, i) => (i ? acc + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
        let want = total * p, acc = 0;
        const vis = [pts[0]];
        for (let i = 1; i < pts.length && want > 0; i++) {
          const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          if (acc + L <= want) { vis.push(pts[i]); acc += L; }
          else { const f = (want - acc) / L; vis.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]); break; }
        }
        neonLine(cx, vis, SPECTRUM[(k + 0) % 8], { width: 5, glow: 22 + 20 * slam, alpha: 1, core: "rgba(255,255,255,0.7)" });
        if (p < 1 && p > 0) glowDot(cx, vis[vis.length - 1][0], vis[vis.length - 1][1], 34, "#ffffff", 0.9);
      }
      // tray: a spectral file-map bar under the arrow
      const tr = seg(t, taf + 0.6, taf + 1.1, E.outExpo);
      const ty = tip[1] + 60;
      if (tr > 0) {
        for (let k = 0; k < 8; k++) {
          const x0 = 960 - 260 * tr + (k * 520 * tr) / 8;
          neonLine(cx, [[x0 + 4, ty], [x0 + (520 * tr) / 8 - 4, ty]], SPECTRUM[k], { width: 10, glow: 20, alpha: 1, core: null });
        }
      }
      cx.restore();
      if (t > tas - 0.05 && t < tas + 1.5) drawSparks(cx, t, { t0: tas, t1: tas + 0.1, rate: 1200, seed: 61, maxLife: 1.4, emitter: (b, r) => {
        const a = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.6;
        const v = 300 + r() * 1100;
        return { x: 960, y: 800, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + r() * 0.8, size: 1.5 + r() * 2, color: spec(Math.floor(r() * 8)), drag: 2.5, g: 500 };
      } });
      out.flash = Math.max(out.flash || 0, 0.3 * slam);
    }
    tEvery.update(t);
    if (dive > 0.02) { out.mb = 8; out.ca = 4 * dive; }
    st(scene, { transform: `translateY(${(-dive * 400).toFixed(1)}px)` });
    // ---- shatter of the app scene
    if (!ctx.snapMode && t < T("shatter2") + 1.5) sh.setImage(`${ASSET.work}/snap/app_end.jpg`);
    sh.update(ctx.snapMode ? -1 : t - T("shatter2"));
    if (t < T("shatter2") + 0.45) out.mb = 4;
    if (t > tsi - 0.4 && t < taf) out.mb = Math.max(out.mb || 1, 3);
    return out;
  },
};
