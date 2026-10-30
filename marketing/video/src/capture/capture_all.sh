#!/bin/bash
# Captures every real-UI plate used by the film from the browser demo (npm --prefix app run dev).
#   bash capture_all.sh <outdir>
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
U="${1:?outdir}"
B="http://localhost:1420"
c() {  # skip plates that already exist (re-run safe)
  local out=""; local a=("$@"); for ((i=0;i<${#a[@]};i++)); do [ "${a[$i]}" = "--out" ] && out="${a[$((i+1))]}"; done
  [ -f "$out/meta.json" ] && [ -z "$FORCE" ] && { echo "skip $out"; return; }
  node "$HERE/uicap.mjs" "$@" 2>&1 | tail -1; }
TW="--transparent --selector .preview-window"
# live sequences (60 fps, app time)
c --url "$B/?theme=dark#/details/demo0" --out "$U/details_dark" --frames 720 $TW --dpr 2
c --url "$B/?theme=dark#/" --out "$U/main_dark" --frames 600 --dpr 1.5
c --url "$B/?theme=dark&select=demo0&tab=connections#/" --out "$U/main_conn_dark" --frames 480 --dpr 1.5
c --url "$B/?theme=dark#/" --out "$U/complete_dark" --frames 240 $TW --dpr 2 --post "location.hash='#/complete/demo4'"
c --url "$B/?theme=dark#/" --out "$U/capture_dark" --frames 300 $TW --dpr 2 --post "location.hash='#/capture/cap1'"
c --url "$B/?theme=dark#/" --out "$U/video_dark" --frames 360 $TW --dpr 2 --post "location.hash='#/video/vid1'"
c --url "$B/?theme=dark#/mini" --out "$U/mini_dark" --frames 360 $TW --dpr 2
# stills
c --url "$B/?theme=light#/" --out "$U/main_light" --dpr 1.5
for a in prism cyan emerald amber rose graphite; do c --url "$B/?theme=dark#/" --out "$U/accent_$a" --dpr 1.5 --accent $a; done
c --url "$B/?theme=dark&sheet=scheduler:night#/" --out "$U/scheduler_dark" --dpr 1.5 --warm 3000
c --url "$B/?theme=dark&sheet=grabber:g1#/" --out "$U/grabber_dark" --dpr 1.5 --warm 3000
c --url "$B/?theme=dark&sheet=settings:appearance#/" --out "$U/settings_dark" --dpr 1.5 --warm 3000
c --url "$B/?theme=light&sheet=scheduler:night#/" --out "$U/scheduler_light" --dpr 1.5 --warm 3000
c --url "$B/?theme=light#/details/demo0" --out "$U/details_light" $TW --dpr 2
