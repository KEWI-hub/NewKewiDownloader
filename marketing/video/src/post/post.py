"""Post-processing ("lens") pass: reads the frames rendered by film/render.mjs plus their
per-frame FX parameters and writes the finished picture to an encoder pipe.

Per frame: motion-blur (average of the sub-frames the stage rendered for fast moves),
impact camera shake + zoom punch, radial chromatic aberration, two-scale bloom,
flash, vignette, fade, animated film grain.

    py post.py --frames <dir> --from 0 --to 121.2 --out out.mp4 [--crf 12]
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.environ.get("PYLIB", ""))
import cv2  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--frames", required=True)
ap.add_argument("--from", dest="t0", type=float, default=0.0)
ap.add_argument("--to", dest="t1", type=float, default=121.2)
ap.add_argument("--out", required=True)
ap.add_argument("--crf", type=int, default=12)
ap.add_argument("--fps", type=int, default=60)
ap.add_argument("--ranges", default=None, help="a:b,c:d — write only these time ranges, back to back")
ap.add_argument("--png", default=None, help="write PNGs for these frame numbers instead (comma list)")
args = ap.parse_args()

W, H = 1920, 1080
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rr = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
VIG = (1 - 0.32 * np.clip(rr - 0.35, 0, None) ** 1.6)[..., None].astype(np.float32)
RNG = np.random.default_rng(7)
GRAIN = [RNG.standard_normal((H // 2, W // 2)).astype(np.float32) for _ in range(12)]


def load(path):
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    if im is None:
        raise FileNotFoundError(path)
    return im.astype(np.float32) / 255.0


def process(f):
    base = os.path.join(args.frames, f"{f:05d}")
    fxp = os.path.join(args.frames, "fx", f"{f:05d}.json")
    fx = json.load(open(fxp)) if os.path.exists(fxp) else {}
    mb = int(fx.get("mb", 1))
    if mb > 1 and os.path.exists(f"{base}_0.jpg"):
        img = sum(load(f"{base}_{i}.jpg") for i in range(mb)) / mb
    else:
        img = load(base + ".jpg")
    # --- camera: shake + zoom punch (slight overscan so edges never show)
    sx, sy, rot = fx.get("shake", [0, 0, 0])
    z = fx.get("zoom", 1.0)
    if abs(sx) + abs(sy) + abs(rot) > 0.05 or abs(z - 1) > 1e-4:
        over = 1 + (abs(sx) + abs(sy)) / 900
        M = cv2.getRotationMatrix2D((W / 2, H / 2), rot, z * over)
        M[0, 2] += sx
        M[1, 2] += sy
        img = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    # --- radial chromatic aberration (px at the frame edge)
    ca = float(fx.get("ca", 0.0)) + 0.6
    if ca > 0.3:
        b, g, r = cv2.split(img)
        k = ca / (W / 2)
        Mr = cv2.getRotationMatrix2D((W / 2, H / 2), 0, 1 + k)
        Mb = cv2.getRotationMatrix2D((W / 2, H / 2), 0, 1 - k)
        r = cv2.warpAffine(r, Mr, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        b = cv2.warpAffine(b, Mb, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        img = cv2.merge([b, g, r])
    # --- bloom (two scales on the bright parts)
    bl = float(fx.get("bloom", 0.35))
    if bl > 0:
        lum = img.max(axis=2, keepdims=True)
        hi = img * np.clip((lum - 0.55) / 0.45, 0, 1)
        small = cv2.resize(hi, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        b1 = cv2.GaussianBlur(small, (0, 0), 6)
        b2 = cv2.GaussianBlur(cv2.resize(small, (W // 16, H // 16), interpolation=cv2.INTER_AREA), (0, 0), 6)
        glow = cv2.resize(b1, (W, H), interpolation=cv2.INTER_LINEAR) * 0.7 + cv2.resize(b2, (W, H), interpolation=cv2.INTER_LINEAR) * 0.9
        img = img + glow * bl
    # --- flash (screen)
    fl = float(fx.get("flash", 0.0))
    if fl > 0.002:
        img = 1 - (1 - np.clip(img, 0, 1)) * (1 - fl * np.array([0.97, 0.95, 1.0], np.float32))
    # --- vignette, fade
    img = img * VIG
    fade = float(fx.get("fade", 1.0))
    if fade < 0.999:
        img = img * fade
    # --- grain (luma, 2x2 clumps, animated)
    g = cv2.resize(GRAIN[f % len(GRAIN)], (W, H), interpolation=cv2.INTER_LINEAR)
    g = np.roll(g, (f * 37) % H, axis=0)
    amp = 0.018 * (0.6 + 0.4 * (1 - np.clip(img.mean(axis=2), 0, 1)))
    img = img + (g * amp)[..., None]
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


f0 = round(args.t0 * args.fps)
f1 = round(args.t1 * args.fps)
if args.png:
    for f in [int(x) for x in args.png.split(",")]:
        cv2.imwrite(os.path.join(args.out, f"post_{f:05d}.png"), process(f))
    sys.exit(0)
cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(args.fps), "-i", "-",
       "-c:v", "libx264", "-preset", "medium", "-crf", str(args.crf), "-profile:v", "high", "-pix_fmt", "yuv420p", "-x264-params", "aq-mode=3:deblock=-1,-1", args.out]
p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
frame_list = range(f0, f1)
if args.ranges:
    frame_list = [f for r in args.ranges.split(",") for f in range(round(float(r.split(":")[0]) * args.fps), round(float(r.split(":")[1]) * args.fps))]
for f in frame_list:
    p.stdin.write(process(f).tobytes())
    if f % 300 == 0:
        print("post", f, flush=True)
p.stdin.close()
p.wait()
print("done", args.out)
