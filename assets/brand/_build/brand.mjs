// Generates the Prism brand SVGs into assets/brand/.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
// Run from anywhere: node assets/brand/_build/brand.mjs
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(OUT, "tray"), { recursive: true });
const wm = JSON.parse(readFileSync(new URL("./wordmark.json", import.meta.url)));
const svg = (vb, body, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${w ? ` width="${w}" height="${h}"` : ""} fill="none">\n${body}\n</svg>\n`;

// ---- shared 64-grid geometry --------------------------------------------
const PRISM = "M24.4 9.6a3 3 0 0 1 5.2 0l20.3 37.3a3 3 0 0 1-2.6 4.4H6.7a3 3 0 0 1-2.6-4.4z";
const BEAM = "M1.5 39.5L10.6 34.7";
const INNER = "M11.5 34.6L41.2 33.8";
const SPEC = "M22.6 14.2L9.4 38.6";
// rays: physically ordered (red bends least → top, violet most → bottom)
const RAYS = [
  ["#ff7f8f", "M41 31.5L61 16", "9 3.5 6 3.5 60"],
  ["#f2c14e", "M41.6 32.6L62 25", "6 3.5 10 3.5 60"],
  ["#2ed3a9", "M42 34L62.2 34", "11 3.5 5 3.5 60"],
  ["#46a8ff", "M42.2 35.4L62 43", "7 3.5 9 3.5 60"],
  ["#8b7bff", "M42 36.6L61 51.5", "10 3.5 7 3.5 60"],
];
const rays = (w = 3.4, dashed = true, extend = 0) =>
  RAYS.map(([c, d, da]) => {
    if (extend) { // push the end point further along the same direction
      const m = d.match(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/).slice(1).map(Number);
      const dx = m[2] - m[0], dy = m[3] - m[1], k = 1 + extend / Math.hypot(dx, dy);
      d = `M${m[0]} ${m[1]}L${(m[0] + dx * k).toFixed(2)} ${(m[1] + dy * k).toFixed(2)}`;
    }
    return `<path d="${d}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${dashed ? ` stroke-dasharray="${da}"` : ""}/>`;
  }).join("\n  ");

// mark variants -----------------------------------------------------------
function markBody(id, mode) {
  // mode: "universal" (indigo glass, works on light & dark) | "onDark" (white glass)
  const W = mode === "onDark";
  const defs = `<defs>
  <linearGradient id="${id}g" x1="10" y1="8" x2="46" y2="54" gradientUnits="userSpaceOnUse">${W
    ? '<stop stop-color="#fff" stop-opacity=".42"/><stop offset=".55" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/>'
    : '<stop stop-color="#a9a7ff" stop-opacity=".75"/><stop offset=".55" stop-color="#6461f2" stop-opacity=".35"/><stop offset="1" stop-color="#4f4be0" stop-opacity=".55"/>'}</linearGradient>
  <linearGradient id="${id}r" x1="8" y1="8" x2="48" y2="54" gradientUnits="userSpaceOnUse">${W
    ? '<stop stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity=".8"/>'
    : '<stop stop-color="#c9c8ff"/><stop offset=".5" stop-color="#6461f2"/><stop offset="1" stop-color="#8e8cff"/>'}</linearGradient>
  <linearGradient id="${id}b" x1="1" y1="0" x2="11" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="${W ? "#fff" : "#8a8fa0"}" stop-opacity="0"/><stop offset="1" stop-color="${W ? "#fff" : "#8a8fa0"}"/></linearGradient>
</defs>`;
  return `${defs}
  <path d="${BEAM}" stroke="url(#${id}b)" stroke-width="3.2" stroke-linecap="round"/>
  ${rays()}
  <path d="${PRISM}" fill="url(#${id}g)" stroke="url(#${id}r)" stroke-width="2"/>
  <path d="${INNER}" stroke="${W ? "#fff" : "#fff"}" stroke-opacity="${W ? ".55" : ".7"}" stroke-width="2" stroke-linecap="round"/>
  <path d="${SPEC}" stroke="#fff" stroke-opacity="${W ? ".7" : ".85"}" stroke-width="1.4" stroke-linecap="round"/>`;
}

writeFileSync(join(OUT, "logo-mark.svg"), svg("0 0 64 64", `  <title>Prism</title>\n  ${markBody("m", "universal")}`, 64, 64));
writeFileSync(join(OUT, "logo-mark-on-dark.svg"), svg("0 0 64 64", `  <title>Prism</title>\n  ${markBody("m", "onDark")}`, 64, 64));
writeFileSync(join(OUT, "logo-mark-mono.svg"), svg("0 0 64 64",
  `  <title>Prism</title>
  <g stroke="currentColor" stroke-linecap="round">
  <path d="${BEAM}" stroke-width="3.2"/>
  ${RAYS.map(([, d, da]) => `<path d="${d}" stroke-width="3.4" stroke-dasharray="${da}"/>`).join("\n  ")}
  <path d="${PRISM}" stroke-width="3" stroke-linejoin="round"/>
  <path d="${INNER}" stroke-width="2" stroke-opacity=".5"/>
  </g>`, 64, 64));

