# homebridge-roon-complete

Homebridge platform plugin that exposes Roon zones (Smart Speaker + volume/mute), Internet Radio stations, playlists, and genres as HomeKit accessories.

## Requirements

- Node.js 18+
- A Roon Core on the network
- In Roon: **Settings → Extensions**, enable **Homebridge Roon Complete** (first connection may require pairing)

**Docker:** If Homebridge runs in a container and Roon Core runs on the **same** machine, `roonHost` set to the machine’s LAN IP (e.g. `192.168.1.12`) often causes `Roon WebSocket failed` because traffic from the container does not reach Core the same way. Use **`host.docker.internal`** (in Compose: `extra_hosts: ["host.docker.internal:host-gateway"]`), or the container’s **default gateway** IP (often `172.17.0.1`; check with `docker exec homebridge ip route`), or **clear `roonHost`** to try UDP discovery.

**Pairing / timeout:** Roon tokens are stored in **`homebridge-roon-complete-roonstate.json`** under the Homebridge storage folder (not inside `config.json`). If you see **Timeout waiting for Roon Core** for two minutes while TCP to the Core port works, delete that JSON file, remove any stray top-level **`roonstate`** key from `config.json`, restart Homebridge, then enable the extension again in **Roon → Settings → Extensions**. For verbose Roon API logs: set environment variable **`HOMEBRIDGE_ROON_DEBUG=1`** on the Homebridge process.

## Behaviour

- **Fixed `roonHost`:** If the WebSocket to the Core drops, the plugin reconnects with exponential backoff (about 2s–60s, with jitter). Homebridge logs show `Roon: WebSocket closed` and scheduled reconnect attempts. After Roon pairs again, browse lists and accessories are refreshed automatically.
- **Auto-discovery (empty `roonHost`):** Reconnect is handled by Roon’s discovery layer, not the same backoff path.
- **Transport commands** (play/pause/volume/mute): failures from Roon are logged as errors (`Roon … failed: …`).

## Installation (Homebridge Docker on Ubuntu)

### Quick install on the host (e.g. 192.168.1.12)

On the **Ubuntu server** (Docker and default container name `homebridge`):

1. Copy this repository onto the host (git clone, `scp -r`, or rsync), then:

   ```bash
   cd /path/to/homebridge-roon-plugin
   npm install
   npm run build
   ./scripts/install-to-docker.sh
   ```

2. If your container has another name:

   ```bash
   HOMEBRIDGE_CONTAINER=your_container_name ./scripts/install-to-docker.sh
   ```

The script:

1. Copies `dist/`, `package.json`, and `config.schema.json` into **`homebridge-roon-complete-src/`** inside the volume (directly via the bind-mount host path when available, so writes land on the real volume).
2. Runs `npm install --omit=dev` in that directory to fetch the Roon API dependencies.
3. **Registers the plugin in `/var/lib/homebridge/package.json`** using a `file:` reference — the same mechanism the Homebridge UI uses for npm-registry plugins. Without this step, the `hb-service` startup's `npm install` pass prunes any package not listed there, which is why earlier `docker cp`-only approaches kept disappearing after restart.
4. Runs `npm install --prefix /var/lib/homebridge` so the symlink into `node_modules/` is created immediately.
5. Restarts the container and verifies the plugin loads.

### Deploy from another machine (rsync)

1. Build on your development machine (or on the server):

   ```bash
   npm install
   npm run build
   ```

2. Copy the plugin into the Homebridge `node_modules` directory that is mounted into the container (the host path that maps to `/homebridge` in Docker):

   ```bash
   export HOMEBRIDGE_DEPLOY_HOST=your.server.ip
   export HOMEBRIDGE_DEPLOY_USER=your_ssh_user
   export HOMEBRIDGE_DEPLOY_PATH=/path/on/host/to/homebridge/node_modules
   export HOMEBRIDGE_DEPLOY_KEY=$HOME/.ssh/id_ed25519
   npm run deploy
   ```

   `HOMEBRIDGE_DEPLOY_PATH` must be the **host** filesystem path to the `node_modules` folder next to your Homebridge config (the same tree that appears as `/homebridge/node_modules` inside the container).  
   The SSH key path is on the machine **from which you run** `npm run deploy` (often your Mac). A key that only exists inside the container at `/homebridge/.ssh/id_ed25519` is useful for jobs running *inside* the container, not for rsync from another machine unless you copy that key or use agent forwarding.

3. Install production dependencies on the server if needed (Roon packages load from GitHub):

   ```bash
   cd /path/on/host/to/homebridge/node_modules/homebridge-roon-complete
   npm install --omit=dev
   ```

4. Register the platform in `config.json` (or Homebridge UI):

   ```json
   {
     "platforms": [
       {
         "platform": "RoonComplete",
         "name": "RoonComplete",
         "roonHost": "192.168.1.12",
         "roonPort": 9150,
         "excludeZones": [],
         "includeRadio": true,
         "includePlaylists": true,
         "includeGenres": true,
         "radioStations": [],
         "playlists": []
       }
     ]
   }
   ```

   Leave `roonHost` empty to use Roon’s automatic discovery (UDP) instead of a fixed IP.

5. Restart the Homebridge container.

## Development

- `npm run build` — compile TypeScript to `dist/`
- `npm run watch` — `tsc --watch`
- `make deploy` — build then run deploy script

## Configuration

| Key | Description |
| --- | --- |
| `roonHost` | Roon Core IP/hostname; omit for auto-discovery |
| `roonPort` | Extension WebSocket port Core advertises as `http_port` (default `9150`; some older cores use `9100` — check `ss -tlnp` on the Core host) |
| `excludeZones` | Zone display names to hide from HomeKit |
| `includeRadio` / `includePlaylists` / `includeGenres` | Create per-zone switches (default `true`) |
| `radioStations` / `playlists` | If non-empty, only those titles are exposed |

## License

Apache-2.0
