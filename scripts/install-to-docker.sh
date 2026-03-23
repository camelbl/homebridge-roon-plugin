#!/usr/bin/env bash
# Install / update homebridge-roon-complete inside a Homebridge Docker container.
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

echo "Installing into container $CONTAINER:$TARGET (from $SRC)"

docker exec "$CONTAINER" mkdir -p "$TARGET/dist"
docker cp "$SRC/dist/." "$CONTAINER:$TARGET/dist/"
docker cp "$SRC/package.json" "$CONTAINER:$TARGET/package.json"
docker cp "$SRC/config.schema.json" "$CONTAINER:$TARGET/config.schema.json"

echo "Running npm install (GitHub Roon deps need outbound network in container)..."
docker exec "$CONTAINER" npm install --omit=dev --prefix "$TARGET"

# Homebridge discovers plugins via require paths and $(npm -g prefix)/lib/node_modules — not
# /homebridge/node_modules by default. Global install must use the SAME user as the Homebridge
# process or npm may target a different prefix than at runtime (root vs abc/homebridge).
HB_USER="$(docker exec "$CONTAINER" sh -c 'ps -o user= -p 1 2>/dev/null | head -1' | tr -d ' \r\n')"
HB_USER="${HB_USER:-root}"
echo "Registering plugin in global node_modules (as user: $HB_USER, same as PID 1)..."
docker exec -u "$HB_USER" "$CONTAINER" npm install -g "$TARGET"

echo "Restarting container (brief Homebridge outage)..."
docker restart "$CONTAINER"

echo "Done."
echo "If you still see 'No plugin was found for the platform RoonComplete':"
echo "  1. If config.json has a top-level \"plugins\" array (plugin whitelist), add: \"homebridge-roon-complete\""
echo "  2. Check startup log for: Loaded plugin: homebridge-roon-complete"
echo "  3. Smoke test: docker exec -u $HB_USER $CONTAINER node -e \"require('homebridge-roon-complete')\""
echo "  4. Full log: docker logs $CONTAINER 2>&1 | grep -E 'homebridge-roon|RoonComplete|ERROR LOADING PLUGIN'"
