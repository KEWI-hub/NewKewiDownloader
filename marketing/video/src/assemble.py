"""Final assembly with ffmpeg: audio mastering (EQ + 2-pass loudnorm to -14 LUFS / -1 dBTP),
promo master (post.py), H.264 deliverables, bar-aligned teaser and 9:16 recuts, poster frame.

    py assemble.py --work <scratch dir> [steps...]
steps: audio promo teaser vertical poster   (default: all)
Expects: <work>/frames (film/render.mjs), <work>/audio/mix_raw.wav (audio/compose.py),
         <work>/vcap (film/render.mjs --page vertical.html --transparent ...).
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.abspath(os.path.join(HERE, ".."))
ap = argparse.ArgumentParser()
ap.add_argument("--work", required=True)
ap.add_argument("steps", nargs="*")
args = ap.parse_args()
W = args.work
STEPS = args.steps or ["audio", "promo", "teaser", "vertical", "poster"]
TL = json.load(open(os.path.join(HERE, "timeline.json")))
EDITS = json.load(open(os.path.join(HERE, "edits.json")))
DUR = TL["duration"]
PY = sys.executable
ENV = dict(os.environ, PYLIB=os.path.join(W, "pylib"))
VENC = ["-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-level:v", "4.2", "-pix_fmt", "yuv420p", "-r", "60",
        "-b:v", "20M", "-maxrate", "25M", "-bufsize", "40M", "-x264-params", "aq-mode=3", "-g", "120", "-bf", "3"]
AENC = ["-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2"]


def run(cmd, **kw):
    print("$", " ".join(str(c) for c in cmd)[:240], flush=True)
    return subprocess.run(cmd, check=True, **kw)


def loudnorm(src, dst, pre="", target=-14.0):
    """2-pass EBU R128 normalisation (linear when possible)"""
    chain = (pre + "," if pre else "")
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", src, "-af", chain + f"loudnorm=I={target}:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    m = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S).group(0))
    ln = (f"loudnorm=I={target}:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-af", chain + ln + ",aresample=48000", "-c:a", "pcm_s24le", dst])


def two_pass(inputs, out, extra_in=(), vf=None, af=None, maps=None, dur=None):
    log = os.path.join(W, "x264pass")
    base = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + list(inputs)
    filt = []
    if vf:
        filt += ["-vf", vf] if not maps else []
    common = []
    if maps:
        common += ["-filter_complex", maps[0]] + sum([["-map", m] for m in maps[1:]], [])
    elif vf:
        common += ["-vf", vf]
    if af and not maps:
        common += ["-af", af]
    if dur:
        common += ["-t", f"{dur:.3f}"]
    run(base + common + VENC + ["-pass", "1", "-passlogfile", log, "-an", "-f", "mp4", os.devnull if os.name != "nt" else "NUL"])
    run(base + common + VENC + ["-pass", "2", "-passlogfile", log] + AENC + ["-movflags", "+faststart", out])


master = os.path.join(W, "promo_master.mp4")
audio = os.path.join(W, "audio", "promo_audio.wav")

if "audio" in STEPS:
    # gentle tone shaping on the master: dip the low-mid mud, a touch of air
    loudnorm(os.path.join(W, "audio", "mix_raw.wav"), audio, pre="equalizer=f=170:t=q:w=1.0:g=-2.5,highshelf=f=9000:g=1.5")

if "promo" in STEPS:
    # post pass in parallel chunks, then a lossless concat
    nchunk = 4
    edges = [round(DUR * 60 * k / nchunk) / 60 for k in range(nchunk + 1)]
    procs, parts = [], []
    for k in range(nchunk):
        part = os.path.join(W, f"master_part{k}.mp4")
        parts.append(part)
        procs.append(subprocess.Popen([PY, os.path.join(HERE, "post", "post.py"), "--frames", os.path.join(W, "frames"), "--from", f"{edges[k]:.4f}", "--to", f"{edges[k + 1]:.4f}", "--out", part, "--crf", "12"], env=ENV))
    for p_ in procs:
        assert p_.wait() == 0
    lst = os.path.join(W, "master_parts.txt")
    open(lst, "w").write("".join("file '" + p_.replace(os.sep, "/") + "'" + chr(10) for p_ in parts))
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", master])
    two_pass(["-i", master, "-i", audio], os.path.join(OUTDIR, "prism-promo-2min.mp4"), maps=None, dur=DUR,
             vf="null", af="afade=t=out:st=%.2f:d=0.6" % (DUR - 0.6))


def recut(segs, vin, out, fade_out=0.8):
    """bar-aligned cut list -> one file (video from vin, audio from the mastered promo audio)"""
    parts = []
    fc = []
    for i, (a, b) in enumerate(segs):
        fc.append(f"[0:v]trim=start={a}:end={b},setpts=PTS-STARTPTS[v{i}]")
        fc.append(f"[1:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,afade=t=in:d=0.006,afade=t=out:st={b - a - 0.012:.3f}:d=0.012[a{i}]")
        parts.append(f"[v{i}][a{i}]")
    total = sum(b - a for a, b in segs)
    fc.append("".join(parts) + f"concat=n={len(segs)}:v=1:a=1[vc][ac]")
    fc.append(f"[vc]fade=t=in:d=0.25,fade=t=out:st={total - fade_out:.3f}:d={fade_out}[v]")
    fc.append(f"[ac]afade=t=in:d=0.25,afade=t=out:st={total - fade_out:.3f}:d={fade_out}[a]")
    tmp = out + ".tmp.mkv"
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", vin, "-i", audio, "-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]",
         "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s24le", tmp])
    aud = out + ".aud.wav"
    loudnorm(tmp, aud)
    two_pass(["-i", tmp, "-i", aud], out, maps=["[0:v]null[v]", "[v]", "1:a"], dur=total)
    os.remove(tmp)
    os.remove(aud)


if "teaser" in STEPS:
    recut(EDITS["teaser"], master, os.path.join(OUTDIR, "prism-teaser-30s.mp4"))

if "vertical" in STEPS:
    vvid = os.path.join(W, "vertical_video.mp4")
    # inset source: the same segments rendered without typography (film/render.mjs --notext → <work>/frames_clean)
    vsrc = os.path.join(W, "vertical_src.mp4")
    rng_ = ",".join(f"{a}:{b}" for a, b in EDITS["vertical"])
    run([PY, os.path.join(HERE, "post", "post.py"), "--frames", os.path.join(W, "frames_clean"), "--ranges", rng_, "--out", vsrc, "--crf", "12"], env=ENV)
    run([PY, os.path.join(HERE, "post", "post_vertical.py"), "--master", vsrc, "--recut", "--captions", os.path.join(W, "vcap"), "--out", vvid], env=ENV)
    # audio: same bar-aligned cut of the promo audio, laid under the composited picture
    segs = EDITS["vertical"]
    fc = []
    parts = ""
    for i, (a, b) in enumerate(segs):
        fc.append(f"[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,afade=t=in:d=0.006,afade=t=out:st={b - a - 0.012:.3f}:d=0.012[a{i}]")
        parts += f"[a{i}]"
    total = sum(b - a for a, b in segs)
    fc.append(parts + f"concat=n={len(segs)}:v=0:a=1,afade=t=in:d=0.25,afade=t=out:st={total - 0.8:.3f}:d=0.8[a]")
    vaud = os.path.join(W, "audio", "vertical_raw.wav")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", audio, "-filter_complex", ";".join(fc), "-map", "[a]", "-c:a", "pcm_s24le", vaud])
    vaud2 = os.path.join(W, "audio", "vertical_audio.wav")
    loudnorm(vaud, vaud2)
    two_pass(["-i", vvid, "-i", vaud2], os.path.join(OUTDIR, "prism-vertical-20s.mp4"), maps=["[0:v]null[v]", "[v]", "1:a"], dur=total)

if "poster" in STEPS:
    t = float(os.environ.get("POSTER_T", "10.6"))
    f = round(t * 60)
    run([PY, os.path.join(HERE, "post", "post.py"), "--frames", os.path.join(W, "frames"), "--out", W, "--png", str(f)], env=ENV)
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", os.path.join(W, f"post_{f:05d}.png"), os.path.join(OUTDIR, "prism-promo-poster-frame.png")])

print("assembly done:", STEPS)
