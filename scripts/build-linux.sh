#!/usr/bin/env bash
# Build Prism's Linux bundles (deb, rpm, AppImage) + extension packages.
#   bash scripts/build-linux.sh            (from the repo root, on Linux / WSL)
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
export APPIMAGE_EXTRACT_AND_RUN=1          # linuxdeploy without FUSE (WSL, containers)
export NO_STRIP=1                           # linuxdeploy's strip chokes on newer ELF sections
npm ci --prefix extension --no-audit --no-fund
npm run build --prefix extension
npm ci --prefix app --no-audit --no-fund
(cd app && npm run tauri:build -- --bundles deb,rpm,appimage)
ls -la target/release/bundle/*/
