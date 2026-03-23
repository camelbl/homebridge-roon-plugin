#!/usr/bin/env bash
# Install / update homebridge-roon-complete inside a Homebridge Docker container.
#
# Official Homebridge Docker often sets NODE_PATH=/homebridge/node_modules, so plugins must live
# next to e.g. homebridge-cmdswitch2 — not only under $(npm root -g) for another user. This script
# installs only under /homebridge/node_modules/homebridge-roon-complete (no npm install -g).
#
# Usage (on the Ubuntu host, from the plugin repo root after `npm run build`):
#   ./scripts/install-to-docker.sh
#   HOMEBRIDGE_CONTAINER=mycontainer ./scripts/install-to-docker.sh /path/to/homebridge-roon-plugin
#
# Or copy the repo to the server first, then:
#   cd /path/to/homebridge-roon-plugin && npm ci && npm run build && ./scripts/install-to-docker.sh
#
set -euo pipefail

CONTAINER="${HOMEBRIDGE_CONTAINER:-homebridge}"
SRC="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
TARGET="/homebridge/node_modules/homebridge-roon-complete"

if ! docker inspect "$CONTAINER" &>/dev/null; then
  echo "Container '$CONTAINER' not found. Set HOMEBRIDGE_CONTAINER or run: docker ps"
  exit 1
fi

if [[ ! -d "$SRC/dist" ]] || [[ ! -f "$SRC/package.json" ]]; then
  echo "Missing dist/ or package.json in $SRC — run: npm install && npm run build"
  exit 1
fi

echo "[1/3] Copying built plugin into container $CONTAINER:$TARGET (from $SRC)"

docker exec "$CONTAINER" mkdir -p "$TARGET/dist"
docker cp "$SRC/dist/." "$CONTAINER:$TARGET/dist/"
docker cp "$SRC/package.json" "$CONTAINER:$TARGET/package.json"
docker cp "$SRC/config.schema.json" "$CONTAINER:$TARGET/config.schema.json"

if ! docker exec "$CONTAINER" test -f "$TARGET/package.json"; then
  echo "ERROR: $TARGET/package.json missing right after docker cp."
  echo "  Check: docker ps (container name), volume is not read-only, SRC paths exist on host."
  exit 1
fi

echo "[2/3] npm install dependencies in plugin folder (needs network for GitHub Roon deps)..."
docker exec "$CONTAINER" npm install --omit=dev --prefix "$TARGET"

echo "[3/3] Restarting container (brief Homebridge outage)..."
docker restart "$CONTAINER"

echo "Done."
echo "If you still see 'No plugin was found for the platform RoonComplete':"
echo "  1. If config.json has a top-level \"plugins\" array (plugin whitelist), add: \"homebridge-roon-complete\""
echo "  2. Check: docker exec $CONTAINER test -f $TARGET/package.json && docker logs $CONTAINER 2>&1 | grep 'Loaded plugin: homebridge-roon'"
echo "  3. Smoke test: docker exec $CONTAINER node -e \"require('$TARGET')\""
echo "  4. Full log: docker logs $CONTAINER 2>&1 | grep -E 'homebridge-roon|RoonComplete|ERROR LOADING PLUGIN'"
