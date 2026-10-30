# Prism — launch film

| File | What | Spec |
|---|---|---|
| `prism-promo-2min.mp4` | Main promo film, about 2 minutes | 1920×1080, 60 fps, H.264 High (2-pass, about 20 Mbit/s), AAC 320 kbit/s 48 kHz stereo, −14 LUFS / −1 dBTP |
| `prism-teaser-30s.mp4` | 30 s recut of the strongest moments (cut on bar lines) | same |
| `prism-vertical-20s.mp4` | 9:16 social cut with native vertical captions and end card | 1080×1920, 60 fps, same codecs |
| `prism-promo-poster-frame.png` | Poster/thumbnail frame from the film | 1920×1080 |
| `storyboard.md` | Shot list with timings, type, and sound for every beat | |
| `../keyvisual/` | 4K key-visual stills of the 3D prism (plus portrait, square and alpha variants) | see its README |

Everything in the film was made for it. There is no stock footage, no third-party music and no
samples. The UI you see is the **real Prism UI**, captured frame by frame from the app's browser
demo.

## How it was made

```
src/timeline.json           one clock for picture and sound (100 BPM: beat 0.6 s, bar 2.4 s)
src/blender/prism_scene.py  procedural 3D scene (Blender 5.2, Cycles + OptiX): key visuals + film plates
src/capture/uicap.mjs       real-UI capture with a virtual clock (Playwright + Chromium)
src/film/                   HTML/CSS/Canvas motion engine: 7 scenes, kinetic type, 2.5D windows
src/post/post.py            "lens" pass: motion blur, shake, chromatic aberration, bloom, grain
src/audio/compose.py        original score + sound design synthesized in numpy/scipy
src/assemble.py             ffmpeg mastering and encodes (promo, teaser, vertical, poster)
src/edits.json              bar-aligned cut lists for the teaser and the vertical cut
```

1. **3D (Blender, `prism_scene.py`).** The scene is built entirely in code: a beveled glass
   prism (Principled BSDF with transmission and Cycles dispersion), a beam and rays made of
   emissive tubes whose reveal, tail and falloff are driven from shader values, an emissive
   backdrop glow, softbox strips that only the glass sees (light linking), and compositor bloom
   and streaks. Ray directions come from Snell's law on the real prism geometry with exaggerated
   dispersion. Each frame is posed by a pure function of time, so any frame range can be
   re-rendered on its own. Every frame also exports its projected 2D geometry (beam, rays, prism
   silhouette) as JSON. The 2D layers use it to lock sparks to the rays and to put the app icon
   exactly on the prism's silhouette in the outro. Shots:
   * `coldopen` (12.6 s): beam, hit, orbit.
   * `bridge` (9 s): a locked camera where the y=0 plane maps linearly to pixels, so the 16 rays
     bend exactly into the HTML lanes at `y = 252 + 38·k`.
   * `outro` (5.4 s): rays retract and the prism turns to the camera.
   All shots render at 1080p60 in Cycles with 64 spp and the OptiX denoiser, at about 2.5 s per
   frame on an RTX 4060 Laptop GPU. Volumetrics were tested and dropped: they were too slow and
   too noisy for animation.
2. **Real UI (`uicap.mjs`).** The demo backend animates with `setInterval` ticks plus CSS
   transitions, so the script injects a virtual clock before the app loads. `setTimeout`,
   `setInterval`, `requestAnimationFrame`, `Date` and `performance.now` all follow that clock,
   and every Web Animation is paused and seeked. Each captured frame is exactly 1/60 s of app
   time, which gives smooth, reproducible plates of:
   * the details window with live lanes,
   * the main list,
   * the Download File, completion and video dialogs, and the mini window,
   * the six accents, light and dark themes, and the scheduler and grabber sheets.
3. **Motion engine (`src/film`).** A single 1920×1080 HTML stage. `FILM.render(t)` poses all
   7 scenes for time `t`, which is a pure function. It provides:
   * a kinetic-type library (`KText`): per-letter rise/mask, snap, zoom, split, rays, track,
     scramble, flip, glitch and crawl, with exits and beat pulses;
   * rolling odometer digits;
   * analytic particles, closed-form in time;
   * neon lanes;
   * a glass-shatter transition (about 120 clipped 3D shards of a snapshot frame);
   * floating glass windows in CSS 3D.
   For every frame, `render.mjs` captures a JPEG from headless Chromium, using 4 pages in
   parallel. It also captures motion-blur sub-frames when a scene reports fast motion, and writes
   the per-frame post-FX parameters. Impacts in the timeline drive the camera shake,
   zoom punch and chromatic aberration.
