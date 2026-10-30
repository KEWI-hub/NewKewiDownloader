#!/bin/bash
# Renders the animated Blender plates for the film (1920x1080, 60 fps, Cycles/OptiX) as PNG
# sequences + per-frame projected geometry (JSON). Resumable: existing frames are skipped.
#   bash render_film_shots.sh <outdir> [samples]
HERE="$(cd "$(dirname "$0")" && pwd)"
O="${1:?outdir}"; S="${2:-64}"
BL="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.2/blender.exe}"
r() { shot=$1; range=$2; mkdir -p "$O/$shot"; "$BL" -b -P "$HERE/prism_scene.py" -- --engine cycles --samples "$S" --shot $shot --frames $range --out "$O/$shot/####.png" 2>&1 | grep -E "FRAME|Error|Traceback"; }
r bridge 0:540      # film 21.0-30.0  (hit at 21.6)
r coldopen 0:756    # film 0.0-12.6   (hit at 4.8)
r outro 0:324       # film 108.0-113.4 (flash at 111.6)
