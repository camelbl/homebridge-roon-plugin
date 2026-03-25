# homebridge-roon-control

[![npm](https://img.shields.io/npm/v/homebridge-roon-control)](https://www.npmjs.com/package/homebridge-roon-control)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

Homebridge platform plugin that exposes **Roon music zones** to Apple HomeKit.

Each zone appears as a volume slider tile (Lightbulb with Brightness = volume, On/Off = play/stop). Optionally zones can also appear as Audio Receiver / TV tiles with volume accessible via iOS Control Center. Internet Radio, Playlists, and Genre switches are also supported.

## Features

- **Volume slider** per zone — Brightness controls volume (0–100 %), On/Off starts/stops playback
- **Zone controller** tile per zone (optional) — Audio Receiver or TV icon, play/stop button, volume in iOS Control Center
- **Internet Radio** switches — one switch per station per zone (optional)
- **Playlist** switches — one switch per playlist per zone (optional)
- **Genre** switches — one switch per genre per zone (optional)
- **Volume step switches** — +5 / -5 volume buttons per zone (optional)
- Automatic reconnect with exponential back-off when Roon Core connection drops
- Works with fixed IP/hostname or UDP auto-discovery

## Requirements

- Node.js ≥ 18
- Homebridge ≥ 1.6.0
- A running **Roon Core** reachable from the Homebridge host
- In Roon: **Settings → Extensions → enable "Homebridge Roon Control"**

## Installation

### Via Homebridge UI (recommended)

Search for **homebridge-roon-control** in the Homebridge plugin search and install.

### Manual

```bash
npm install -g homebridge-roon-control
```

## Configuration

Add the platform to your `config.json` (or configure via the Homebridge UI):

```json
{
  "platforms": [
    {
      "platform": "RoonControl",
      "name": "RoonControl",
      "roonHost": "192.168.1.10",
      "roonPort": 9330
    }
  ]
}
```

### All options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `roonHost` | string | — | Roon Core IP or hostname. Leave empty for UDP auto-discovery. |
| `roonPort` | number | `9330` | Roon extension WebSocket port. |
| `excludeZones` | string[] | `[]` | Zone display names to hide from HomeKit. |
| `includeVolumeFan` | boolean | `true` | Volume slider tile per zone (Lightbulb: Brightness = volume, On = play/stop). |
| `includeZoneControllers` | boolean | `false` | Zone controller tile per zone (Audio Receiver or TV icon). |
| `zoneDeviceType` | string | `"audioReceiver"` | Icon for zone controller tiles: `audioReceiver`, `tv`, `smartSpeaker`, `speaker`. |
| `includeVolumeLightbulb` | boolean | `false` | Second volume slider variant (legacy, use `includeVolumeFan` instead). |
| `includeVolumeStepSwitches` | boolean | `false` | Volume +5 / -5 step switches per zone. |
| `includeRadio` | boolean | `false` | Internet Radio switches per zone. |
| `includePlaylists` | boolean | `false` | Playlist switches per zone. |
| `includeGenres` | boolean | `false` | Genre switches per zone. |
| `radioPresetCount` | number | `5` | Max radio stations exposed (0 = all). |
| `genrePresetCount` | number | `5` | Max genres exposed (0 = all). |
| `radioStations` | string[] | `[]` | Explicit list of radio station names. Empty = use preset count. |
| `playlists` | string[] | `[]` | Explicit list of playlist names. Empty = all. |

### Minimal config (volume sliders only)

```json
{
  "platform": "RoonControl",
  "name": "RoonControl",
  "roonHost": "192.168.1.10",
  "roonPort": 9330,
  "includeVolumeFan": true,
  "includeZoneControllers": false,
  "includeRadio": false,
  "includePlaylists": false,
  "includeGenres": false
}
```

### Full config example

```json
{
  "platform": "RoonControl",
  "name": "RoonControl",
  "roonHost": "192.168.1.10",
  "roonPort": 9330,
  "excludeZones": ["myMacBook"],
  "includeVolumeFan": true,
  "includeZoneControllers": true,
  "zoneDeviceType": "audioReceiver",
  "includeRadio": true,
  "radioPresetCount": 5,
  "includePlaylists": false,
  "includeGenres": false
}
```

## HomeKit zones

| Tile type | HomeKit category | Controlled by |
|-----------|-----------------|---------------|
| Volume slider (`includeVolumeFan`) | Licht | Brightness = volume, On/Off = play/stop |
| Zone controller (`includeZoneControllers`) | Lautsprecher & TVs | On/Off = play/stop; volume via iOS Control Center |
| Radio / Playlist / Genre switch | Schalter | Tap = play that station/playlist/genre |
| Volume +/- switch | Schalter | Tap = change volume ±5 % |

## Pairing with Roon

1. Start Homebridge — the plugin connects to Roon automatically.
2. Open the **Roon desktop app** on the same machine as your Roon Core.
3. Go to **Settings → Extensions** — "Homebridge Roon Control" should appear.
4. Click **Enable**.
5. Homebridge log should show: `Roon: Core accepted the extension`.

**Token storage:** Roon pairing tokens are saved in `homebridge-roon-control-roonstate.json` under the Homebridge storage folder (not inside `config.json`). If pairing is lost, delete that file and re-enable the extension in Roon.

## Docker / NUC setup

If Homebridge runs in a Docker container and Roon Core runs on the **same** machine, the LAN IP often does not work from inside the container. Use one of:

- `"roonHost": "host.docker.internal"` — requires `extra_hosts: ["host.docker.internal:host-gateway"]` in `docker-compose.yml`
- The container's default gateway IP (find with `docker exec homebridge ip route | grep default`)
- Leave `roonHost` empty to use UDP discovery (may not work in all Docker configurations)

**Homebridge Supervisor / Docker install:**

```bash
git clone https://github.com/camelbl/homebridge-roon-plugin.git
cd homebridge-roon-plugin
npm install && npm run build
./scripts/install-to-docker.sh
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Timeout waiting for Roon Core` | Check `roonHost`/`roonPort`, enable extension in Roon → Settings → Extensions |
| Extension never appears in Roon | Verify log shows `Roon: Core accepted the extension`; check Docker networking |
| `Roon WebSocket failed` | Container can't reach Core — see Docker section above |
| Accessories disappear after restart | Plugin may not be registered; run `install-to-docker.sh` again |
| `InvalidItemKey` errors | Roon browse session issue; set `includeRadio`/`includeGenres`/`includePlaylists` to `false` if not needed |

For verbose Roon API logs, set environment variable `HOMEBRIDGE_ROON_DEBUG=1` on the Homebridge process.

## Development

```bash
npm install
npm run build      # compile TypeScript → dist/
npm run watch      # tsc --watch
```

## License

Apache-2.0
