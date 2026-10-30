# Benchmarks

Prism's engine (`prism-get`, the engine's CLI example — the app uses the same engine) versus
**aria2c 1.37.0** and **curl** on identical downloads. Every result is verified by SHA-256
against the server's content. Reproduce with:

```bash
ARIA2C=/path/to/aria2c bash scripts/bench.sh --internet      # BENCH_ONLY="A B" to pick scenarios
```

**Machine:** Windows 11, 16 logical CPUs, 61 GB RAM, NVMe SSD; internet line ≈ 200 Mbit/s.
**Server:** `prism-testserver` on localhost (deterministic content, per-connection throttling,
connection limits, fault injection) for A–D; public servers for E.

> **Why no IDM numbers?** IDM is closed-source and Windows-only, so it can't run in the same
> scripted harness. Measurements from a machine with a licensed copy are welcome — open an
> issue with your results.

## Results (2026-10-15)

| Scenario | Tool | Time | Average | Verified |
|---|---|---|---|---|
| A · 1 GiB, 4 MiB/s per connection | curl | 256.06 s | 4.0 MiB/s | ✔ |
| A · 1 GiB, 4 MiB/s per connection | aria2c -x16 -s16 | 16.79 s | 61.0 MiB/s | ✔ |
| A · 1 GiB, 4 MiB/s per connection | **Prism, 16 conns** | 16.82 s | 60.9 MiB/s | ✔ |
| B · 2 GiB, unthrottled localhost | curl | 3.05 s | 671.5 MiB/s | ✔ |
| B · 2 GiB, unthrottled localhost | aria2c -x8 -s8 | 6.33 s | 323.5 MiB/s | ✔ |
| B · 2 GiB, unthrottled localhost | **Prism, 8 conns** | 1.99 s | **1029.1 MiB/s** | ✔ |
| C · 256 MiB, server allows 4 connections (503 beyond), 2 MiB/s each | curl | 128.05 s | 2.0 MiB/s | ✔ |
| C · same | aria2c -x16 | 32.11 s | 8.0 MiB/s | ✔ |
| C · same | **Prism, 16 conns** | 32.14 s | 8.0 MiB/s (= theoretical max) | ✔ |
| D · 256 MiB, 2 % chance per chunk that a connection drops | aria2c -x16 | — | — | ✘ gave up (exit 1) |
| D · same | **Prism, 16 conns** | 6.79 s | 37.7 MiB/s | ✔ completed |
| E · Debian 13.7 netinst ISO, 756 MiB, cdimage.debian.org | curl | 29.17 s | 25.9 MiB/s | ✔ |
| E · same | aria2c -x16 | 30.00 s | 25.2 MiB/s | ✔ |
| E · same | **Prism, 16 conns** | 30.07 s | 25.1 MiB/s | ✔ |

## Reading the numbers

* **A — per-connection throttling** (what most CDNs and mirrors do): segmentation is the whole
  game; Prism reaches 95 % of the theoretical 64 MiB/s, on par with aria2 and 15× faster than
  a single connection.
* **B — raw efficiency:** with no network bottleneck Prism writes 2 GiB in 2.0 s
  (1029 MiB/s): positioned writes into the final file, no assembly copy, large buffers. It is
  3.2× faster than aria2c and 1.5× faster than single-stream curl.
* **C — servers that limit connections:** Prism detects the limit (503 on extra
  connections), settles on 4 connections without failing and hits the theoretical maximum.
* **D — very unreliable server** (on average a drop every ~50 chunks per connection): aria2c
  aborts; Prism retries every dropped range immediately, keeps all connections busy and
  finishes with a correct file.
* **E — real internet:** all tools saturate the ~200 Mbit/s line; segmentation can't beat the
  line itself. On servers that throttle per connection (scenario A) the difference is 15×.

## In-app measurements (real Prism app, Windows)

| Download | Result |
|---|---|
| 64 MiB from a 4 MiB/s-per-connection server via the UI | 29.3 MiB/s average incl. probe and start, SHA-256 ✔ |
| 2 GiB, 16 connections × 1.5 MiB/s, with a live 2 MiB/s limit, pause and resume | 23.4 MiB/s unlimited, 2.0 MiB/s limited, SHA-256 ✔ after pause/resume |
| Browser click (Chromium + extension) → Prism "Download File" window | 257 ms, file SHA-256 ✔ |
| YouTube 720p60 (Big Buck Bunny) via the accelerated path | 181 MB, H.264 + AAC + cover + metadata, muxed by ffmpeg ✔ |
| BitTorrent: Debian 13.7 netinst (793 MB) | < 40 s, SHA-256 matches Debian's SHA256SUMS ✔ |
