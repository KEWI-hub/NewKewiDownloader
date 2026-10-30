#!/bin/bash
# Renders the key-visual stills (Cycles + OptiX) into marketing/keyvisual/.
#   bash render_keyvisuals.sh [samples]
# "*-alpha.png" variants are rendered on pure black without the backdrop and converted to
# straight alpha with luma_alpha.py (glow-friendly: composite normally or in Screen mode).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../../keyvisual"
BL="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.2/blender.exe}"
S="${1:-192}"
TMP="${TMPDIR:-/tmp}/prism-kv"; mkdir -p "$OUT" "$TMP"
r() { "$BL" -b -P "$HERE/prism_scene.py" -- --engine cycles --samples "$S" "$@" 2>&1 | grep -E "WROTE|Error|Traceback" || true; }
r --shot kv_hero     --out "$OUT/prism-kv-01-hero-3840x2160.png"
r --shot kv_macro    --out "$OUT/prism-kv-02-macro-3840x2160.png"
r --shot kv_lanes    --out "$OUT/prism-kv-03-lanes-3840x2160.png" --res 3840x2160
r --shot kv_low      --out "$OUT/prism-kv-04-burst-3840x2160.png"
r --shot kv_front    --out "$OUT/prism-kv-05-front-3840x2160.png"
r --shot kv_portrait --out "$OUT/prism-kv-06-portrait-2160x3840.png"
r --shot kv_square   --out "$OUT/prism-kv-07-square-3000x3000.png"
for s in "kv_hero:01-hero-3840x2160" "kv_lanes:03-lanes-3840x2160" "kv_front:05-front-3840x2160" "kv_portrait:06-portrait-2160x3840" "kv_square:07-square-3000x3000"; do
  shot="${s%%:*}"; name="${s#*:}"
  extra=""; [ "$shot" = kv_lanes ] && extra="--res 3840x2160"
  r --shot "$shot" --out "$TMP/$name-black.png" --tw backdrop=0 $extra
  py "$HERE/luma_alpha.py" "$TMP/$name-black.png" "$OUT/prism-kv-$name-alpha.png"
done
