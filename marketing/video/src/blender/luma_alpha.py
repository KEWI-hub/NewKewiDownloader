"""Convert a glow render on pure black into a straight-alpha PNG (luma key + unpremultiply).
alpha = brightest sRGB channel, colour = rgb / alpha, so "over" black it reproduces the
render exactly, and over any dark background it behaves like an additive/screen layer."""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255.0
a = im.max(axis=2)
a = np.where(a < 3 / 255, 0, a)  # clean the black floor
col = np.where(a[..., None] > 0, np.clip(im / np.maximum(a[..., None], 1e-4), 0, 1), 0)
out = np.dstack([col, a])
Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(dst)
print("alpha ->", dst)
