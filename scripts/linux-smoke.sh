#!/usr/bin/env bash
# Smoke test of an installed Linux build (deb/rpm): native host auto-launches the app,
# a browser-style "download" message is handled and the file's SHA-256 is verified.
#   bash scripts/linux-smoke.sh            (needs a display: WSLg, X11 or Wayland session)
set -euo pipefail
cd "$(dirname "$0")/.."
export PRISM_DATA_DIR=/tmp/prism-smoke/data
DL=/tmp/prism-smoke/dl
rm -rf /tmp/prism-smoke && mkdir -p "$PRISM_DATA_DIR" "$DL"
cargo build -q --release -p prism-testserver
./target/release/prism-testserver --port 18766 >/tmp/prism-smoke/server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; pkill -x prism 2>/dev/null || true' EXIT

# Pre-seed settings: no capture dialog, downloads go to $DL.
python3 - <<PY
import json, sqlite3, subprocess, time, os
# First start creates the database; then patch settings.
p = subprocess.Popen(["prism", "--background"], env=dict(os.environ))
for _ in range(100):
    if os.path.exists("$PRISM_DATA_DIR/ipc.json"): break
    time.sleep(0.1)
p.terminate(); p.wait(timeout=10)
db = sqlite3.connect("$PRISM_DATA_DIR/prism.db")
s = {"general": {"showCaptureDialog": False, "showCompletionDialog": False}, "downloads": {"defaultDir": "$DL", "useCategoryFolders": False}, "onboardingDone": True}
db.execute("INSERT OR REPLACE INTO settings(key, value) VALUES ('settings', ?)", (json.dumps(s),))
db.commit()
PY
rm -f "$PRISM_DATA_DIR/ipc.json"

python3 - <<'PY'
import hashlib, json, os, struct, subprocess, time, urllib.request
url = "http://127.0.0.1:18766/file/linux-smoke.bin?size=50331648&seed=9&throttle=8M"
host = subprocess.Popen(["prism-native-host", "chrome-extension://mmcdeiglkbfbicdjboocmhehodogilfl/"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
def ask(msg):
    data = json.dumps(msg).encode()
    t = time.perf_counter()
    host.stdin.write(struct.pack("=I", len(data)) + data); host.stdin.flush()
    n = struct.unpack("=I", host.stdout.read(4))[0]
    r = json.loads(host.stdout.read(n))
    print(f"  {msg['type']}: {(time.perf_counter()-t)*1000:.0f} ms -> {json.dumps(r)[:160]}")
    return r
assert ask({"id": "1", "type": "hello", "protocol": 1, "browser": "chrome"})["ok"]   # auto-launches prism
r = ask({"id": "2", "type": "download", "url": url, "referrer": "https://example.com/", "filename": "linux-smoke.bin", "method": "GET"})
assert r["accepted"], r
path = "/tmp/prism-smoke/dl/linux-smoke.bin"
for _ in range(300):
    if os.path.exists(path) and os.path.getsize(path) == 50331648 and not os.path.exists(path + ".prismpart"):
        break
    time.sleep(0.2)
got = hashlib.sha256(open(path, "rb").read()).hexdigest()
want = hashlib.sha256(urllib.request.urlopen(url.replace("&throttle=8M", "")).read()).hexdigest()
assert got == want, (got, want)
print("  download verified:", got[:16], "…")
host.stdin.close(); host.wait(timeout=5)
print("LINUX SMOKE PASSED")
PY
