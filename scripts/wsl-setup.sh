#!/usr/bin/env bash
# One-time setup of a Debian/Ubuntu (e.g. WSL) build environment for Prism's Linux bundles.
#   wsl -d Ubuntu-22.04 -u root -- bash scripts/wsl-setup.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q build-essential curl wget file git pkg-config libssl-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev patchelf rpm \
  ffmpeg xdg-utils desktop-file-utils ca-certificates
if ! command -v node >/dev/null || ! node --version | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -q nodejs
fi
command -v cargo >/dev/null || [ -x "$HOME/.cargo/bin/cargo" ] || \
  curl --proto '=https' -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
echo "build environment ready"
