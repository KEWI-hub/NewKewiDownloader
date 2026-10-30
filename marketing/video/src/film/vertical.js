// Caption / end-card layer for the 1080×1920 social cut (rendered with a transparent background
// and composited over the recut promo by post/post_vertical.py). Time = vertical-edit seconds.
import { h, st, seg, E, KText, spring, clamp, GRAD_PRISM, settle } from "./lib.js";

const W = 1080, H = 1920;
const stage = document.getElementById("stage");
Object.assign(stage.style, { width: W + "px", height: H + "px" });
const K = [];
let lab, foot, icon, cta;

async function init() {
  await Promise.all([document.fonts.load('800 40px "InterVariable"'), document.fonts.load('400 40px "JetBrains Mono"')]);
  await document.fonts.ready;
  const add = (k) => (K.push(k), k);
  lab = h("div", "mono", stage, { position: "absolute", left: "540px", top: "250px", transform: "translateX(-50%)", fontSize: "24px", letterSpacing: "0.3em", color: "#a3a7b5", whiteSpace: "nowrap", opacity: "0" });
  lab.textContent = "PRISM · DOWNLOAD MANAGER";
  const big = { x: 540, size: 150, weight: 780, align: "center", tracking: -0.05, mask: true };
  add(new KText(stage, "One beam.", { ...big, y: 380 })).anim("in", 3.6, "rise", { stagger: 0.04 }).anim("out", 6.9, "up", { dur: 0.25, stagger: 0.01 });
  add(new KText(stage, "Many rays.", { ...big, y: 545, gradient: GRAD_PRISM, mask: false, seed: 4 })).anim("in", 4.8, "rays", { dur: 0.8, stagger: 0.03, order: "rev" }).anim("out", 6.9, "blur", { dur: 0.25, stagger: 0 });
  add(new KText(stage, "16 connections.", { ...big, size: 120, y: 380 })).anim("in", 7.25, "snap", { dur: 0.45, stagger: 0.02, mask: false }).anim("out", 11.75, "up", { dur: 0.2, stagger: 0.008 });
  add(new KText(stage, "One file.", { ...big, size: 120, y: 525, gradient: GRAD_PRISM, seed: 7 })).anim("in", 8.4, "rise", { stagger: 0.04 }).anim("out", 11.75, "up", { dur: 0.2, stagger: 0.01 });
  add(new KText(stage, "Every download, split into", { x: 540, y: 1450, size: 44, weight: 600, align: "center", tracking: -0.02, color: "#c3c6d0", mask: true })).anim("in", 8.0, "rise", { stagger: 0.01 }).anim("out", 11.8, "up", { dur: 0.2, stagger: 0.004 });
  add(new KText(stage, "parallel connections.", { x: 540, y: 1515, size: 44, weight: 600, align: "center", tracking: -0.02, color: "#c3c6d0", mask: true })).anim("in", 8.15, "rise", { stagger: 0.01 }).anim("out", 11.8, "up", { dur: 0.2, stagger: 0.004 });
  add(new KText(stage, "15×", { x: 540, y: 400, size: 330, weight: 800, align: "center", tracking: -0.06, gradient: GRAD_PRISM, seed: 3 })).anim("in", 12.0, "zoom", { dur: 0.45, stagger: 0.04 }).anim("out", 14.25, "blur", { dur: 0.2, stagger: 0 });
  add(new KText(stage, "faster downloads", { x: 540, y: 590, size: 70, weight: 700, align: "center", tracking: -0.03, mask: true })).anim("in", 12.4, "rise", { stagger: 0.015 }).anim("out", 14.25, "up", { dur: 0.2, stagger: 0.004 });
  foot = h("div", "mono", stage, { position: "absolute", left: "540px", top: "1460px", transform: "translateX(-50%)", fontSize: "22px", color: "#7d8296", textAlign: "center", lineHeight: "1.6", whiteSpace: "nowrap", opacity: "0" });
  foot.innerHTML = "on servers that limit each connection<br>(1 GiB · 4 MiB/s per connection · 61.8 vs 4.0 MiB/s)";
  // end card
  icon = h("img", "", stage, { position: "absolute", left: "540px", top: "760px", width: "520px", height: "520px", marginLeft: "-260px", marginTop: "-260px", opacity: "0" });
  icon.src = "/assets/brand/app-icon.svg";
  add(new KText(stage, "Prism", { x: 540, y: 1130, size: 210, weight: 660, align: "center", tracking: -0.04, mask: true })).anim("in", 14.9, "rise", { dur: 0.8, stagger: 0.05 });
  add(new KText(stage, "Download everything,", { x: 540, y: 1300, size: 60, weight: 640, align: "center", tracking: -0.03 })).anim("in", 15.7, "track", { dur: 0.9, stagger: 0 });
  add(new KText(stage, "beautifully.", { x: 540, y: 1372, size: 60, weight: 640, align: "center", tracking: -0.03, gradient: GRAD_PRISM, seed: 2 })).anim("in", 16.0, "track", { dur: 0.9, stagger: 0 });
  cta = h("div", "mono", stage, { position: "absolute", left: "540px", top: "1530px", transform: "translateX(-50%)", fontSize: "26px", letterSpacing: "0.22em", color: "#a3a7b5", whiteSpace: "nowrap", opacity: "0" });
  cta.textContent = "WINDOWS · LINUX · MACOS";
  for (const k of K) k.layoutGradient();
  return true;
}

async function render(t) {
  st(lab, { opacity: (seg(t, 1.0, 1.6) * (1 - seg(t, 6.8, 7.1))).toFixed(3), letterSpacing: `${(0.6 - 0.3 * seg(t, 1.0, 2.2, E.outCubic)).toFixed(3)}em` });
  for (const k of K) k.update(t);
  st(foot, { opacity: (seg(t, 12.8, 13.2) * (1 - seg(t, 14.2, 14.4))).toFixed(3) });
  const sp = spring(t - 14.4, 1.6, 0.55);
  st(icon, { opacity: clamp((t - 14.4) * 6).toFixed(3), transform: `scale(${(0.6 + 0.4 * sp).toFixed(4)})` });
  st(cta, { opacity: seg(t, 16.8, 17.4).toFixed(3) });
  await settle();
  return { mb: 1 };
}

window.FILM = { W, H, ready: init(), render, snapshots: [] };
