// Frame-exact renderer for the HTML film stage.
//   node render.mjs --work <scratch dir> --out <frames dir> --from 0 --to 121.2 [--workers 4]
//                   [--w 1920 --h 1080] [--force] [--preview 4.8,7.2,...] [--snaps]
//                   [--page vertical.html --transparent]  (caption layer for the 9:16 cut, PNG with alpha)
// Serves the repo (/) and the scratch work dir (/work) over HTTP, opens N headless Chromium
// pages, and for every frame calls FILM.render(t) and captures a JPEG (+ motion-blur
// sub-frames when a scene asks for them). Per-frame post-FX parameters go to fx/<frame>.json.
import { createRequire } from "node:module";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/[\\/]$/, "");
const require = createRequire(REPO + "/extension/package.json");
const { chromium } = require("playwright");

const A = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) A[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
const WORK = A.work;
const OUT = A.out ?? join(WORK, "frames");
const W = Number(A.w ?? 1920), H = Number(A.h ?? 1080);
const FPS = 60;
const SHUTTER = 0.5; // fraction of a frame interval covered by motion blur sub-samples

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = url.startsWith("/work/") ? join(WORK, url.slice(6)) : join(REPO, normalize(url));
  try {
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "max-age=3600" });
    res.end(readFileSync(file));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const PAGE = `http://127.0.0.1:${PORT}/marketing/video/src/film/${A.page ?? "index.html"}?w=${W}&h=${H}${A.notext ? "&notext=1" : ""}`;
const EXT = A.transparent ? "png" : "jpg";

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });

async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text()); });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.goto(PAGE);
  const ok = await page.evaluate(() => window.FILM.ready);
  if (!ok) throw new Error(await page.evaluate(() => window.FILM.error));
  const cdp = await ctx.newCDPSession(page);
  if (A.transparent) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  return { page, cdp };
}
async function shot(P, file, quality = 94) {
  const { data } = await P.cdp.send("Page.captureScreenshot", { format: file.endsWith(".png") ? "png" : "jpeg", quality, optimizeForSpeed: true });
  writeFileSync(file, Buffer.from(data, "base64"));
}
const pad = (f) => String(f).padStart(5, "0");

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "fx"), { recursive: true });
mkdirSync(join(WORK, "snap"), { recursive: true });

const first = await openPage();

// 1) snapshots used by shatter transitions (rendered clean, before the main pass)
const snaps = await first.page.evaluate(() => window.FILM.snapshots);
for (const s of snaps) {
  const f = join(WORK, "snap", s.id + ".jpg");
  if (existsSync(f) && !A.resnap) continue;
  await first.page.evaluate((t) => window.FILM.render(t, { snap: true }), s.t);
  await shot(first, f, 96);
  console.log("snap", s.id, s.t);
}
if (A.snaps) { await browser.close(); server.close(); process.exit(0); }

// 2) preview stills
if (A.preview) {
  for (const ts of A.preview.split(",")) {
    const t = Number(ts);
    const fx = await first.page.evaluate((t) => window.FILM.render(t), t);
    await shot(first, join(OUT, `preview_${t.toFixed(2)}.jpg`), 92);
    console.log("preview", t, JSON.stringify(fx));
  }
  await browser.close();
  server.close();
  process.exit(0);
}

// 3) main pass
const f0 = Math.round(Number(A.from ?? 0) * FPS);
const f1 = Math.round(Number(A.to ?? 121.2) * FPS);
const N = Number(A.workers ?? 4);
const pages = [first];
for (let i = 1; i < N; i++) pages.push(await openPage());
const t0 = Date.now();
let done = 0;
async function worker(P, wi) {
  for (let f = f0 + wi; f < f1; f += N) {
    const main = join(OUT, `${pad(f)}.${EXT}`);
    const fxf = join(OUT, "fx", `${pad(f)}.json`);
    if (!A.force && existsSync(fxf)) { done++; continue; }
    const t = f / FPS;
    const fx = await P.page.evaluate((t) => window.FILM.render(t), t);
    const mb = Math.min(8, Math.max(1, Math.round(fx.mb || 1)));
    if (mb > 1) {
      for (let i = 0; i < mb; i++) {
        const ts = t + ((i + 0.5) / mb - 0.5) * (SHUTTER / FPS);
        await P.page.evaluate((ts) => window.FILM.render(ts), ts);
        await shot(P, join(OUT, `${pad(f)}_${i}.${EXT}`));
      }
      await P.page.evaluate((t) => window.FILM.render(t), t);
    }
    await shot(P, main);
    fx.mb = mb;
    writeFileSync(fxf, JSON.stringify(fx));
    done++;
    if (done % 120 === 0) console.log(`${done}/${f1 - f0} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
await Promise.all(pages.map((P, i) => worker(P, i)));
console.log(`done ${f1 - f0} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await browser.close();
server.close();
