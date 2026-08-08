#!/bin/sh
# yt-dlp breaks whenever YouTube changes its extraction, so the version baked into the
# image goes stale between deploys. Refresh it on every boot instead of on every rebuild.
# yt-dlp-ejs carries the signature/n-challenge solvers and goes stale the same way.
# Set YTDLP_AUTO_UPDATE=false to skip (e.g. offline or air-gapped environments).

set -e

if [ "${YTDLP_AUTO_UPDATE:-true}" = "true" ]; then
  echo "[Startup] Updating yt-dlp (current: $(yt-dlp --version 2>/dev/null || echo 'unknown'))..."
  if timeout "${YTDLP_UPDATE_TIMEOUT:-120}" /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade --quiet yt-dlp yt-dlp-ejs; then
    echo "[Startup] yt-dlp updated to $(yt-dlp --version 2>/dev/null || echo 'unknown')"
  else
    # Never block startup on this - a stale yt-dlp still serves everything already cached.
    echo "[Startup] yt-dlp update failed, continuing with $(yt-dlp --version 2>/dev/null || echo 'unknown')" >&2
  fi
else
  echo "[Startup] yt-dlp auto-update disabled (version: $(yt-dlp --version 2>/dev/null || echo 'unknown'))"
fi

exec "$@"
