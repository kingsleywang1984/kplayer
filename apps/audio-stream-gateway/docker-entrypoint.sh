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

# YouTube's bot check follows the source address: the same request succeeds from a home
# connection and fails from shared cloud egress, with or without cookies. Cloudflare WARP
# gives a different exit for free, and wireproxy speaks WireGuard in userspace so no TUN
# device or NET_ADMIN is needed - a container here is granted neither.
#
# Opt-in via WARP_PROXY_ENABLED=true. On success this exports YTDLP_PROXY, which is the
# only thing the server reads, so a paid proxy can be substituted by setting that directly.
WARP_PROXY_PORT="${WARP_PROXY_PORT:-40000}"
WARP_DIR=/tmp/warp

start_warp_proxy() {
  mkdir -p "$WARP_DIR"
  cd "$WARP_DIR"

  echo "[Startup] Enrolling a Cloudflare WARP identity..."
  if ! timeout "${WARP_SETUP_TIMEOUT:-60}" wgcf register --accept-tos >/dev/null 2>&1; then
    echo "[Startup] WARP registration failed" >&2
    return 1
  fi

  if ! timeout "${WARP_SETUP_TIMEOUT:-60}" wgcf generate >/dev/null 2>&1; then
    echo "[Startup] WARP profile generation failed" >&2
    return 1
  fi

  # wireproxy reads a WireGuard profile plus its own sections. MTU is not one of the keys
  # it understands, so drop it rather than let the whole profile be rejected.
  grep -v '^MTU' wgcf-profile.conf > wireproxy.conf
  cat >> wireproxy.conf <<EOF

[Socks5]
BindAddress = 127.0.0.1:${WARP_PROXY_PORT}
EOF

  wireproxy -c "$WARP_DIR/wireproxy.conf" >"$WARP_DIR/wireproxy.log" 2>&1 &

  # Confirm the tunnel actually carries traffic. A listening port only proves wireproxy
  # started; it says nothing about whether WARP came up behind it.
  i=0
  while [ "$i" -lt 20 ]; do
    if curl -fsS --max-time 5 --socks5-hostname "127.0.0.1:${WARP_PROXY_PORT}" \
         https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q '^warp=on'; then
      echo "[Startup] WARP proxy ready on 127.0.0.1:${WARP_PROXY_PORT}"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done

  echo "[Startup] WARP proxy did not come up; last log:" >&2
  tail -5 "$WARP_DIR/wireproxy.log" >&2 2>/dev/null || true
  return 1
}

if [ "${WARP_PROXY_ENABLED:-false}" = "true" ]; then
  if start_warp_proxy; then
    export YTDLP_PROXY="socks5://127.0.0.1:${WARP_PROXY_PORT}"
    echo "[Startup] yt-dlp will download through $YTDLP_PROXY"
  else
    # Fail open: without the proxy downloads behave exactly as they do today, which is
    # better than refusing to serve the tracks that are already cached.
    echo "[Startup] Continuing without a proxy - downloads may hit YouTube's bot check" >&2
  fi
elif [ -n "$YTDLP_PROXY" ]; then
  echo "[Startup] yt-dlp will download through the configured proxy"
fi

cd /app/apps/audio-stream-gateway
exec "$@"
