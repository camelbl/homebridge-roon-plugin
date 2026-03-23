# homebridge-roon-complete

Homebridge platform plugin that exposes Roon zones (Smart Speaker + volume/mute), Internet Radio stations, playlists, and genres as HomeKit accessories.

## Requirements

- Node.js 18+
- A Roon Core on the network
- In Roon: **Settings → Extensions**, enable **Homebridge Roon Complete** (first connection may require pairing)

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

The script copies `dist/`, `package.json`, and `config.schema.json` into **`/homebridge/node_modules/homebridge-roon-complete/`** (same tree as UI-installed plugins such as `homebridge-cmdswitch2`), runs `npm install --omit=dev` there, and restarts the container. If Docker reports a **host bind mount** for `/homebridge`, the script copies **into that host path** first (more reliable than `docker cp` alone). The official image often uses **`NODE_PATH=/homebridge/node_modules`**; **`npm install -g` is not used** because a global copy under `/opt/homebridge/lib/node_modules` may be ignored by the running Homebridge process.

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
         "roonPort": 9100,
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
| `roonPort` | WebSocket port (default `9100`) |
| `excludeZones` | Zone display names to hide from HomeKit |
| `includeRadio` / `includePlaylists` / `includeGenres` | Create per-zone switches (default `true`) |
| `radioStations` / `playlists` | If non-empty, only those titles are exposed |

## License

Apache-2.0
