#!/usr/bin/env bash
set -euo pipefail

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ffmpeg -version | head -n 1
  ffprobe -version | head -n 1
  exit 0
fi

apt_opts=(
  -o Acquire::Retries=5
  -o Acquire::http::Timeout=30
  -o Acquire::https::Timeout=30
)

# GitHub-hosted Ubuntu runners normally use an Azure mirror. The mirror can
# throttle large ffmpeg dependency downloads. Prefer the public Ubuntu mirror
# for this bounded CI-only bootstrap when the binary is absent.
for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources; do
  if [ -f "$source" ]; then
    sudo sed -i 's|https\?://azure\.archive\.ubuntu\.com/ubuntu|http://archive.ubuntu.com/ubuntu|g' "$source"
  fi
done

sudo dpkg --configure -a || true
sudo timeout 180 apt-get "${apt_opts[@]}" update

for attempt in 1 2; do
  if sudo timeout 720 apt-get "${apt_opts[@]}" install -y --no-install-recommends ffmpeg; then
    ffmpeg -version | head -n 1
    ffprobe -version | head -n 1
    exit 0
  fi

  if [ "$attempt" = 2 ]; then
    echo "ffmpeg install failed after 2 bounded attempts" >&2
    exit 1
  fi

  echo "ffmpeg install attempt $attempt failed or timed out; repairing apt state before retry" >&2
  sudo dpkg --configure -a || true
  sudo apt-get clean
  sudo timeout 180 apt-get "${apt_opts[@]}" update
done
