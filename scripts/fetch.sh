#!/usr/bin/env bash
# Fetch the tracks the gateway could not.
#
# YouTube allows these downloads from a home connection and refuses them from the deployed
# gateway's cloud egress, so the download has to run here instead. This does it in the same
# container image the gateway uses, writing to the same R2 buckets, so nothing about the
# stored tracks differs from one fetched by the server itself.
#
#   ./scripts/fetch.sh                              everything queued, for every access code
#   ./scripts/fetch.sh --tenant oz                  only that access code's queue
#   ./scripts/fetch.sh --tenant oz dQw4w9WgXcQ      a specific video, without queueing first
#
# Queues say who wanted what, so draining them needs no --tenant. Naming a video does,
# unless only one access code is configured - otherwise it would be stored for everyone.
#
# Requires Docker and apps/audio-stream-gateway/.env with the R2 credentials.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/audio-stream-gateway/.env"
IMAGE=kplayer-fetch

die() { printf '\nError: %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 \
  || die "Docker is not installed. See https://docs.docker.com/get-docker/"

docker info >/dev/null 2>&1 \
  || die "Docker is installed but not running. Start Docker Desktop and try again."

if [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_ROOT/apps/audio-stream-gateway/.env.example" "$ENV_FILE"
  die "No .env found, so one was created from the example at
  $ENV_FILE
Fill in the R2 credentials and ACCESS_CODES, then run this again."
fi

# Downloads run from this machine's connection, which is the entire point - say so, so a
# failure here is not mistaken for the same block the gateway hits.
printf 'Fetching through this machine'\''s connection.\n'

# Only rebuilds when the gateway sources change; Docker caches the rest.
printf 'Preparing the image (first run takes a few minutes)...\n'
docker build -q -f "$REPO_ROOT/apps/audio-stream-gateway/Dockerfile" -t "$IMAGE" "$REPO_ROOT" >/dev/null \
  || die "Image build failed."

# The entrypoint is kept, not overridden: it refreshes yt-dlp before running the command,
# and a stale one fails every download with a 403 - the exact failure this script exists to
# avoid. It ends by exec'ing whatever command is passed, so the worker runs after the
# refresh rather than instead of it.
if docker run --rm --env-file "$ENV_FILE" \
     "$IMAGE" node src/fetchWorker.js "$@"; then
  printf '\nDone. The tracks are in the library - pull to refresh in the app.\n'
else
  printf '\nSome downloads failed. The queue keeps them, so running this again is safe.\n' >&2
  exit 1
fi
