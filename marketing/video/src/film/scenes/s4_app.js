// 4 · The app (43.2 – 66.6 s): the real UI (captured live from the demo backend with a virtual
// clock) floating as glass windows: details window, main window, accents, Download File dialog
// with a click, completion dialog with burst, mini window.
import { h, st, clamp, lerp, seg, E, T, Seq, KText, spring, drawSparks, glowDot, decay, noise1, ASSET, GRAD_PRISM, C, spec, setSrc } from "../lib.js";
import { Win, ambient, cursor, chip } from "./common.js";
import { DW } from "./s3_engine.js";

const U = (p) => `${ASSET.work}/ui/${p}`;
const ACCENTS = [["prism", "#6461f2"], ["cyan", "#36c5e6"], ["emerald", "#2fc489"], ["amber", "#f2b54a"], ["rose", "#d03a64"], ["graphite", "#c9ccd6"]];
let amb, pool, det, detSeq, mainW, mainSeq, dlg, dlgSeq, cmpW, cmpSeq, mini, miniSeq, cur, cv, cx;
let tMeet, tLanes, tGlance, tEvery, tCalm, tGlass, tDark, tDense, tCalm2, tYours, tYoursSub, tAdd, tDone, tVer, shaChip, tWay, tWaySub;
let c1, c2;

