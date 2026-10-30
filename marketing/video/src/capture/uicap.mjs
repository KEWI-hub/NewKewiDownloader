// Frame-exact capture of the REAL Prism UI (browser demo backend) with a virtual clock.
//
// The demo backend animates with setInterval (4 Hz engine ticks) and CSS transitions, so a
// plain screen recording is neither smooth nor reproducible. This script injects a virtual
// clock before any app code runs: setTimeout/setInterval/requestAnimationFrame/Date/
// performance.now are driven by us, and every Web Animation (CSS transitions + keyframes) is
// paused and seeked to the virtual time. Each output frame is exactly 1/fps of app time.
//
//   node uicap.mjs --url "http://localhost:1420/#/details/demo0" --out dir --frames 480
//        [--fps 60] [--w 1440] [--h 900] [--dpr 1.5] [--warm 2500] [--selector ".window"]
//        [--transparent] [--accent cyan] [--theme dark] [--still]   (still = 1 frame, PNG)
//        [--script "js run after warm-up"] [--post "js run after the clock is frozen"] [--css "..."] [--pre 0 (virtual ms to run before frame 0)]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Playwright comes from the extension's dev dependencies (repo root is four levels up).
const require = createRequire(fileURLToPath(new URL("../../../../extension/package.json", import.meta.url)));
const { chromium } = require("playwright");

const A = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, []),
);
const fps = Number(A.fps ?? 60);
const frames = Number(A.frames ?? 1);
const W = Number(A.w ?? 1440), H = Number(A.h ?? 900), DPR = Number(A.dpr ?? 1.5);
mkdirSync(A.out, { recursive: true });

const VT = `(() => {
  const realNow = performance.now.bind(performance);
  const RealDate = Date;
  const t0 = realNow();
  const dateBase = RealDate.now();
  let manual = false, vnow = 0;
  const now = () => (manual ? vnow : realNow() - t0);
  const rSetTimeout = window.setTimeout.bind(window);
  const rSetInterval = window.setInterval.bind(window);
  const rRaf = window.requestAnimationFrame.bind(window);
  let seq = 1;
  const timers = new Map();
  let rafQ = [];
  window.setTimeout = (fn, ms = 0, ...a) => { const id = seq++; timers.set(id, { fn, a, at: now() + Math.max(0, +ms || 0), ms: 0, iv: false }); return id; };
  window.setInterval = (fn, ms = 0, ...a) => { const id = seq++; const m = Math.max(1, +ms || 0); timers.set(id, { fn, a, at: now() + m, ms: m, iv: true }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (cb) => { const id = seq++; rafQ.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { rafQ = rafQ.filter((r) => r.id !== id); };
  performance.now = () => now();
  class VDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(dateBase + now()); else super(...a); }
    static now() { return dateBase + now(); }
  }
  window.Date = VDate;
  function fireDue(limit) {
    for (let guard = 0; guard < 10000; guard++) {
      let best = null, bid = 0;
      for (const [id, t] of timers) if (t.at <= limit && (!best || t.at < best.at)) { best = t; bid = id; }
      if (!best) return;
      if (manual) vnow = Math.max(vnow, best.at);
      if (best.iv) best.at += best.ms; else timers.delete(bid);
      try { typeof best.fn === "function" ? best.fn(...best.a) : eval(best.fn); } catch (e) { console.error(e); }
    }
  }
  function flushRaf() { const q = rafQ; rafQ = []; const ts = now(); for (const r of q) { try { r.cb(ts); } catch (e) { console.error(e); } } }
  rSetInterval(() => { if (!manual) fireDue(now()); }, 4);
  const loop = () => { if (!manual) flushRaf(); rRaf(loop); };
  rRaf(loop);
  const anims = new WeakMap();
  function syncAnims() {
    for (const a of document.getAnimations()) {
      let st = anims.get(a);
      if (st === undefined) { st = vnow - (a.currentTime ?? 0); anims.set(a, st); try { a.pause(); } catch {} }
      const tt = vnow - st;
      try {
        const end = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : Infinity;
        if (isFinite(end) && tt >= end) a.finish(); else a.currentTime = tt;
      } catch {}
    }
  }
  const tick = () => new Promise((r) => rSetTimeout(r, 0));
  window.__vt = {
    freeze() { vnow = realNow() - t0; manual = true; for (const a of document.getAnimations()) { anims.set(a, vnow - (a.currentTime ?? 0)); try { a.pause(); } catch {} } },
    async step(ms) {
      const target = vnow + ms;
      fireDue(target);
      vnow = target;
      for (let i = 0; i < 3; i++) { await tick(); fireDue(vnow); flushRaf(); }
      syncAnims();
      await tick();
      syncAnims();
      return vnow;
    },
    get now() { return now(); },
  };
})();`;

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: A.theme === "light" ? "light" : "dark" });
await ctx.addInitScript(VT);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
await page.goto(A.url, { waitUntil: "networkidle" });
if (A.transparent) await page.addStyleTag({ content: "html,body,#root{background:transparent!important}" });
if (A.css) await page.addStyleTag({ content: A.css });
if (A.transparent) await page.addStyleTag({ content: ".preview-desktop{background:transparent!important}" });
if (A.accent) await page.evaluate((a) => (document.documentElement.dataset.accent = a), A.accent);
await page.waitForTimeout(Number(A.warm ?? 2500));
if (A.script) await page.evaluate(A.script);
await page.waitForTimeout(300);
await page.evaluate(() => window.__vt.freeze());
if (A.post) {
  await page.evaluate(A.post);
  // let the router/React settle without advancing the clock (setTimeout(0) work is "due")
  for (let i = 0; i < 100; i++) {
    await page.evaluate((ms) => window.__vt.step(ms), i < 3 ? 0 : 16);
    if (!A.selector || (await page.locator(A.selector).count())) break;
    await page.waitForTimeout(20);
  }
}
if (A.pre) await page.evaluate((ms) => window.__vt.step(ms), Number(A.pre));

let clip;
if (A.selector) {
  const bb = await page.locator(A.selector).first().boundingBox();
  if (bb) clip = { x: Math.floor(bb.x), y: Math.floor(bb.y), width: Math.ceil(bb.width), height: Math.ceil(bb.height) };
}
if (A.clip) {
  const [x, y, w, h] = A.clip.split(",").map(Number);
  clip = { x, y, width: w, height: h };
}
const meta = { url: A.url, fps, frames, W, H, DPR, clip };
writeFileSync(join(A.out, "meta.json"), JSON.stringify(meta, null, 2));
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  if (f > 0) await page.evaluate((ms) => window.__vt.step(ms), 1000 / fps);
  else await page.evaluate(() => window.__vt.step(0));
  const ext = A.jpg ? "jpg" : "png";
  await page.screenshot({ path: join(A.out, frames === 1 ? `still.${ext}` : `f_${String(f).padStart(4, "0")}.${ext}`), clip, omitBackground: !!A.transparent, type: ext === "jpg" ? "jpeg" : "png", quality: ext === "jpg" ? 95 : undefined, animations: "allow", caret: "hide" });
  if (f % 60 === 0) console.log(`frame ${f}/${frames} ${(Date.now() - t0) / 1000}s`);
}
await browser.close();
console.log("done", A.out, clip ?? "");
