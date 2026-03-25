import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './constants';
import { RoonConnection } from './roonConnection';
import { ZoneAccessory } from './accessories/zoneAccessory';
import { RadioAccessory } from './accessories/radioAccessory';
import { PlaylistAccessory } from './accessories/playlistAccessory';
import { GenreAccessory } from './accessories/genreAccessory';
import { VolumeLightbulbAccessory } from './accessories/volumeLightbulbAccessory';
import { VolumeFanAccessory } from './accessories/volumeFanAccessory';

export interface RoonCompleteConfig extends PlatformConfig {
  roonHost?: string;
  roonPort?: number;
  excludeZones?: string[];
  includeRadio?: boolean;
  includePlaylists?: boolean;
  includeGenres?: boolean;
  zoneDeviceType?: 'tv' | 'smartSpeaker' | 'speaker';
  /** Expose extra per-zone volume slider as a Lightbulb (Brightness = volume, On = mute). */
  includeVolumeLightbulb?: boolean;
  /** Expose extra per-zone volume slider as a Fan v2 (RotationSpeed = volume, Active = mute). */
  includeVolumeFan?: boolean;
  /** Expose per-zone play/pause tile (TV service). Disable for minimal HomeKit UI. */
  includeZoneControllers?: boolean;
  /** Expose per-zone +5/-5 volume step switch tiles. Disable for minimal HomeKit UI. */
  includeVolumeStepSwitches?: boolean;
  /**
   * If > 0: expose only the first N radio stations / genres (as presets).
   * If 0: expose all.
   */
  radioPresetCount?: number;
  genrePresetCount?: number;
  radioStations?: string[];
  playlists?: string[];
}

export class RoonCompletePlatform implements DynamicPlatformPlugin {
  private readonly accessoryByUuid = new Map<string, PlatformAccessory>();
  private readonly wired = new Set<string>();
  private roon: RoonConnection | null = null;
  private prevZoneKey: string | null = null;
  private readonly radioPresetCurrentByZone = new Map<string, string>();
  private readonly genrePresetCurrentByZone = new Map<string, string>();

