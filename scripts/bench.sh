#!/usr/bin/env bash
# Benchmark Prism's engine against aria2c and curl on identical downloads.
#
#   ARIA2C=/path/to/aria2c bash scripts/bench.sh [--internet] > bench-results.md
#
# Local scenarios use prism-testserver (deterministic content, per-connection throttling,
# connection limits). Every result is verified by SHA-256 against the reference. Each tool
# writes to its own temp dir; timings are wall-clock from start to verified file on disk.
set -euo pipefail
cd "$(dirname "$0")/.."
ONLY="${BENCH_ONLY:-A B C D E}"   # e.g. BENCH_ONLY="D E"
wants() { [[ " $ONLY " == *" $1 "* ]]; }
ARIA2C="${ARIA2C:-aria2c}"
EXE=""; [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]] && EXE=".exe"
cargo build -q --release -p prism-testserver -p prism-engine --example prism-get
SERVER="target/release/prism-testserver$EXE"
PRISM="target/release/examples/prism-get$EXE"
TMP="$(mktemp -d)"
PORT=18900
SRV=""
trap 'kill $SRV 2>/dev/null || true; rm -rf "$TMP"' EXIT

now() { date +%s.%N; }
mib() { awk -v b="$1" 'BEGIN { printf "%.0f", b / 1048576 }'; }
rate() { awk -v b="$1" -v s="$2" 'BEGIN { printf "%.1f", b / 1048576 / s }'; }

start_server() {
  if [[ -n "$SRV" ]]; then kill $SRV 2>/dev/null || true; wait $SRV 2>/dev/null || true; fi
  PORT=$((PORT + 1))   # fresh port per scenario: never race a server that is shutting down
  "$SERVER" --port $PORT "$@" >/dev/null 2>&1 &
  SRV=$!
  for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/status/200" && return; sleep 0.1; done
}

# run <label> <tool> <url> <expected-sha256> <size>
run() {
  local label="$1" tool="$2" url="$3" want="$4" size="$5" dir="$TMP/$RANDOM" t0 t1 file got
  mkdir -p "$dir"
  local rc=0
  t0=$(now)
  case "$tool" in
    curl) curl -s -L -o "$dir/out" "$url"|| rc=$? ;;
    aria2c-16) "$ARIA2C" -q -x16 -s16 -k1M --file-allocation=none --allow-overwrite=true -d "$dir" -o out "$url"|| rc=$? ;;
    aria2c-8) "$ARIA2C" -q -x8 -s8 -k1M --file-allocation=none --allow-overwrite=true -d "$dir" -o out "$url"|| rc=$? ;;
    prism-16) "$PRISM" "$url" -c 16 -o "$dir" >/dev/null|| rc=$? ;;
    prism-8) "$PRISM" "$url" -c 8 -o "$dir" >/dev/null|| rc=$? ;;
  esac
  t1=$(now)
  file="$(find "$dir" -type f ! -name '*.prismpart' ! -name '*.aria2' | head -1)"
  got=""; [[ -n "$file" ]] && got="$(sha256sum "$file" | cut -c1-64)"
  local ok="✔"
  if (( rc != 0 )); then ok="✘ failed (exit $rc)"; elif [[ "$got" != "$want" ]]; then ok="✘ hash mismatch"; fi
  local secs; secs=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.2f", b - a }')
  printf "| %s | %s | %s s | %s MiB/s | %s |\n" "$label" "$tool" "$secs" "$(rate "$size" "$secs")" "$ok"
  rm -rf "$dir"
}

echo "| Scenario | Tool | Time | Average | Verified |"
echo "|---|---|---|---|---|"

# A: per-connection throttling (what CDNs and many servers do): 4 MiB/s per connection, 1 GiB.
if wants A; then
SIZE=$((1024 * 1048576))
start_server --throttle 4M
URL="http://127.0.0.1:$PORT/file/a.bin?size=$SIZE&seed=101"
WANT="$(curl -s "http://127.0.0.1:$PORT/file/a.bin?size=$SIZE&seed=101&throttle=0" | sha256sum | cut -c1-64)"
for t in curl aria2c-16 prism-16; do run "A · 1 GiB, 4 MiB/s per connection" "$t" "$URL" "$WANT" "$SIZE"; done
fi

# B: raw local throughput (no throttling): 2 GiB — measures CPU/disk efficiency.
if wants B; then
SIZE=$((2048 * 1048576))
start_server
URL="http://127.0.0.1:$PORT/file/b.bin?size=$SIZE&seed=202"
WANT="$(curl -s "$URL" | sha256sum | cut -c1-64)"
for t in curl aria2c-8 prism-8; do run "B · 2 GiB, unthrottled localhost" "$t" "$URL" "$WANT" "$SIZE"; done
fi

# C: server allows only 4 connections (503 beyond), 2 MiB/s each, 256 MiB.
SIZE=$((256 * 1048576))
if wants C; then
start_server --throttle 2M --max-conn 4 --limit-mode 503
URL="http://127.0.0.1:$PORT/file/c.bin?size=$SIZE&seed=303"
WANT="$(curl -s "http://127.0.0.1:$PORT/file/c.bin?size=$SIZE&seed=303&throttle=0" | sha256sum | cut -c1-64)"
for t in curl aria2c-16 prism-16; do run "C · 256 MiB, server max 4 connections (503)" "$t" "$URL" "$WANT" "$SIZE"; done
fi

# D: flaky server: 2% chance per chunk that a connection is dropped, 3 MiB/s each, 256 MiB.
if wants D; then
start_server --throttle 3M --drop-prob 0.02
URL="http://127.0.0.1:$PORT/file/d.bin?size=$SIZE&seed=404"
WANT="$(curl -s "http://127.0.0.1:$PORT/file/d.bin?size=$SIZE&seed=404&throttle=0&drop_prob=0" | sha256sum | cut -c1-64)"
for t in aria2c-16 prism-16; do run "D · 256 MiB, random connection drops" "$t" "$URL" "$WANT" "$SIZE"; done
fi

if [[ "${1:-}" == "--internet" ]] && wants E; then
  # E: real internet files (results depend on the line; run back-to-back).
  for url in "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.7.0-amd64-netinst.iso" \
             "https://ash-speed.hetzner.com/1GB.bin"; do
    size=$(curl -sIL "$url" | awk 'tolower($1)=="content-length:" {v=$2} END {gsub("\r","",v); print v}')
    [[ -n "$size" ]] || continue
    want="$(curl -sL "$url" | sha256sum | cut -c1-64)"
    for t in curl aria2c-16 prism-16; do run "E · $(basename "$url") ($(mib "$size") MiB, internet)" "$t" "$url" "$want" "$size"; done
  done
fi
