#!/bin/sh
# yt-dlp breaks whenever YouTube changes its extraction, so the version baked into the
# image goes stale between deploys. Refresh it on every boot instead of on every rebuild.
# yt-dlp-ejs carries the signature/n-challenge solvers and goes stale the same way.
# Set YTDLP_AUTO_UPDATE=false to skip (e.g. offline or air-gapped environments).

set -e

GATEWAY_DIR=/app/apps/audio-stream-gateway

if [ "${YTDLP_AUTO_UPDATE:-true}" = "true" ]; then
  echo "[Startup] Updating yt-dlp (current: $(yt-dlp --version 2>/dev/null || echo 'unknown'))..."
  if timeout "${YTDLP_UPDATE_TIMEOUT:-120}" /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade --quiet \
       yt-dlp yt-dlp-ejs bgutil-ytdlp-pot-provider; then
    echo "[Startup] yt-dlp updated to $(yt-dlp --version 2>/dev/null || echo 'unknown')"
  else
    # Never block startup on this - a stale yt-dlp still serves everything already cached.
    echo "[Startup] yt-dlp update failed, continuing with $(yt-dlp --version 2>/dev/null || echo 'unknown')" >&2
  fi
else
  echo "[Startup] yt-dlp auto-update disabled (version: $(yt-dlp --version 2>/dev/null || echo 'unknown'))"
fi

# Proof-of-origin tokens make the requests look less like automation. The plugin finds this
# server on its default port, so nothing needs passing to yt-dlp itself.
#
# Off by default because of what it costs: the BotGuard VM sits at ~144MiB resident, and a
# cache job has been measured peaking at 384MiB on its own when yt-dlp has to solve the
# signature challenge. On a 512MiB instance those do not both fit, and exceeding the limit
# kills the challenge solver rather than the container - which degrades extraction silently
# into "Requested format is not available" instead of failing honestly. Capping the V8 heap
# does not help; the memory is not in the old space. Enable it only on an instance with the
# headroom, or once the proxy alone has been shown to be insufficient.
if [ "${POT_PROVIDER_ENABLED:-false}" = "true" ]; then
  node --max-old-space-size="${POT_PROVIDER_HEAP_MB:-128}" /opt/bgutil/server/build/main.js >/tmp/bgutil.log 2>&1 &
  i=0
  while [ "$i" -lt 15 ]; do
    if curl -fsS --max-time 2 "http://127.0.0.1:${POT_PROVIDER_PORT:-4416}/ping" >/dev/null 2>&1; then
      echo "[Startup] PO token provider ready"
      break
    fi
    i=$((i + 1))
    sleep 1
  done
  if [ "$i" -ge 15 ]; then
    echo "[Startup] PO token provider did not respond; yt-dlp will run without tokens" >&2
  fi
fi

# YouTube's bot check follows the source address: the same request succeeds from a home
# connection and fails from shared cloud egress, with or without cookies. Cloudflare WARP
# gives a different exit for free, and wireproxy speaks WireGuard in userspace so no TUN
# device or NET_ADMIN is needed - a container here is granted neither.
#
# The manager runs in the background because finding a usable exit can take a few rounds,
# and the gateway should serve already-cached tracks while that happens. It publishes the
# proxy address to a file the server reads per download.
if [ "${WARP_PROXY_ENABLED:-false}" = "true" ]; then
  "$GATEWAY_DIR/warp-manager.sh" &
fi

cd "$GATEWAY_DIR"
exec "$@"
