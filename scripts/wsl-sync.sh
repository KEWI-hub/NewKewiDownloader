#!/usr/bin/env bash
# Copy the Windows checkout into the WSL filesystem (fast builds; /mnt/c is slow).
#   wsl -d Ubuntu-22.04 -u root -- bash /mnt/c/.../scripts/wsl-sync.sh /mnt/c/.../Download_Manager_Claude ~/prism
set -euo pipefail
SRC="$1"; DST="${2:-$HOME/prism}"
mkdir -p "$DST"
cd "$SRC"
tar --exclude=./target --exclude='./**/node_modules' --exclude=./app/dist --exclude=./extension/build \
    --exclude=./packaging/out --exclude=./app/src-tauri/gen --exclude=./.git -cf - . | (cd "$DST" && tar -xf -)
find "$DST" -name '*.sh' -exec sed -i 's/\r$//' {} +
echo "synced to $DST"
