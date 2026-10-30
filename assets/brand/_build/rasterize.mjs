// Rasterizes assets/brand/*.svg → assets/brand/png/*.png with resvg.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
// Requires: npm i @resvg/resvg-js png-to-ico   (dev-only tooling)
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";

const B = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PNG = join(B, "png");
mkdirSync(join(PNG, "tray"), { recursive: true });

function render(file, width, out) {
  const svg = readFileSync(join(B, file), "utf8");
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)", shapeRendering: 2, imageRendering: 0 });
  const png = r.render().asPng();
  writeFileSync(join(PNG, out), png);
  return png;
}

// App icon: hand-tuned small master for ≤ 32 px, full artwork above.
const ico = [];
for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  const png = render(s <= 32 ? "app-icon-small.svg" : "app-icon.svg", s, `app-icon-${s}.png`);
  if (s <= 256) ico.push(png);
}
// Large-art versions of small sizes too (for comparison / macOS)
for (const s of [16, 32]) render("app-icon.svg", s, `app-icon-${s}-full.png`);

// Logos
for (const s of [32, 64, 128, 256, 512]) {
  render("logo-mark.svg", s, `logo-mark-${s}.png`);
  render("logo-mark-on-dark.svg", s, `logo-mark-on-dark-${s}.png`);
}
for (const [w, sfx] of [[200, ""], [400, "@2x"], [800, "@4x"]]) {
  render("logo-wordmark-dark.svg", w, `logo-wordmark-dark${sfx}.png`);
  render("logo-wordmark-light.svg", w, `logo-wordmark-light${sfx}.png`);
}

// Tray: 16 / 32 / 64 at @1x and @2x
for (const f of readdirSync(join(B, "tray")).filter((f) => f.endsWith(".svg"))) {
  const base = f.replace(".svg", "");
  for (const s of [16, 32, 64]) {
    render(join("tray", f), s, join("tray", `${base}-${s}.png`));
    render(join("tray", f), s * 2, join("tray", `${base}-${s}@2x.png`));
  }
}

// Multi-size ICO built from the hand-tuned PNGs (16/24/32 small master, 48–256 full art).
writeFileSync(join(B, "app-icon.ico"), await pngToIco(ico));
console.log("rasterized");