  constructor(
    public readonly log: Logger,
    public readonly config: RoonCompleteConfig,
    public readonly api: API,
  ) {
    if (!this.config) {
      return;
    }
    this.api.on('didFinishLaunching', () => {
      void this.onLaunch().catch((e) => this.log.error('RoonComplete: startup failed:', e));
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessoryByUuid.set(accessory.UUID, accessory);
  }

  private async onLaunch(): Promise<void> {
    const c = this.config;
    // #region agent log
    const __dbgPayload = {sessionId:'579cc3',runId:'run-2',hypothesisId:'H6',location:'src/platform.ts:64',message:'debug probe onLaunch',data:{roonHost:c.roonHost,roonPort:c.roonPort},timestamp:Date.now()};
    fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify(__dbgPayload)}).catch(()=>{});
    fetch('http://host.docker.internal:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify(__dbgPayload)}).catch(()=>{});
    // #endregion
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

    // Register zone speakers immediately. refreshBrowseLists() can take minutes (deep Roon browse);
    // if it ran first, no accessories appeared in Homebridge/Home until it finished or hung.
    await this.syncAccessories();
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
    await this.syncAccessories();
    await this.roon.refreshBrowseLists().catch((e) => this.log.warn('Browse lists:', e));
    await this.syncAccessories();
  }

  /** After WebSocket loss + unpair, Roon paired again — refresh browse caches and accessories. */
  private async onRoonReconnected(): Promise<void> {
    if (!this.roon) return;
    this.log.info('Roon: session restored — refreshing browse lists and accessories');
    this.prevZoneKey = null;
    await this.syncAccessories();
    await this.roon.refreshBrowseLists().catch((e) => this.log.warn('Browse lists:', e));
    await this.syncAccessories();
    this.prevZoneKey = [...this.roon.getZones().map((z) => z.zone_id)].sort().join('|');
  }

  /** Homebridge UI can store list fields as non-arrays; guard to avoid sync throwing before any log line. */
  private asStringList(value: unknown): string[] {
    return Array.isArray(value) ? (value.filter((x) => typeof x === 'string') as string[]) : [];
  }

  private excluded(name: string): boolean {
    return this.asStringList(this.config.excludeZones).includes(name);
  }

  private getRadioPresetStations(): string[] {
    if (!this.roon) return [];
    const incR = this.config.includeRadio === true;
    if (!incR) return [];

    let radios = this.roon.getRadioStations();
    const filterRadio = this.asStringList(this.config.radioStations);

    // If user provided an explicit filter list: treat that list as the preset set.
    if (filterRadio.length) {
      return radios.filter((t) => filterRadio.includes(t));
    }

    const presetCount = typeof this.config.radioPresetCount === 'number' ? this.config.radioPresetCount : 5;
    if (presetCount > 0) {
      radios = radios.slice(0, presetCount);
    }
    return radios;
  }

  private getGenrePresetGenres(): string[] {
    if (!this.roon) return [];
    const incG = this.config.includeGenres === true;
    if (!incG) return [];

    let genres = this.roon.getGenres();
    const presetCount = typeof this.config.genrePresetCount === 'number' ? this.config.genrePresetCount : 5;
    if (presetCount > 0) {
      genres = genres.slice(0, presetCount);
    }
    return genres;
  }

  private desiredUuids(): Map<string, { name: string; setup: (acc: PlatformAccessory) => void }> {
    const out = new Map<string, { name: string; setup: (acc: PlatformAccessory) => void }>();
    if (!this.roon) return out;

    const zones = this.roon.getZones().filter((z) => !this.excluded(z.display_name));
    const { Categories } = this.api.hap.Accessory;
    const zoneDeviceType = this.config.zoneDeviceType ?? 'tv';
    const includeVolLightbulb = this.config.includeVolumeLightbulb === true;
    const includeVolFan = this.config.includeVolumeFan === true;
    const includeZoneControllers = this.config.includeZoneControllers === true;
    const includeVolumeStepSwitches = this.config.includeVolumeStepSwitches === true;
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H2',location:'src/platform.ts:185',message:'desiredUuids config snapshot',data:{zoneDeviceType,includeVolLightbulb,includeVolFan,includeZoneControllers,includeVolumeStepSwitches,includeRadio:this.config.includeRadio,includePlaylists:this.config.includePlaylists,includeGenres:this.config.includeGenres,zoneNames:zones.map((z)=>z.display_name)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    for (const z of zones) {
      const zu = this.api.hap.uuid.generate(`${PLUGIN_NAME}:zone:${z.zone_id}`);
      if (includeZoneControllers) {
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H4',location:'src/platform.ts:193',message:'adding zone controller accessory',data:{zoneId:z.zone_id,zoneName:z.display_name,uuid:zu,zoneDeviceType},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        out.set(zu, {
          name: z.display_name,
          setup: (acc) => {
            acc.context = { kind: 'zone', zoneId: z.zone_id, zoneDisplayName: z.display_name };
            acc.category =
              zoneDeviceType === 'tv'
                ? Categories.TELEVISION
                : zoneDeviceType === 'speaker'
                  ? Categories.SPEAKER
                  : Categories.SPEAKER;
            if (!this.wired.has(zu)) {
              this.wired.add(zu);
              new ZoneAccessory(this.log, this.api, acc, this.roon!, z.zone_id, zoneDeviceType);
            }
          },
        });
      }

