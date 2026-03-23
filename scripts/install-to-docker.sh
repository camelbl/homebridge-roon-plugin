#!/usr/bin/env bash
# Install / update homebridge-roon-complete inside a Homebridge Docker container.
#
# How the official Homebridge Docker image works:
#   hb-service runs on start and calls `npm install --prefix /var/lib/homebridge`, reading
#   /var/lib/homebridge/package.json (= /homebridge/package.json on the volume). Any package
#   NOT listed there is pruned. We therefore register the plugin as a "file:" dependency in
#   that file — the same mechanism the UI uses for npm-registry plugins.
#
# Usage (on the Ubuntu host, from the plugin repo root after `npm run build`):
#   ./scripts/install-to-docker.sh
#   HOMEBRIDGE_CONTAINER=mycontainer ./scripts/install-to-docker.sh /path/to/homebridge-roon-plugin
#
set -euo pipefail

CONTAINER="${HOMEBRIDGE_CONTAINER:-homebridge}"
SRC="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# Where hb-service keeps the plugin store inside the container.
# This matches HB_SERVICE_STORAGE_PATH in /opt/homebridge/start.sh.
HB_STORE="/var/lib/homebridge"

if ! docker inspect "$CONTAINER" &>/dev/null; then
  echo "Container '$CONTAINER' not found. Set HOMEBRIDGE_CONTAINER or run: docker ps"
  exit 1
fi

if [[ ! -d "$SRC/dist" ]] || [[ ! -f "$SRC/package.json" ]]; then
  echo "Missing dist/ or package.json in $SRC — run: npm install && npm run build"
  exit 1
fi

# Resolve the host directory that backs the homebridge volume. Prefer writing
# directly to the host path so changes land on the real volume before the container
# starts again (docker cp can bypass the bind mount in some setups).
HOST_HB="$(docker inspect "$CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/homebridge"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"

# The plugin source lives inside the volume as a named sub-directory so the
# file: reference in package.json always resolves correctly.
PLUGIN_SUBDIR="homebridge-roon-complete-src"
PLUGIN_IN_CONTAINER="${HB_STORE}/${PLUGIN_SUBDIR}"

echo "[1/4] Copying plugin source into ${PLUGIN_SUBDIR} on the volume"
if [[ -n "$HOST_HB" && -d "$HOST_HB" ]]; then
  DEST="${HOST_HB}/${PLUGIN_SUBDIR}"
  echo "      -> host path: $DEST"
  mkdir -p "$DEST/dist"
  cp -a "$SRC/dist/." "$DEST/dist/"
  cp "$SRC/package.json" "$DEST/package.json"
  cp "$SRC/config.schema.json" "$DEST/config.schema.json"
else
  echo "      -> docker cp (no host bind mount found for /homebridge)"
  docker exec "$CONTAINER" mkdir -p "$PLUGIN_IN_CONTAINER/dist"
  docker cp "$SRC/dist/." "$CONTAINER:$PLUGIN_IN_CONTAINER/dist/"
  docker cp "$SRC/package.json" "$CONTAINER:$PLUGIN_IN_CONTAINER/package.json"
  docker cp "$SRC/config.schema.json" "$CONTAINER:$PLUGIN_IN_CONTAINER/config.schema.json"
fi

if ! docker exec "$CONTAINER" test -f "$PLUGIN_IN_CONTAINER/package.json"; then
  echo "ERROR: $PLUGIN_IN_CONTAINER/package.json not visible in container."
  exit 1
fi

echo "[2/4] Installing plugin's own npm dependencies (node-roon-api etc.)..."
docker exec "$CONTAINER" npm install --omit=dev --prefix "$PLUGIN_IN_CONTAINER"

echo "[3/4] Registering plugin in ${HB_STORE}/package.json via file: reference..."
# Read current package.json (create a minimal one if it doesn't exist yet), add/update
# the homebridge-roon-complete entry, and write it back.
docker exec "$CONTAINER" sh -c "
  PKG=${HB_STORE}/package.json
  if [ ! -f \"\$PKG\" ]; then
    echo '{\"private\":true,\"dependencies\":{}}' > \"\$PKG\"
  fi
  tmp=\$(mktemp)
  jq '.dependencies[\"homebridge-roon-complete\"] = \"file:./${PLUGIN_SUBDIR}\"' \"\$PKG\" > \"\$tmp\" && mv \"\$tmp\" \"\$PKG\"
  echo 'Updated package.json:'
  jq '.dependencies | keys' \"\$PKG\"
"

# Run npm install so the file: symlink is created in node_modules/ now (before restart).
docker exec "$CONTAINER" npm install \
  --prefix "$HB_STORE" \
  --omit=dev \
  --no-audit \
  --no-fund \
  2>&1 | grep -v "^npm warn\|^npm notice" || true

if ! docker exec "$CONTAINER" test -f "${HB_STORE}/node_modules/homebridge-roon-complete/package.json"; then
  echo "ERROR: node_modules/homebridge-roon-complete/package.json not found after npm install."
  echo "  Run manually: docker exec $CONTAINER npm install --prefix $HB_STORE"
  exit 1
fi

echo "[4/4] Restarting container..."
docker restart "$CONTAINER"
sleep 3

echo ""
echo "Checking post-restart..."
if docker exec "$CONTAINER" test -f "${HB_STORE}/node_modules/homebridge-roon-complete/package.json"; then
  echo "  plugin in node_modules: OK"
else
  echo "  WARNING: plugin disappeared from node_modules after restart — unexpected."
fi

LOADED="$(docker logs "$CONTAINER" 2>&1 | grep 'Loaded plugin: homebridge-roon-complete' | tail -1)"
if [[ -n "$LOADED" ]]; then
  echo "  $LOADED"
  echo ""
  echo "Done. Homebridge loaded the plugin successfully."
else
  echo "  'Loaded plugin: homebridge-roon-complete' not yet in log (may still be starting)."
  echo "  Run: docker logs $CONTAINER 2>&1 | grep -E 'homebridge-roon|RoonComplete|ERROR LOADING PLUGIN'"
fi