// wordmarks: mark (64) + 24 gap + "Prism" set at 100px → scale to height 64
function wordmark(ink, mode) {
  const s = 0.46; // 100px font → cap 33.5
  const tx = 64 + 16, ty = 32 + (wm.capHeight * s) / 2;
  const w = Math.ceil(tx + wm.width * s + 2);
  return svg(`0 0 ${w} 64`, `  <title>Prism</title>\n  ${markBody("w", mode)}\n  <path transform="translate(${tx} ${ty.toFixed(2)}) scale(${s})" fill="${ink}" d="${wm.d}"/>`, w, 64);
}
writeFileSync(join(OUT, "logo-wordmark-dark.svg"), wordmark("#eceef4", "onDark")); // for DARK backgrounds
writeFileSync(join(OUT, "logo-wordmark-light.svg"), wordmark("#111318", "universal")); // for LIGHT backgrounds

// ---- app icon 1024 ------------------------------------------------------
const TILE = { x: 64, y: 64, w: 896, h: 896, r: 206 };
const S = 11, TX = 512 - 33 * S, TY = 512 - 30.5 * S;
const appIcon = svg("0 0 1024 1024", `  <title>Prism</title>
  <defs>
    <clipPath id="tile"><rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" rx="${TILE.r}"/></clipPath>
    <linearGradient id="bg" x1="512" y1="64" x2="512" y2="960" gradientUnits="userSpaceOnUse"><stop stop-color="#262741"/><stop offset=".55" stop-color="#11121c"/><stop offset="1" stop-color="#08090e"/></linearGradient>
    <radialGradient id="glowA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(250 230) rotate(40) scale(560 460)"><stop stop-color="#7c78ff" stop-opacity=".55"/><stop offset="1" stop-color="#7c78ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="glowB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(900 820) rotate(-140) scale(520 420)"><stop stop-color="#2fcbe6" stop-opacity=".22"/><stop offset="1" stop-color="#2fcbe6" stop-opacity="0"/></radialGradient>
    <linearGradient id="rim" x1="200" y1="64" x2="824" y2="960" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity=".55"/><stop offset=".3" stop-color="#fff" stop-opacity=".12"/><stop offset=".75" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient>
    <linearGradient id="sheen" x1="512" y1="64" x2="512" y2="520" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="18"/></filter>
    <linearGradient id="ag" x1="10" y1="8" x2="46" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity=".58"/><stop offset=".45" stop-color="#c9c8ff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity=".32"/></linearGradient>
    <linearGradient id="ar" x1="8" y1="8" x2="48" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity=".85"/></linearGradient>
    <linearGradient id="ab" x1="-4" y1="0" x2="11" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
  </defs>
  <rect x="${TILE.x}" y="${TILE.y + 18}" width="${TILE.w}" height="${TILE.h}" rx="${TILE.r}" fill="#000" opacity=".35" filter="url(#shadow)"/>
  <g clip-path="url(#tile)">
    <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" fill="url(#bg)"/>
    <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" fill="url(#glowA)"/>
    <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" fill="url(#glowB)"/>
    <g transform="translate(${TX} ${TY}) scale(${S})">
      <g filter="url(#blur)" opacity=".55" transform="scale(${1 / S}) "><g transform="scale(${S})">${rays(5, false, 12)}</g></g>
      <path d="M-6 43.5L10.6 34.7" stroke="url(#ab)" stroke-width="3.2" stroke-linecap="round"/>
      ${rays(3.4, true, 12)}
      <path d="${PRISM}" fill="#0c0d16" fill-opacity=".2"/>
      <path d="${PRISM}" fill="url(#ag)" stroke="url(#ar)" stroke-width="1.8"/>
      <path d="${INNER}" stroke="#fff" stroke-opacity=".6" stroke-width="1.8" stroke-linecap="round"/>
      <path d="${SPEC}" stroke="#fff" stroke-opacity=".75" stroke-width="1.2" stroke-linecap="round"/>
    </g>
    <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" fill="url(#sheen)"/>
  </g>
  <rect x="${TILE.x + 2}" y="${TILE.y + 2}" width="${TILE.w - 4}" height="${TILE.h - 4}" rx="${TILE.r - 2}" stroke="url(#rim)" stroke-width="4"/>`, 1024, 1024);
writeFileSync(join(OUT, "app-icon.svg"), appIcon);