      if (includeVolLightbulb) {
        // Use a new UUID prefix so iOS/Home doesn't cache the old "Lightbulb" UI representation.
        const vu = this.api.hap.uuid.generate(`${PLUGIN_NAME}:volumeSpeakerLightbulb:${z.zone_id}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H5',location:'src/platform.ts:216',message:'adding volume lightbulb accessory metadata',data:{zoneId:z.zone_id,zoneName:z.display_name,uuid:vu,kind:'volumeLightbulb',category:'SPEAKER'},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        out.set(vu, {
          name: `Lautstärke ${z.display_name}`,
          setup: (acc) => {
            acc.context = { kind: 'volumeLightbulb', zoneId: z.zone_id, zoneDisplayName: z.display_name };
            acc.category = Categories.SPEAKER;
            if (!this.wired.has(vu)) {
              this.wired.add(vu);
              new VolumeLightbulbAccessory(this.log, this.api, acc, this.roon!, z.zone_id);
            }
          },
        });
      }

      if (includeVolFan) {
        // Use a new UUID prefix so iOS/Home doesn't cache the old "Fan" UI representation.
        const fu = this.api.hap.uuid.generate(`${PLUGIN_NAME}:volumeSpeakerFan:${z.zone_id}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H1',location:'src/platform.ts:233',message:'adding volume fan accessory metadata',data:{zoneId:z.zone_id,zoneName:z.display_name,uuid:fu,kind:'volumeFan',category:'SPEAKER'},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        out.set(fu, {
          name: `Lautstärke (Fan) ${z.display_name}`,
          setup: (acc) => {
            acc.context = { kind: 'volumeFan', zoneId: z.zone_id, zoneDisplayName: z.display_name };
            acc.category = Categories.SPEAKER;
            if (!this.wired.has(fu)) {
              this.wired.add(fu);
              new VolumeFanAccessory(this.log, this.api, acc, this.roon!, z.zone_id);
            }
          },
        });
      }
    }

    const { Service, Characteristic } = this.api.hap;
    const incP = this.config.includePlaylists === true;
    const filterPl = this.asStringList(this.config.playlists);

    const radioPresets = this.getRadioPresetStations();
    const genrePresets = this.getGenrePresetGenres();

    let playlists = incP ? this.roon.getPlaylists() : [];
    if (filterPl.length) playlists = playlists.filter((t) => filterPl.includes(t));

    for (const z of zones) {
      const room = z.display_name;
      if (includeVolumeStepSwitches) {
        const volumeUuidUp = this.api.hap.uuid.generate(`${PLUGIN_NAME}:volumeUp:${z.zone_id}`);
        out.set(volumeUuidUp, {
          name: `${room} lauter`,
          setup: (acc) => {
            const sw = acc.getService(Service.Switch) ?? acc.addService(Service.Switch, acc.displayName);
            sw.getCharacteristic(Characteristic.On)!.onSet((value: unknown) => {
              const on = value as boolean;
              if (!on) return;
              this.roon!.changeVolumeRelative(z.zone_id, 5);
              setTimeout(() => sw.getCharacteristic(Characteristic.On)!.updateValue(false), 1000);
            });
          },
        });

        const volumeUuidDown = this.api.hap.uuid.generate(`${PLUGIN_NAME}:volumeDown:${z.zone_id}`);
        out.set(volumeUuidDown, {
          name: `${room} leiser`,
          setup: (acc) => {
            const sw = acc.getService(Service.Switch) ?? acc.addService(Service.Switch, acc.displayName);
            sw.getCharacteristic(Characteristic.On)!.onSet((value: unknown) => {
              const on = value as boolean;
              if (!on) return;
              this.roon!.changeVolumeRelative(z.zone_id, -5);
              setTimeout(() => sw.getCharacteristic(Characteristic.On)!.updateValue(false), 1000);
            });
          },
        });
      }

      if (radioPresets.length) {
        const prevRadioUuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:radioPrev:${z.zone_id}`);
        out.set(prevRadioUuid, {
          name: `${room} Radio zurück`,
          setup: (acc) => {
            const sw = acc.getService(Service.Switch) ?? acc.addService(Service.Switch, acc.displayName);
            sw.getCharacteristic(Characteristic.On)!.onSet((value: unknown) => {
              const on = value as boolean;
              if (!on) return;
              const presets = this.getRadioPresetStations();
              if (!presets.length) return;
              const current = this.radioPresetCurrentByZone.get(z.zone_id);
              let idx = current ? presets.indexOf(current) : 0;
              if (idx < 0) idx = 0;
              idx = (idx - 1 + presets.length) % presets.length;
              const next = presets[idx]!;
              this.radioPresetCurrentByZone.set(z.zone_id, next);
              this.roon!.playRadio(z.zone_id, next);
              setTimeout(() => sw.getCharacteristic(Characteristic.On)!.updateValue(false), 1000);
            });
          },
        });

        const nextRadioUuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:radioNext:${z.zone_id}`);
        out.set(nextRadioUuid, {
          name: `${room} Radio weiter`,
          setup: (acc) => {
            const sw = acc.getService(Service.Switch) ?? acc.addService(Service.Switch, acc.displayName);
            sw.getCharacteristic(Characteristic.On)!.onSet((value: unknown) => {
              const on = value as boolean;
              if (!on) return;
              const presets = this.getRadioPresetStations();
              if (!presets.length) return;
              const current = this.radioPresetCurrentByZone.get(z.zone_id);
              let idx = current ? presets.indexOf(current) : 0;
              if (idx < 0) idx = 0;
              idx = (idx + 1) % presets.length;
              const next = presets[idx]!;
              this.radioPresetCurrentByZone.set(z.zone_id, next);
              this.roon!.playRadio(z.zone_id, next);
              setTimeout(() => sw.getCharacteristic(Characteristic.On)!.updateValue(false), 1000);
            });
          },
        });
      }

      if (genrePresets.length) {
        const prevGenreUuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:genrePrev:${z.zone_id}`);
        out.set(prevGenreUuid, {
          name: `${room} Genre zurück`,
          setup: (acc) => {
            const sw = acc.getService(Service.Switch) ?? acc.addService(Service.Switch, acc.displayName);
            sw.getCharacteristic(Characteristic.On)!.onSet((value: unknown) => {
              const on = value as boolean;
              if (!on) return;
              const presets = this.getGenrePresetGenres();
              if (!presets.length) return;
              const current = this.genrePresetCurrentByZone.get(z.zone_id);
              let idx = current ? presets.indexOf(current) : 0;
              if (idx < 0) idx = 0;
              idx = (idx - 1 + presets.length) % presets.length;
              const next = presets[idx]!;
              this.genrePresetCurrentByZone.set(z.zone_id, next);
              this.roon!.playGenre(z.zone_id, next);
              setTimeout(() => sw.getCharacteristic(Characteristic.On)!.updateValue(false), 1000);
            });
          },
        });

        const nextGenreUuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:genreNext:${z.zone_id}`);
        out.set(nextGenreUuid, {
          name: `${room} Genre weiter`,
          setup: (acc) => {
            const sw = acc.getService(Service.Switch) ?? acc.addService(Service.Switch, acc.displayName);
            sw.getCharacteristic(Characteristic.On)!.onSet((value: unknown) => {
              const on = value as boolean;
              if (!on) return;
              const presets = this.getGenrePresetGenres();
              if (!presets.length) return;
              const current = this.genrePresetCurrentByZone.get(z.zone_id);
              let idx = current ? presets.indexOf(current) : 0;
              if (idx < 0) idx = 0;
              idx = (idx + 1) % presets.length;
              const next = presets[idx]!;
              this.genrePresetCurrentByZone.set(z.zone_id, next);
              this.roon!.playGenre(z.zone_id, next);
              setTimeout(() => sw.getCharacteristic(Characteristic.On)!.updateValue(false), 1000);
            });
          },
        });
      }

      for (const station of radioPresets) {
        const u = this.api.hap.uuid.generate(`${PLUGIN_NAME}:radio:${z.zone_id}:${station}`);
        out.set(u, {
          name: `${room} ${station}`,
          setup: (acc) => {
            acc.context = { kind: 'radio', zoneId: z.zone_id, zoneDisplayName: room, itemTitle: station };
            acc.category = Categories.SWITCH;
            if (!this.wired.has(u)) {
              this.wired.add(u);
              const indexCb = () => this.radioPresetCurrentByZone.set(z.zone_id, station);
              new RadioAccessory(this.log, this.api, acc, this.roon!, z.zone_id, room, station, indexCb);
            }
          },
        });
      }
      for (const pl of playlists) {
        const u = this.api.hap.uuid.generate(`${PLUGIN_NAME}:playlist:${z.zone_id}:${pl}`);
        out.set(u, {
          name: `${room} ${pl}`,
          setup: (acc) => {
            acc.context = { kind: 'playlist', zoneId: z.zone_id, zoneDisplayName: room, itemTitle: pl };
            acc.category = Categories.SWITCH;
            if (!this.wired.has(u)) {
              this.wired.add(u);
              new PlaylistAccessory(this.log, this.api, acc, this.roon!, z.zone_id, room, pl);
            }
          },
        });
      }
      for (const g of genrePresets) {
        const u = this.api.hap.uuid.generate(`${PLUGIN_NAME}:genre:${z.zone_id}:${g}`);
        out.set(u, {
          name: `${room} ${g}`,
          setup: (acc) => {
            acc.context = { kind: 'genre', zoneId: z.zone_id, zoneDisplayName: room, itemTitle: g };
            acc.category = Categories.SWITCH;
            if (!this.wired.has(u)) {
              this.wired.add(u);
              const indexCb = () => this.genrePresetCurrentByZone.set(z.zone_id, g);
              new GenreAccessory(this.log, this.api, acc, this.roon!, z.zone_id, room, g, indexCb);
            }
          },
        });
      }
    }

    return out;
  }

  private async syncAccessories(): Promise<void> {
    if (!this.roon) return;

    try {
      const desired = this.desiredUuids();
      const visibleZones = this.roon.getZones().filter((z) => !this.excluded(z.display_name));
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H2',location:'src/platform.ts:435',message:'syncAccessories desired/existing counts',data:{visibleZones:visibleZones.map((z)=>z.display_name),desiredCount:desired.size,existingCount:this.accessoryByUuid.size},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      this.log.info(
        `RoonComplete: HomeKit sync - ${visibleZones.length} Roon zone(s) -> ${desired.size} accessories (zones + optional radio/playlist/genre switches). If 0 zones, Roon has no zones or all are in excludeZones.`,
      );

      for (const [uuid, acc] of [...this.accessoryByUuid.entries()]) {
        if (!desired.has(uuid)) {
          // #region agent log
          fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H3',location:'src/platform.ts:444',message:'unregistering stale accessory',data:{uuid,displayName:acc.displayName,contextKind:acc.context?.kind},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
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
    } catch (e) {
      this.log.error('RoonComplete: syncAccessories failed (accessories may be missing in Home):', e);
      throw e;
    }
  }
}