export default {
  id: "app",
  start: 43.2,
  end: 66.6,
  z: 3,
  build(root, ctx) {
    amb = ambient(root);
    pool = h("div", "layer", root, { opacity: "0" });
    det = new Win(root, 1520, 1200, { radius: 28 });
    detSeq = (i) => U(`details_dark/f_${String(i).padStart(4, "0")}.png`);
    mainW = new Win(root, 2160, 1350, { radius: 20 });
    dlg = new Win(root, 1200, 880, { radius: 26 });
    cmpW = new Win(root, 1000, 600, { radius: 26 });
    mini = new Win(root, 720, 440, { radius: 24 });
    cv = h("canvas", "", root);
    cv.width = ctx.W;
    cv.height = ctx.H;
    cx = cv.getContext("2d");
    cur = cursor(root);
    const L = { x: 150, size: 112, weight: 740, tracking: -0.05, mask: true };
    tMeet = new KText(root, "Meet Prism.", { ...L, y: 470, size: 116 }).anim("in", T("txt_meet"), "rise", { stagger: 0.04 }).anim("out", T("main_in") - 0.2, "up", { dur: 0.3, stagger: 0.012 });
    c1 = chip(root, `<span style="width:10px;height:10px;border-radius:50%;background:${C.accent};box-shadow:0 0 10px ${C.accent}"></span>16 live connection lanes`, { left: "150px", top: "620px", opacity: "0" });
    c2 = chip(root, `<span style="width:10px;height:10px;border-radius:50%;background:#2fcbe6;box-shadow:0 0 10px #2fcbe6"></span>Speed · ETA · file map at a glance`, { left: "150px", top: "690px", opacity: "0" });
    tEvery = new KText(root, "Every download.", { ...L, y: 420, size: 96 }).anim("in", T("txt_everydl"), "rise", { stagger: 0.025 }).anim("out", T("glass_sweep") - 0.15, "up", { dur: 0.28, stagger: 0.01 });
    tCalm = new KText(root, "One calm list.", { ...L, y: 530, size: 96, gradient: GRAD_PRISM, seed: 2 }).anim("in", T("txt_calmlist"), "rise", { stagger: 0.03 }).anim("out", T("glass_sweep") - 0.12, "up", { dur: 0.28, stagger: 0.01 });
    tGlass = new KText(root, "Liquid glass.", { ...L, y: 360, size: 104 }).anim("in", T("glass_sweep"), "track", { dur: 0.7, stagger: 0.0 }).anim("out", T("accent1") - 0.2, "up", { dur: 0.25, stagger: 0.01 });
    tDark = new KText(root, "Dark.", { ...L, y: 520, size: 84, color: "#c3c6d0", mask: false }).anim("in", T("txt_dark"), "snap", { dur: 0.4, stagger: 0.02 }).anim("out", T("accent1") - 0.2, "blur", { dur: 0.25, stagger: 0 });
    tDense = new KText(root, "Dense.", { ...L, y: 620, size: 84, color: "#c3c6d0", mask: false }).anim("in", T("txt_dense"), "snap", { dur: 0.4, stagger: 0.02 }).anim("out", T("accent1") - 0.17, "blur", { dur: 0.25, stagger: 0 });
    tCalm2 = new KText(root, "Calm.", { ...L, y: 720, size: 84, gradient: GRAD_PRISM, mask: false, seed: 4 }).anim("in", T("txt_calm"), "snap", { dur: 0.4, stagger: 0.02 }).anim("out", T("accent1") - 0.14, "blur", { dur: 0.25, stagger: 0 });
    tYours = new KText(root, "Make it yours.", { ...L, y: 440, size: 104 }).anim("in", T("accent2"), "rise", { stagger: 0.03 }).anim("out", T("dialog_pop") - 0.2, "up", { dur: 0.25, stagger: 0.01 });
    tYoursSub = new KText(root, "Six accents · light & dark · comfortable or compact", { x: 154, y: 545, size: 30, weight: 560, color: "#a3a7b5", tracking: -0.01, mask: true }).anim("in", T("accent4"), "rise", { stagger: 0.006 }).anim("out", T("dialog_pop") - 0.2, "up", { dur: 0.25, stagger: 0.002 });
    tAdd = new KText(root, "Add a link. That’s it.", { x: 960, y: 105, size: 76, weight: 720, align: "center", tracking: -0.04, mask: true }).anim("in", T("txt_addlink"), "rise", { stagger: 0.025 }).anim("out", T("click_start") + 0.1, "up", { dur: 0.3, stagger: 0.008 });
    tDone = new KText(root, "Done.", { ...L, y: 430, size: 128 }).anim("in", T("txt_done"), "rise", { stagger: 0.04 }).anim("out", T("mini_in") - 0.2, "up", { dur: 0.3, stagger: 0.01 });
    tVer = new KText(root, "Verified.", { ...L, y: 560, size: 128, gradient: "linear-gradient(90deg,#3dd68c,#2fcbe6)", seed: 6 }).anim("in", T("txt_verified"), "rise", { stagger: 0.04 }).anim("out", T("mini_in") - 0.17, "up", { dur: 0.3, stagger: 0.01 });
    shaChip = chip(root, `<span style="color:${C.success}">✓</span>&nbsp;SHA-256 · antivirus hook · opens in one click`, { left: "154px", top: "660px", opacity: "0" });
    tWay = new KText(root, "Out of your way.", { ...L, y: 430, size: 112 }).anim("in", T("txt_outofway"), "rise", { stagger: 0.03 }).anim("out", T("app_out"), "blur", { dur: 0.5, stagger: 0.01 });
    tWaySub = new KText(root, "Mini window · tray · notifications · drop zone", { x: 154, y: 530, size: 30, weight: 560, color: "#a3a7b5", tracking: -0.01, mask: true }).anim("in", T("txt_outofway") + 0.5, "rise", { stagger: 0.006 }).anim("out", T("app_out"), "fade", { dur: 0.4, stagger: 0 });
  },
  update(t, ctx) {
    const out = { bloom: 0.35 };
    const t0 = T("app_in");
    const tm = T("main_in");
    const ta = T("accent1");
    const td = T("dialog_pop");
    const tc = T("click_start");
    const tco = T("complete_in");
    const tmi = T("mini_in");
    const tao = T("app_out");
    // ---- ambient light follows the accent
    let accHex = "#6461f2";
    const ai = Math.floor((t - ta) / 0.6);
    if (t >= ta && ai < 6) accHex = ACCENTS[ai][1];
    st(pool, { opacity: (0.55 * seg(t, ta - 0.2, ta) * (1 - seg(t, td - 0.4, td))).toFixed(2), background: `radial-gradient(50% 60% at 70% 50%, ${accHex}55 0%, transparent 70%)` });
    // ---- details window: starts exactly where the engine lanes landed, then drifts right
    const dIn = seg(t, t0 + 0.2, t0 + 1.4, E.inOutCubic);
    const dOut = seg(t, tm - 0.1, tm + 0.6, E.inOutCubic);
    det.src(detSeq(Math.min(719, Math.round((t - t0) * 60))));
    det.pose({
      cx: lerp(DW.cx, 1250, dIn) + dOut * 600, cy: DW.cy + lerp(0, 10, dIn), s: lerp(DW.s, 0.68, dIn) * (1 - 0.2 * dOut),
      ry: lerp(0, -16, dIn) - 10 * dOut, rx: lerp(0, 3, dIn), z: -500 * dOut, o: (seg(t, t0 - 0.08, t0 + 0.12)) * (1 - dOut), sheen: seg(t, t0 + 1.0, t0 + 2.6),
    });
    st(det.rim, { boxShadow: `inset 0 0 0 1px rgba(255,255,255,${0.12 * dIn}), inset 0 1px 0 rgba(255,255,255,0.22)` });
    tMeet.update(t);
    st(c1, { opacity: (seg(t, T("callout1"), T("callout1") + 0.25) * (1 - dOut)).toFixed(2), transform: `translateX(${((1 - seg(t, T("callout1"), T("callout1") + 0.4, E.outExpo)) * -40).toFixed(1)}px)` });
    st(c2, { opacity: (seg(t, T("callout2"), T("callout2") + 0.25) * (1 - dOut)).toFixed(2), transform: `translateX(${((1 - seg(t, T("callout2"), T("callout2") + 0.4, E.outExpo)) * -40).toFixed(1)}px)` });
    // ---- main window (live list)
    const mIn = seg(t, tm, tm + 1.1, E.outQuart);
    const dlgDim = seg(t, td - 0.1, td + 0.3) * (1 - seg(t, tc + 0.4, tc + 1.0));
    const back = seg(t, tco - 0.2, tco + 0.4, E.inOutCubic);
    const outk = seg(t, tao, tao + 0.6, E.inCubic);
    if (t >= ta && t < td + 0.6) {
      const idx = clamp(ai, 0, 5);
      mainW.src(U(`accent_${ACCENTS[idx][0]}/still.png`));
    } else mainW.src(U(`main_dark/f_${String(Math.min(599, Math.max(0, Math.round((t - tm) * 60)))).padStart(4, "0")}.png`));
    const drift = (t - tm) * 0.6;
    mainW.pose({
      cx: lerp(1350, 1320, seg(t, tm, tm + 8)) - back * 120, cy: lerp(980, 560, mIn), s: (0.56 - 0.06 * back) * (1 - 0.1 * outk), rx: lerp(28, 4, mIn), ry: -14 - drift * 0.4 + back * 6, z: -back * 300,
      o: mIn, sheen: seg(t, T("glass_sweep"), T("glass_sweep") + 1.1, E.inOutCubic), blur: dlgDim * 3 + back * 2, persp: 2400,
    });
    st(mainW.img, { filter: `brightness(${(1 - 0.45 * dlgDim - 0.35 * back).toFixed(3)})` });
    // accent flash on each switch
    if (t >= ta && t < ta + 3.6) out.flash = 0.08 * decay(t, ta + Math.max(0, ai) * 0.6, 12);
    tEvery.update(t);
    tCalm.update(t);
    tGlass.update(t);
    tDark.update(t);
    tDense.update(t);
    tCalm2.update(t);
    tYours.update(t);
    tYoursSub.update(t);
    // ---- Download File dialog: spring pop, cursor click, genie into the list
    const dt = t - td;
    const sp = spring(dt, 2.0, 0.45);
    const fly = seg(t, tc + 0.12, tc + 0.75, E.inCubic);
    dlgSeq = U(`capture_dark/f_${String(clamp(Math.round(dt * 60 + 120), 0, 299)).padStart(4, "0")}.png`);
    dlg.src(dlgSeq);
    const press = t >= tc && t < tc + 0.12 ? 1 : 0;
    dlg.pose({ cx: lerp(960, 1150, fly), cy: lerp(560, 300, fly), s: (0.62 + 0.1 * sp) * (1 - 0.95 * fly) * (1 - 0.015 * press), o: (dt > 0 ? clamp(sp * 1.4) : 0) * (1 - seg(t, tc + 0.6, tc + 0.75)), rx: (1 - sp) * 14, z: (1 - sp) * -200 });
    tAdd.update(t);
    // cursor path to "Start download" (dialog image px 1032,826 -> screen)
    const bx = 960 + (1032 - 600) * 0.72, by = 560 + (826 - 440) * 0.72;
    const cIn = seg(t, tc - 1.3, tc - 0.15, E.inOutCubic);
    cur.show(t > tc - 1.3 && t < tc + 0.5);
    const cxp = lerp(1500, bx, cIn) + Math.sin(cIn * Math.PI) * 30, cyp = lerp(980, by, cIn) - Math.sin(cIn * Math.PI) * 60;
    cur.at(cxp, cyp, press, t - tc);
    // ---- completion dialog with burst
    const cdt = t - tco;
    const csp = spring(cdt, 1.8, 0.5);
    cmpW.src(U(`complete_dark/f_${String(clamp(Math.round(cdt * 60), 0, 239)).padStart(4, "0")}.png`));
    const cOut = seg(t, tmi - 0.1, tmi + 0.5, E.inCubic);
    cmpW.pose({ cx: 1260 - cOut * 300, cy: 540 + cOut * 120, s: (0.95 + 0.08 * csp) * (1 - 0.4 * cOut), o: (cdt > 0 ? clamp(csp * 1.5) : 0) * (1 - cOut), rx: (1 - csp) * 10, z: -cOut * 400 });
    cx.clearRect(0, 0, ctx.W, ctx.H);
    const ringX = 1260 + (90 - 500) * 1.03, ringY = 540 + (184 - 300) * 1.03;
    const tb = T("complete_burst");
    if (t > tb - 0.1 && t < tb + 2) {
      drawSparks(cx, t, { t0: tb, t1: tb + 0.15, rate: 900, seed: 88, maxLife: 1.6, emitter: (b, r) => {
        const a = r() * Math.PI * 2;
        const v = 250 + r() * 900;
        return { x: ringX + Math.cos(a) * 40, y: ringY + Math.sin(a) * 40, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + r() * 0.9, size: 1.5 + r() * 2.5, color: spec(Math.floor(r() * 8)), drag: 2.4, g: 300 };
      } });
      glowDot(cx, ringX, ringY, 260, "rgba(61,214,140,0.5)", decay(t, tb, 4));
    }
    tDone.update(t);
    tVer.update(t);
    st(shaChip, { opacity: (seg(t, T("txt_verified") + 0.4, T("txt_verified") + 0.7) * (1 - seg(t, tmi - 0.2, tmi))).toFixed(2) });
    // ---- mini window
    const mdt = t - tmi;
    const msp = spring(mdt, 1.6, 0.55);
    mini.src(U(`mini_dark/f_${String(clamp(Math.round(mdt * 60), 0, 359)).padStart(4, "0")}.png`));
    mini.pose({ cx: lerp(1900, 1430, msp), cy: lerp(1100, 800, msp), s: 0.95, o: mdt > 0 ? clamp(msp * 1.3) : 0, ry: (1 - msp) * -20 - 6, rx: 4 });
    tWay.update(t);
    tWaySub.update(t);
    if (t > tao) out.ca = 3 * seg(t, tao, tao + 0.6);
    return out;
  },
};
