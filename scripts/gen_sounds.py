"""Synthesize Prism's notification sounds (original, license-free) as 16-bit WAV."""
import math, struct, sys, wave
from pathlib import Path

RATE = 44100

def tone(freq, dur, start, amp, decay=6.0):
    """A soft bell-like partial stack with an exponential decay envelope."""
    out = []
    for i in range(int(dur * RATE)):
        t = i / RATE
        env = math.exp(-decay * t) * min(1.0, t / 0.006)  # 6 ms attack, no click
        s = (math.sin(2 * math.pi * freq * t)
             + 0.35 * math.sin(2 * math.pi * freq * 2.0 * t) * math.exp(-3 * t)
             + 0.12 * math.sin(2 * math.pi * freq * 3.01 * t) * math.exp(-5 * t))
        out.append((start + i, amp * env * s))
    return out

def render(notes, length, path):
    buf = [0.0] * int(length * RATE)
    for f, d, st, a in notes:
        for idx, v in tone(f, d, int(st * RATE), a):
            if idx < len(buf):
                buf[idx] += v
    peak = max(abs(x) for x in buf) or 1
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(32767 * 0.8 * x / peak)) for x in buf))

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
# Complete: rising major sixth (E5 -> C#6), airy and short.
render([(659.25, 1.2, 0.0, 0.7), (1108.73, 1.4, 0.11, 0.6)], 1.5, out / "complete.wav")
# Failed: gentle descending minor third (A4 -> F#4), lower and softer.
render([(440.0, 0.9, 0.0, 0.6), (369.99, 1.1, 0.16, 0.6)], 1.3, out / "failed.wav")
# Queue finished: three-note arpeggio (C5 E5 G5 + octave shimmer).
render([(523.25, 1.4, 0.0, 0.55), (659.25, 1.4, 0.1, 0.5), (783.99, 1.6, 0.2, 0.5), (1046.5, 1.6, 0.3, 0.25)], 1.9, out / "queue.wav")
print("ok")