4. **Post (`post.py`).** Averages the sub-frames, then applies camera shake, zoom punch, radial
   chromatic aberration, two-scale bloom, flash, vignette, fade and animated grain, and pipes the
   result to x264.
5. **Sound (`compose.py`).** An original D-minor cinematic-electronic piece at 100 BPM:
   * Instruments: supersaw pads, plucked arpeggios with ping-pong delay, sidechained sub bass,
     synthesized kick, snare, clap and hats, FM bells, and a lead hook.
   * Arrangement: intro drone, sparse "problem" section, drop at 21.6 s, tape-stop when the plug
     is pulled, and a D-major resolution on the final icon.
   * Sound design: about 40 procedural effects (impacts, sub drops, risers, reverse swells,
     whooshes, glass shimmer and shatter, data zips, UI clicks and blips, power down/up, chimes).
     Each one is placed at its timeline event.
   * Mix: convolution reverb with synthetic IRs, a bus compressor and a look-ahead limiter
     driven to −14 LUFS (pyloudnorm). Final 2-pass ffmpeg `loudnorm` to −14 LUFS / −1 dBTP.
6. **Assembly (`assemble.py`).** Produces the promo (2-pass H.264). The teaser and vertical are
   recut from the master **on bar lines**, so the music never skips a beat. The vertical
   composites the master inset over a blurred cover-fill, plus its own caption layer
   (`film/vertical.html`, rendered with alpha).

## Re-render

Requirements: Blender 5.2, Node 24 with Playwright (the repo's `extension/node_modules`),
Python 3.12 with numpy, scipy and Pillow, ffmpeg. Also `opencv-python-headless` and
`pyloudnorm`, installed into a scratch dir and passed as `PYLIB`.

```bash
WORK=/path/to/scratch            # big intermediates (~6 GB frames)
pip install --target $WORK/pylib opencv-python-headless pyloudnorm
# 1. 3D plates (≈1 h on an RTX 4060) and key visuals
bash src/blender/render_film_shots.sh $WORK/bl 64
bash src/blender/render_keyvisuals.sh 192
# 2. real UI plates (the demo must be running: npm --prefix app run dev → :1420)
bash src/capture/capture_all.sh $WORK/ui
py -c "from PIL import Image; Image.open('design/screens/app-torrent-dark.png').crop((380,150,1060,750)).save('$WORK/ui/torrent_crop.png')"
# 3. film frames (+ vertical captions)
node src/film/render.mjs --work $WORK --out $WORK/frames --from 0 --to 121.2 --workers 4
node src/film/render.mjs --work $WORK --out $WORK/vcap --page vertical.html --w 1080 --h 1920 --transparent --from 0 --to 20.4
for r in "2.4 9.6" "21.6 26.4" "31.2 33.6" "111.6 117.6"; do set -- $r   # type-free inset source for the 9:16 cut
  node src/film/render.mjs --work $WORK --out $WORK/frames_clean --from $1 --to $2 --notext 1; done
# 4. music + sound design
PYLIB=$WORK/pylib py src/audio/compose.py --out $WORK/audio/mix_raw.wav
# 5. master + deliverables
PYLIB=$WORK/pylib py src/assemble.py --work $WORK            # audio promo teaser vertical poster
```

Preview single frames while you work:
`node src/film/render.mjs --work $WORK --out $WORK/prev --preview 4.8,21.7,31.3`.
Editing a time in `timeline.json` moves the picture and the sound together.

## Facts used on screen

* All benchmark numbers come from `docs/benchmarks.md`: 15× = scenario A (61.8 vs 4.0 MiB/s,
  1 GiB, 4 MiB/s per connection), 966 MiB/s = scenario B (2 GiB in 2.12 s), up to 32 connections,
  crash-safe resume, and the measured 257 ms from a browser click to Prism.
* The browser and video site are generic mock-ups: no browser or site logos or brand marks.
  The video player plays the film itself.
* The demo content is fictional (example.com hosts). Big Buck Bunny, in the real video
  dialog's thumbnail, is a CC BY Blender open movie.
