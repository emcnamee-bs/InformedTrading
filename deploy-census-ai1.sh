#!/usr/bin/env bash
# Deploy the Insider Census as its OWN podman container on Ai1, bind-mounting the SAME
# /app/state as the Fast99 agent container so it reads the poller-written spine.db and
# writes insider.db beside it.
#
# The census image is Node-18 + better-sqlite3 (built on Ai1 for the target ABI), runs the
# census-runner loop, calls NO Kalshi API and needs NO secrets (no PEM/.env mount).
#
# SAFETY: this is an outward-facing action (SSH + podman on the real Ai1 box). Nothing here
# runs until you invoke this script deliberately. It never places a trade — the census is
# paper-only and read-only toward Kalshi and the spine.
set -euo pipefail

HOST="${AI1_HOST:-emcnamee@100.107.15.75}"
SSH_KEY="${AI1_SSH_KEY:-$HOME/.ssh/ai1_deploy}"
REMOTE_DIR="/home/emcnamee/ai1-census"          # census source (separate from the agent's /home/emcnamee/ai1)
STATE_DIR="/home/emcnamee/ai1/state"            # SHARED with the Fast99 agent container (holds spine.db)
IMAGE="insider-census"
CONTAINER="insider-census"
REPO="$(cd "$(dirname "$0")" && pwd)"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
RSYNC_SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

echo "==> Secrets pre-flight (abort if any secret/state path is staged in git)"
if git -C "$REPO" diff --cached --name-only | grep -Eq '(\.env$|\.pem$|/kalshi_key|/state/|/\.census/|/logs/)'; then
  echo "REFUSING TO DEPLOY: a secret/state path is staged in git. Unstage it first." >&2
  exit 1
fi

echo "==> Confirm Ai1 reachability + arch (better-sqlite3 build target)"
ARCH="$($SSH "$HOST" 'uname -m')"
echo "    Ai1 arch: $ARCH"

echo "==> Rsync census source to $HOST:$REMOTE_DIR (excluding node_modules/secrets/local db)"
$SSH "$HOST" "mkdir -p $REMOTE_DIR"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude 'node_modules' --exclude '.git' --exclude '.census' \
  --exclude '.env' --exclude '*.pem' --exclude 'dist' --exclude 'docs' \
  "$REPO/src" "$REPO/package.json" "$REPO/package-lock.json" "$REPO/tsconfig.json" \
  "$REPO/census.Dockerfile" "$REPO/.dockerignore" \
  "$HOST:$REMOTE_DIR/"

echo "==> Build the census image on Ai1 (compiles better-sqlite3 for $ARCH/Node18)"
$SSH "$HOST" "cd $REMOTE_DIR && podman build -f census.Dockerfile -t $IMAGE ."

echo "==> (Re)start the census container, bind-mounting the shared state volume"
$SSH "$HOST" "podman rm -f $CONTAINER 2>/dev/null || true"
$SSH "$HOST" "mkdir -p $STATE_DIR && podman run -d --name $CONTAINER --restart=always \
  -e AI1_DB=/app/state/spine.db -e INSIDER_DB=/app/state/insider.db -e CENSUS_INTERVAL_SECONDS=600 \
  -v $STATE_DIR:/app/state $IMAGE"

echo "==> Deployed. Container status + first log lines:"
$SSH "$HOST" "podman ps --filter name=$CONTAINER --format '{{.Names}} {{.Status}}'"
sleep 3
$SSH "$HOST" "podman logs --tail 10 $CONTAINER 2>&1 || true"
echo "==> Done. Tail logs anytime: ssh -i $SSH_KEY $HOST podman logs -f $CONTAINER"
echo "    Halt without redeploy: ssh -i $SSH_KEY $HOST touch $STATE_DIR/HALT-CENSUS"
echo "    Read collected data:   ssh -i $SSH_KEY $HOST podman exec $CONTAINER npx tsx src/census/surfaceCli.ts --insider /app/state/insider.db"
