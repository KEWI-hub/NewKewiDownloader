"""9:16 social cut: recut the finished 16:9 master on bar lines (edits.json "vertical"), put each
frame inset on a blurred, darkened cover-fill of itself and composite the vertical caption
layer (film/vertical.html rendered with alpha) on top. Video only — audio is cut in assemble.py.

    py post_vertical.py --master promo_master.mp4 --captions <dir of PNGs> --out vertical_video.mp4
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.environ.get("PYLIB", ""))
import cv2  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--master", required=True)
ap.add_argument("--captions", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--crf", type=int, default=12)
ap.add_argument("--recut", action="store_true", help="--master already holds the vertical segments back to back")
args = ap.parse_args()

EDITS = json.load(open(os.path.join(HERE, "..", "edits.json")))["vertical"]
FPS = 60
W, H = 1080, 1920
SW, SH = 1920, 1080
IN_W, IN_H = 1080, 608
IN_Y = (H - IN_H) // 2 - 10
R = 26
mask = np.zeros((IN_H, IN_W), np.float32)
cv2.rectangle(mask, (R, 0), (IN_W - R, IN_H), 1, -1)
cv2.rectangle(mask, (0, R), (IN_W, IN_H - R), 1, -1)
for cx, cy in [(R, R), (IN_W - R - 1, R), (R, IN_H - R - 1), (IN_W - R - 1, IN_H - R - 1)]:
    cv2.circle(mask, (cx, cy), R, 1, -1, lineType=cv2.LINE_AA)
mask2 = cv2.GaussianBlur(mask, (3, 3), 0)
edge = np.clip(cv2.dilate(mask2, np.ones((3, 3))) - cv2.erode(mask2, np.ones((3, 3))), 0, 1)[..., None]
mask = mask2[..., None]


def frames(start, dur):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.4f}", "-i", args.master, "-t", f"{dur:.4f}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = SW * SH * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(SH, SW, 3)
    p.wait()


enc = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-c:v", "libx264", "-preset", "medium", "-crf", str(args.crf), "-profile:v", "high", "-pix_fmt", "yuv420p", args.out], stdin=subprocess.PIPE)
tv = 0
total = sum(round((b - a) * FPS) for a, b in EDITS)
off = 0.0
for si, (a, b) in enumerate(EDITS):
    want = round((b - a) * FPS)
    got = 0
    src_a = off if args.recut else a
    off += b - a
    for fr in frames(src_a, b - a):
        if got >= want:
            break
        t = tv / FPS
        src = fr.astype(np.float32) / 255
        # cover fill, blurred & darkened
        sc = H / SH
        cov = cv2.resize(src, (int(SW * sc), H), interpolation=cv2.INTER_AREA)
        x0 = (cov.shape[1] - W) // 2
        bg = cov[:, x0:x0 + W]
        small = cv2.resize(bg, (W // 8, H // 8), interpolation=cv2.INTER_AREA)
        small = cv2.GaussianBlur(small, (0, 0), 5)
        bg = cv2.resize(small, (W, H), interpolation=cv2.INTER_LINEAR) * 0.42 + np.array([0.018, 0.006, 0.010], np.float32)
        out = bg.copy()
        # inset (hidden on the end card)
        ins_a = 1.0 if t < 14.2 else max(0.0, 1 - (t - 14.2) / 0.35)
        if ins_a > 0:
            ins = cv2.resize(src, (IN_W, IN_H), interpolation=cv2.INTER_AREA)
            region = out[IN_Y:IN_Y + IN_H]
            m = mask * ins_a
            region[:] = region * (1 - m) + ins * m + edge * 0.10 * ins_a
        cap_p = os.path.join(args.captions, f"{tv:05d}.png")
        cap = cv2.imread(cap_p, cv2.IMREAD_UNCHANGED)
        if cap is not None:
            ca = cap[..., 3:4].astype(np.float32) / 255
            out = out * (1 - ca) + cap[..., :3].astype(np.float32) / 255 * ca
        # fade in / out of the whole cut
        fade = min(1.0, t / 0.25, (total - tv) / (0.8 * FPS))
        out = out * max(0.0, fade)
        enc.stdin.write((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
        tv += 1
        got += 1
    while got < want:  # pad (never expected)
        enc.stdin.write(np.zeros((H, W, 3), np.uint8).tobytes())
        tv += 1
        got += 1
    print("segment", si, a, b, flush=True)
enc.stdin.close()
enc.wait()
print("done", args.out, tv, "frames")