// ---- small app icon (≤ 32 px), 32 grid ----------------------------------
const small = svg("0 0 32 32", `  <title>Prism</title>
  <defs>
    <linearGradient id="bg" x1="16" y1="1" x2="16" y2="31" gradientUnits="userSpaceOnUse"><stop stop-color="#2c2d4a"/><stop offset="1" stop-color="#0b0c13"/></linearGradient>
    <radialGradient id="gl" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(8 7) scale(18 16)"><stop stop-color="#7c78ff" stop-opacity=".6"/><stop offset="1" stop-color="#7c78ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="tri" x1="8" y1="6" x2="18" y2="25" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#c9cbe0"/></linearGradient>
    <clipPath id="c"><rect x="1" y="1" width="30" height="30" rx="7.5"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect x="1" y="1" width="30" height="30" fill="url(#bg)"/>
    <rect x="1" y="1" width="30" height="30" fill="url(#gl)"/>
    <path d="M15 14.2L32 6.5" stroke="#ff7f8f" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M15.5 16.5H32" stroke="#2fcbe6" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M15.5 18.8L32 26.5" stroke="#8b7bff" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M10.9 6.6a1.3 1.3 0 0 1 2.2 0l7.75 15.6a1.3 1.3 0 0 1-1.16 1.9H4.31a1.3 1.3 0 0 1-1.16-1.9z" fill="url(#tri)"/>
  </g>
  <rect x="1.5" y="1.5" width="29" height="29" rx="7" stroke="#fff" stroke-opacity=".16"/>`, 32, 32);
writeFileSync(join(OUT, "app-icon-small.svg"), small);

// ---- tray icons, 16 grid -----------------------------------------------
const TRI = "M4.6 3.1a1 1 0 0 1 1.8 0l4.4 8.9a1 1 0 0 1-.9 1.45H1.1a1 1 0 0 1-.9-1.45z";
const TRAY_RAYS = "M8.9 7L14.9 3M9.4 8.4L15.2 8.2M9.9 9.8l4.6 3.8";
const badges = {
  downloading: (fg) => `<path d="M12.5 10.4v4.1M10.9 13l1.6 1.6 1.6-1.6" stroke="${fg}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  paused: (fg) => `<path d="M11.6 10.9v3.2M13.4 10.9v3.2" stroke="${fg}" stroke-width="1.3" stroke-linecap="round"/>`,
  error: (fg) => `<path d="M12.5 10.5v2.1" stroke="${fg}" stroke-width="1.4" stroke-linecap="round"/><circle cx="12.5" cy="14.3" r=".8" fill="${fg}"/>`,
};
const palettes = {
  light: { glyph: "#ffffff", downloading: ["#8e8cff", "#0b0c13"], paused: ["#f5b544", "#1a1203"], error: ["#ff6b6b", "#1a0505"] }, // for DARK taskbars
  dark: { glyph: "#1b1d24", downloading: ["#5653ea", "#ffffff"], paused: ["#b26b00", "#ffffff"], error: ["#d0343a", "#ffffff"] },  // for LIGHT taskbars
};
function tray(state, variant) {
  const P = palettes[variant];
  const hasBadge = state !== "idle";
  const glyph = `<path d="${TRI}" fill="${P.glyph}"/><path d="${TRAY_RAYS}" stroke="${P.glyph}" stroke-width="1.5" stroke-linecap="round"/>`;
  if (!hasBadge) return svg("0 0 16 16", `  ${glyph}`, 16, 16);
  const [bg, fg] = P[state];
  return svg("0 0 16 16", `  <defs><mask id="cut"><rect width="16" height="16" fill="#fff"/><circle cx="12.5" cy="12.5" r="4.6" fill="#000"/></mask></defs>
  <g mask="url(#cut)">${glyph}</g>
  <circle cx="12.5" cy="12.5" r="3.5" fill="${bg}"/>
  ${badges[state](fg)}`, 16, 16);
}
function trayTemplate(state) {
  const glyph = `<path d="${TRI}" fill="#000"/><path d="${TRAY_RAYS}" stroke="#000" stroke-width="1.5" stroke-linecap="round"/>`;
  if (state === "idle") return svg("0 0 16 16", `  ${glyph}`, 16, 16);
  // badge is solid black with its glyph knocked out to alpha
  const knock = badges[state]("#000");
  return svg("0 0 16 16", `  <defs>
    <mask id="cut"><rect width="16" height="16" fill="#fff"/><circle cx="12.5" cy="12.5" r="4.6" fill="#000"/></mask>
    <mask id="badge"><circle cx="12.5" cy="12.5" r="3.5" fill="#fff"/>${knock}</mask>
  </defs>
  <g mask="url(#cut)">${glyph}</g>
  <rect width="16" height="16" fill="#000" mask="url(#badge)"/>`, 16, 16);
}
for (const st of ["idle", "downloading", "paused", "error"]) {
  for (const v of ["light", "dark"]) writeFileSync(join(OUT, "tray", `tray-${st}-${v}.svg`), tray(st, v));
  writeFileSync(join(OUT, "tray", `tray-${st}-template.svg`), trayTemplate(st));
}
console.log("brand svgs written");
