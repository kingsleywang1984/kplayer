#!/bin/sh
# Keeps a working Cloudflare WARP exit available to yt-dlp.
#
# Enrolling with WARP draws an address from Cloudflare's pool. YouTube accepts some of them
# and refuses others, so a fresh enrolment on every boot is a dice roll - and this service
# is restarted often. This does three things about that:
#
#   1. Reuses a stored identity, so a known-good exit survives a restart.
#   2. Proves an exit works by actually downloading audio through it, not by checking that
#      a port is open. An exit can pass extraction and then serve 403 on the media, which
#      is the failure that started all of this.
#   3. Re-draws until one passes, and re-checks periodically, because an exit that works
#      now can be flagged later.
#
# It runs in the background so the gateway serves cached tracks immediately, and publishes
# the proxy URL to a file the server reads at download time.

WARP_DIR=/tmp/warp
PROXY_FILE="$WARP_DIR/proxy.url"
ACCOUNT_FILE="$WARP_DIR/wgcf-account.toml"
GATEWAY_DIR=/app/apps/audio-stream-gateway

PORT="${WARP_PROXY_PORT:-40000}"
MAX_ATTEMPTS="${WARP_MAX_ATTEMPTS:-5}"
RECHECK_MINUTES="${WARP_RECHECK_MINUTES:-30}"
# Any stable, non-age-restricted video works; this only has to prove the exit is usable.
PROBE_VIDEO="${WARP_PROBE_VIDEO:-dQw4w9WgXcQ}"

log() { echo "[WARP] $*"; }

PID_FILE="$WARP_DIR/wireproxy.pid"

stop_wireproxy() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null
    rm -f "$PID_FILE"
    sleep 1
  fi
}

build_config() {
  cd "$WARP_DIR" || return 1
  rm -f wgcf-profile.conf
  timeout 60 wgcf generate >/dev/null 2>&1 || return 1

  # wireproxy does not understand MTU and rejects the whole profile over it.
  grep -v '^MTU' wgcf-profile.conf > wireproxy.conf

  if [ "${WARP_IPV6:-true}" != "true" ]; then
    sed -i -E 's|^(Address = [0-9.]+/32), .*|\1|' wireproxy.conf
    log "tunnel restricted to IPv4"
  fi

  cat >> wireproxy.conf <<EOF

[Socks5]
BindAddress = 127.0.0.1:${PORT}
EOF
}

start_wireproxy() {
  wireproxy -c "$WARP_DIR/wireproxy.conf" >"$WARP_DIR/wireproxy.log" 2>&1 &
  echo $! > "$PID_FILE"
}

tunnel_up() {
  i=0
  while [ "$i" -lt 20 ]; do
    if curl -fsS --max-time 5 --socks5-hostname "127.0.0.1:${PORT}" \
         https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q '^warp=on'; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

# A listening socket proves nothing, and neither does successful extraction: the first exit
# that got this far still answered 403 when the media was actually requested. So pull real
# bytes through the whole path.
exit_is_usable() {
  bytes=$(timeout 90 yt-dlp -f bestaudio/best -o - --no-warnings \
            --proxy "socks5://127.0.0.1:${PORT}" \
            "https://www.youtube.com/watch?v=${PROBE_VIDEO}" 2>"$WARP_DIR/probe.err" \
          | head -c 65536 | wc -c | tr -d ' ')
  [ -n "$bytes" ] && [ "$bytes" -ge 32768 ]
}

probe_failure_reason() {
  grep -oE "Sign in to confirm[^.]*|HTTP Error [0-9]+[^\"]{0,30}|ERROR: [^\"]{0,80}" \
    "$WARP_DIR/probe.err" 2>/dev/null | head -1
}

establish_exit() {
  mkdir -p "$WARP_DIR"
  cd "$WARP_DIR" || return 1

  attempt=1
  while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    if [ ! -f "$ACCOUNT_FILE" ]; then
      log "enrolling a new WARP identity (attempt ${attempt}/${MAX_ATTEMPTS})"
      if ! timeout 60 wgcf register --accept-tos >/dev/null 2>&1; then
        log "registration failed"
        attempt=$((attempt + 1))
        sleep 5
        continue
      fi
    else
      log "reusing the stored WARP identity (attempt ${attempt}/${MAX_ATTEMPTS})"
    fi

    stop_wireproxy
    if build_config && start_wireproxy && tunnel_up; then
      if exit_is_usable; then
        echo "socks5://127.0.0.1:${PORT}" > "$PROXY_FILE"
        log "exit verified - downloads will go through it"
        # Only persist an identity that has actually been proven end to end.
        if node "$GATEWAY_DIR/scripts/warp-state.js" save "$ACCOUNT_FILE" 2>/dev/null; then
          log "identity stored for reuse across restarts"
        fi
        return 0
      fi
      log "exit rejected by YouTube: $(probe_failure_reason)"
    else
      log "tunnel did not come up"
    fi

    # Whatever identity this was, it is not usable - discard it and draw another.
    rm -f "$ACCOUNT_FILE" "$WARP_DIR/wgcf-profile.conf"
    attempt=$((attempt + 1))
  done

  stop_wireproxy
  rm -f "$PROXY_FILE"
  log "no usable exit after ${MAX_ATTEMPTS} attempts - downloads will go out directly"
  return 1
}

mkdir -p "$WARP_DIR"
rm -f "$PROXY_FILE"

if node "$GATEWAY_DIR/scripts/warp-state.js" load "$ACCOUNT_FILE" 2>/dev/null; then
  log "loaded a stored WARP identity from R2"
else
  log "no stored WARP identity"
fi

establish_exit

# An exit that passes now can be flagged later, so keep checking. Re-establishing costs
# seconds and does not interrupt anything already cached.
while [ "$RECHECK_MINUTES" -gt 0 ]; do
  sleep $((RECHECK_MINUTES * 60))
  if [ -f "$PROXY_FILE" ] && exit_is_usable; then
    continue
  fi
  log "periodic check failed: $(probe_failure_reason)"
  rm -f "$PROXY_FILE" "$ACCOUNT_FILE"
  establish_exit
done
