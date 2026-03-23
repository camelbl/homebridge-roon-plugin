import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './constants';
import { RoonConnection } from './roonConnection';
import { ZoneAccessory } from './accessories/zoneAccessory';
import { RadioAccessory } from './accessories/radioAccessory';
import { PlaylistAccessory } from './accessories/playlistAccessory';
import { GenreAccessory } from './accessories/genreAccessory';

export interface RoonCompleteConfig extends PlatformConfig {
  roonHost?: string;
  roonPort?: number;
  excludeZones?: string[];
  includeRadio?: boolean;
  includePlaylists?: boolean;
  includeGenres?: boolean;
  radioStations?: string[];
  playlists?: string[];
}

export class RoonCompletePlatform implements DynamicPlatformPlugin {
  private readonly accessoryByUuid = new Map<string, PlatformAccessory>();
  private readonly wired = new Set<string>();
  private roon: RoonConnection | null = null;
  private prevZoneKey: string | null = null;

  constructor(
    public readonly log: Logger,
    public readonly config: RoonCompleteConfig,
    public readonly api: API,
  ) {
    if (!this.config) {
      return;
    }
    this.api.on('didFinishLaunching', () => {
      void this.onLaunch();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessoryByUuid.set(accessory.UUID, accessory);
  }

  private async onLaunch(): Promise<void> {
    const c = this.config;
    const port =
      typeof c.roonPort === 'number'
        ? c.roonPort
        : c.roonPort != null && String(c.roonPort).trim() !== ''
          ? Number(c.roonPort)
          : undefined;
    this.roon = new RoonConnection({
      roonHost: typeof c.roonHost === 'string' && c.roonHost.trim() !== '' ? c.roonHost.trim() : undefined,
      roonPort: Number.isFinite(port as number) ? (port as number) : undefined,
      persistDir: this.api.user.storagePath(),
    });
    this.roon.on('status', (msg: string) => this.log.info(msg));
    this.roon.on('error', (e: unknown) => this.log.error(String(e)));
    this.roon.on('disconnected', () => this.log.warn('Roon: WebSocket closed (reconnecting if roonHost is set)'));
    this.roon.on('reconnecting', (info: { attempt: number; delayMs: number }) => {
      this.log.warn(`Roon: reconnect attempt ${info.attempt} in ${Math.ceil(info.delayMs / 1000)}s`);
    });
    this.roon.on('reconnected', () => {
      void this.onRoonReconnected();
    });

    try {
      await this.roon.connect();
    } catch (e) {
      this.log.error('Roon connect failed:', e);
      return;
    }

    this.roon.onZoneUpdate(() => {
      if (this.zoneTopologyChanged()) {
        void this.onZoneTopologyChanged();
      }
    });

    await this.roon.refreshBrowseLists().catch((e) => this.log.warn('Browse lists:', e));
    await this.syncAccessories();
    this.prevZoneKey = [...this.roon.getZones().map((z) => z.zone_id)].sort().join('|');
  }

  private zoneTopologyChanged(): boolean {
    if (!this.roon) return false;
    const key = [...this.roon.getZones().map((z) => z.zone_id)].sort().join('|');
    if (key === this.prevZoneKey) return false;
    this.prevZoneKey = key;
    return true;
  }

  private async onZoneTopologyChanged(): Promise<void> {
    if (!this.roon) return;
    await this.roon.refreshBrowseLists().catch((e) => this.log.warn('Browse lists:', e));
    await this.syncAccessories();
  }

  /** After WebSocket loss + unpair, Roon paired again — refresh browse caches and accessories. */
  private async onRoonReconnected(): Promise<void> {
    if (!this.roon) return;
    this.log.info('Roon: session restored — refreshing browse lists and accessories');
    this.prevZoneKey = null;
    await this.roon.refreshBrowseLists().catch((e) => this.log.warn('Browse lists:', e));
    await this.syncAccessories();
    this.prevZoneKey = [...this.roon.getZones().map((z) => z.zone_id)].sort().join('|');
  }

  private excluded(name: string): boolean {
    const ex = this.config.excludeZones ?? [];
    return ex.includes(name);
  }

  private desiredUuids(): Map<string, { name: string; setup: (acc: PlatformAccessory) => void }> {
    const out = new Map<string, { name: string; setup: (acc: PlatformAccessory) => void }>();
    if (!this.roon) return out;

    const zones = this.roon.getZones().filter((z) => !this.excluded(z.display_name));
    const { Categories } = this.api.hap.Accessory;

    for (const z of zones) {
      const zu = this.api.hap.uuid.generate(`${PLUGIN_NAME}:zone:${z.zone_id}`);
      out.set(zu, {
        name: z.display_name,
        setup: (acc) => {
          acc.context = { kind: 'zone', zoneId: z.zone_id, zoneDisplayName: z.display_name };
          acc.category = Categories.SPEAKER;
          if (!this.wired.has(zu)) {
            this.wired.add(zu);
            new ZoneAccessory(this.log, this.api, acc, this.roon!, z.zone_id);
          }
        },
      });
    }

    const incR = this.config.includeRadio !== false;
    const incP = this.config.includePlaylists !== false;
    const incG = this.config.includeGenres !== false;
    const filterRadio = this.config.radioStations ?? [];
    const filterPl = this.config.playlists ?? [];

    let radios = incR ? this.roon.getRadioStations() : [];
    if (filterRadio.length) radios = radios.filter((t) => filterRadio.includes(t));

    let playlists = incP ? this.roon.getPlaylists() : [];
    if (filterPl.length) playlists = playlists.filter((t) => filterPl.includes(t));

    const genres = incG ? this.roon.getGenres() : [];

    for (const z of zones) {
      for (const station of radios) {
        const u = this.api.hap.uuid.generate(`${PLUGIN_NAME}:radio:${z.zone_id}:${station}`);
        out.set(u, {
          name: `Musik ${station} ${z.display_name}`,
          setup: (acc) => {
            acc.context = { kind: 'radio', zoneId: z.zone_id, zoneDisplayName: z.display_name, itemTitle: station };
            acc.category = Categories.SWITCH;
            if (!this.wired.has(u)) {
              this.wired.add(u);
              new RadioAccessory(this.log, this.api, acc, this.roon!, z.zone_id, z.display_name, station);
            }
          },
        });
      }
      for (const pl of playlists) {
        const u = this.api.hap.uuid.generate(`${PLUGIN_NAME}:playlist:${z.zone_id}:${pl}`);
        out.set(u, {
          name: `Musik ${pl} ${z.display_name}`,
          setup: (acc) => {
            acc.context = { kind: 'playlist', zoneId: z.zone_id, zoneDisplayName: z.display_name, itemTitle: pl };
            acc.category = Categories.SWITCH;
            if (!this.wired.has(u)) {
              this.wired.add(u);
              new PlaylistAccessory(this.log, this.api, acc, this.roon!, z.zone_id, z.display_name, pl);
            }
          },
        });
      }
      for (const g of genres) {
        const u = this.api.hap.uuid.generate(`${PLUGIN_NAME}:genre:${z.zone_id}:${g}`);
        out.set(u, {
          name: `Musik ${g} ${z.display_name}`,
          setup: (acc) => {
            acc.context = { kind: 'genre', zoneId: z.zone_id, zoneDisplayName: z.display_name, itemTitle: g };
            acc.category = Categories.SWITCH;
            if (!this.wired.has(u)) {
              this.wired.add(u);
              new GenreAccessory(this.log, this.api, acc, this.roon!, z.zone_id, z.display_name, g);
            }
          },
        });
      }
    }

    return out;
  }

  private async syncAccessories(): Promise<void> {
    if (!this.roon) return;

    const desired = this.desiredUuids();
    const visibleZones = this.roon.getZones().filter((z) => !this.excluded(z.display_name));
    this.log.info(
      `RoonComplete: HomeKit sync — ${visibleZones.length} Roon zone(s) → ${desired.size} accessories (zones + optional radio/playlist/genre switches). If 0 zones, Roon has no zones or all are in excludeZones.`,
    );

    for (const [uuid, acc] of [...this.accessoryByUuid.entries()]) {
      if (!desired.has(uuid)) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
        this.accessoryByUuid.delete(uuid);
        this.wired.delete(uuid);
      }
    }

    for (const [uuid, meta] of desired.entries()) {
      let acc = this.accessoryByUuid.get(uuid);
      if (!acc) {
        acc = new this.api.platformAccessory(meta.name, uuid);
        this.accessoryByUuid.set(uuid, acc);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
        meta.setup(acc);
      } else {
        acc.displayName = meta.name;
        if (!this.wired.has(uuid)) {
          meta.setup(acc);
        }
      }
    }
  }
}
