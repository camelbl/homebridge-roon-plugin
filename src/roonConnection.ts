import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RoonApi = require('node-roon-api');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RoonApiTransport = require('node-roon-api-transport');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RoonApiBrowse = require('node-roon-api-browse');

export type RoonPlaybackState = 'playing' | 'paused' | 'loading' | 'stopped';

export interface Zone {
  zone_id: string;
  display_name: string;
  state: RoonPlaybackState;
  /** 0–100 for number-type volume; approximate for dB */
  volumePercent: number;
  isMuted: boolean;
}

interface BrowseItem {
  title: string;
  subtitle?: string;
  item_key?: string;
  hint?: string | null;
}

interface BrowseList {
  count: number;
  display_offset?: number;
}

interface BrowseBody {
  action: string;
  list?: BrowseList;
  message?: string;
  is_error?: boolean;
}

interface RoonOutput {
  output_id: string;
  zone_id: string;
  display_name: string;
  volume?: {
    type: string;
    min?: number;
    max?: number;
    value?: number;
    step?: number;
    is_muted?: boolean;
  };
}

interface RoonZoneRaw {
  zone_id: string;
  display_name: string;
  state: RoonPlaybackState;
  outputs?: Record<string, RoonOutput>;
}

export interface RoonConnectionOptions {
  roonHost?: string;
  roonPort?: number;
  /** Homebridge storage directory — Roon tokens stored in homebridge-roon-complete-roonstate.json (not merged into config.json). */
  persistDir?: string;
}

interface BrowseLeaf {
  title: string;
  pathKeys: string[];
}

function errMsg(err: unknown): string {
  if (err === false || err == null) return '';
  return String(err);
}

function uniqTitles(leaves: BrowseLeaf[]): string[] {
  return [...new Set(leaves.map((l) => l.title))];
}

/** Roon transport callbacks use `false` on success and an error name string on failure. */
function transportFailed(err: unknown): boolean {
  return err !== false && err != null && err !== '';
}

export class RoonConnection extends EventEmitter {
  private readonly opts: RoonConnectionOptions;
  private roon: InstanceType<typeof RoonApi>;
  private core: {
    services: {
      RoonApiTransport: typeof RoonApiTransport.prototype;
      RoonApiBrowse: typeof RoonApiBrowse.prototype;
    };
  } | null = null;
  private zones: Map<string, RoonZoneRaw> = new Map();
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private waiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private browsePrimed = false;
  private static readonly MAX_BROWSE_DEPTH = 48;
  private static readonly RECONNECT_BASE_MS = 2000;
  private static readonly RECONNECT_CAP_MS = 60_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** Set on unpair; cleared after next transport `Subscribed` — triggers `reconnected` for platform resync. */
  private needsPostReconnectSync = false;
  private radioTitles: string[] = [];
  private playlistTitles: string[] = [];
  private genreTitles: string[] = [];

  constructor(opts: RoonConnectionOptions = {}) {
    super();
    this.setMaxListeners(64);
    this.opts = opts;

    const persist = RoonConnection.buildRoonPersistHandlers(opts.persistDir);
    this.roon = new RoonApi({
      extension_id: 'com.homebridge.roon.complete',
      display_name: 'Homebridge Roon Complete',
      display_version: '1.0.0',
      publisher: 'homebridge-roon-complete',
      email: 'none@example.com',
      website: 'https://github.com/homebridge/homebridge',
      log_level: process.env.HOMEBRIDGE_ROON_DEBUG === '1' ? 'all' : 'none',
      ...(persist ?? {}),
      core_paired: (core: RoonConnection['core']) => {
        this.emit('status', 'Roon: Core accepted the extension — if it was missing from Settings → Extensions, it should appear now.');
        this.core = core;
        this.subscribeZones();
      },
      core_unpaired: () => {
        this.core = null;
        this.connected = false;
        this.browsePrimed = false;
        this.needsPostReconnectSync = true;
        this.zones.clear();
        this.radioTitles = [];
        this.playlistTitles = [];
        this.genreTitles = [];
        this.rejectWaiters(new Error('Lost pairing with Roon Core'));
      },
    });
    this.roon.init_services({
      required_services: [RoonApiTransport, RoonApiBrowse],
    });
  }

  /**
   * node-roon-api defaults to reading/writing `roonstate` inside cwd `config.json`, which is the same
   * file as Homebridge’s config and can break pairing. Use a dedicated JSON file under persistDir.
   */
  private static buildRoonPersistHandlers(persistDir?: string):
    | { get_persisted_state: () => object; set_persisted_state: (state: object) => void }
    | undefined {
    if (!persistDir) return undefined;
    const stateFile = path.join(persistDir, 'homebridge-roon-complete-roonstate.json');
    let migrated = false;

    const migrateFromHomebridgeConfigOnce = (): void => {
      if (migrated) return;
      migrated = true;
      if (fs.existsSync(stateFile)) return;
      try {
        const cfgPath = path.join(persistDir, 'config.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { roonstate?: unknown };
        if (cfg?.roonstate != null && typeof cfg.roonstate === 'object') {
          fs.mkdirSync(persistDir, { recursive: true });
          fs.writeFileSync(stateFile, JSON.stringify(cfg.roonstate, null, 2), 'utf8');
        }
      } catch {
        /* ignore */
      }
    };

    return {
      get_persisted_state: (): object => {
        try {
          migrateFromHomebridgeConfigOnce();
          if (fs.existsSync(stateFile)) {
            return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as object;
          }
        } catch {
          /* ignore */
        }
        return {};
      },
      set_persisted_state: (state: object): void => {
        fs.mkdirSync(persistDir, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      },
    };
  }

  connect(): Promise<void> {
    if (this.connected && this.core) {
      return this.populateBrowseTitlesIfNeeded();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectWaiters(new Error('Timeout waiting for Roon Core (enable extension in Roon Settings → Extensions)'));
      }, 120_000);
      this.waiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const host = (this.opts.roonHost || '').trim();
      if (host) {
        this.startFixedHostWebSocket();
      } else {
        this.emit('status', 'Roon: starting UDP discovery for Core (Docker may block this — prefer roonHost).');
        this.roon.start_discovery();
      }
    }).finally(() => {
      this.connectPromise = null;
    });
    // Do not chain populateBrowseTitlesIfNeeded() here — it can run for minutes and would block
    // await connect() in the platform; browse is triggered via refreshBrowseLists() after zones sync.
    return this.connectPromise;
  }

  private rejectWaiters(e: Error): void {
    for (const w of this.waiters) {
      w.reject(e);
    }
    this.waiters = [];
  }

  private resolveWaiters(): void {
    for (const w of this.waiters) {
      w.resolve();
    }
    this.waiters = [];
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Only when `roonHost` is set — discovery mode relies on Roon’s own SOOD retries. */
  private startFixedHostWebSocket(): void {
    const host = (this.opts.roonHost || '').trim();
    // Roon Core extension WebSocket port — confirmed 9330 via port scan (9150 is binary remote protocol).
    const port = this.opts.roonPort ?? 9330;
    if (!host) return;

    this.emit(
      'status',
      `Roon: connecting to ${host}:${port} — in Roon open Settings → Extensions and enable "Homebridge Roon Complete" if it appears.`,
    );
    this.roon.ws_connect({
      host,
      port,
      onclose: () => {
        this.emit('disconnected');
        this.scheduleFixedHostReconnect();
      },
      onerror: () => {
        this.emit(
          'error',
          new Error(
            `Roon WebSocket failed (${host}:${port}). ` +
              'If Homebridge is in Docker and Roon runs on the same machine, the LAN IP often does not work from the container — ' +
              'set roonHost to host.docker.internal (add extra_hosts: host.docker.internal:host-gateway to compose) or the container default-gateway IP (often 172.17.0.1), or clear roonHost to use discovery.',
          ),
        );
      },
    });
  }

  private scheduleFixedHostReconnect(): void {
    const host = (this.opts.roonHost || '').trim();
    if (!host) return;
    if (this.reconnectTimer) return;

    const capped = Math.min(
      RoonConnection.RECONNECT_CAP_MS,
      RoonConnection.RECONNECT_BASE_MS * Math.pow(2, Math.min(this.reconnectAttempt, 8)),
    );
    const delay = capped + Math.floor(Math.random() * 1500);
    this.reconnectAttempt += 1;
    this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs: delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      try {
        this.startFixedHostWebSocket();
      } catch (e) {
        this.emit('error', e);
        this.scheduleFixedHostReconnect();
      }
    }, delay);
  }

  private transportResult(operation: string): (err: unknown) => void {
    return (err: unknown) => {
      if (transportFailed(err)) {
        this.emit('error', new Error(`Roon ${operation} failed: ${errMsg(err)}`));
      }
    };
  }

  private subscribeZones(): void {
    if (!this.core) return;
    const transport = this.core.services.RoonApiTransport;
    transport.subscribe_zones(
      (
        response: string,
        msg: {
          zones?: RoonZoneRaw[];
          zones_added?: RoonZoneRaw[];
          zones_changed?: RoonZoneRaw[];
          zones_removed?: string[];
        },
      ) => {
        if (response === 'Subscribed') {
          this.emit('status', 'Roon: transport subscribed — zones will sync to HomeKit.');
          this.clearReconnectTimer();
          this.reconnectAttempt = 0;
          if (msg.zones) {
            this.zones = new Map(msg.zones.map((z) => [z.zone_id, z]));
            for (const z of msg.zones) {
              this.emitZone(z);
            }
          }
          if (!this.connected) {
            this.connected = true;
            this.resolveWaiters();
          }
          if (this.needsPostReconnectSync) {
            this.needsPostReconnectSync = false;
            this.emit('reconnected');
          }
          return;
        }
        if (response === 'Changed') {
          if (msg.zones_removed) {
            for (const r of msg.zones_removed) {
              const zone_id = typeof r === 'string' ? r : (r as { zone_id?: string }).zone_id;
              if (zone_id) this.zones.delete(zone_id);
            }
          }
          if (msg.zones_added) {
            for (const z of msg.zones_added) {
              this.zones.set(z.zone_id, z);
              this.emitZone(z);
            }
            if (!this.browsePrimed && this.zones.size > 0) {
              void this.populateBrowseTitlesIfNeeded();
            }
          }
          if (msg.zones_changed) {
            for (const z of msg.zones_changed) {
              this.zones.set(z.zone_id, z);
              this.emitZone(z);
            }
          }
        }
      },
    );
  }

  private emitZone(z: RoonZoneRaw): void {
    this.emit('zoneUpdate', this.toZone(z));
  }

  private toZone(z: RoonZoneRaw): Zone {
    const { volPct, muted } = this.primaryVolume(z);
    return {
      zone_id: z.zone_id,
      display_name: z.display_name,
      state: z.state,
      volumePercent: volPct,
      isMuted: muted,
    };
  }

  private primaryVolume(z: RoonZoneRaw): { volPct: number; muted: boolean } {
    const outputs = z.outputs ? Object.values(z.outputs) : [];
    for (const o of outputs) {
      const v = o.volume;
      if (!v) continue;
      if (v.type === 'number' && v.min != null && v.max != null && v.value != null) {
        const pct = Math.round(((v.value - v.min) / (v.max - v.min)) * 100);
        return { volPct: Math.max(0, Math.min(100, pct)), muted: !!v.is_muted };
      }
      if (v.type === 'db' && v.min != null && v.max != null && v.value != null) {
        const pct = Math.round(((v.value - v.min) / (v.max - v.min)) * 100);
        return { volPct: Math.max(0, Math.min(100, pct)), muted: !!v.is_muted };
      }
    }
    return { volPct: 0, muted: false };
  }

  getZones(): Zone[] {
    return [...this.zones.values()].map((z) => this.toZone(z));
  }

  getRadioStations(): string[] {
    return [...this.radioTitles];
  }

  getPlaylists(): string[] {
    return [...this.playlistTitles];
  }

  getGenres(): string[] {
    return [...this.genreTitles];
  }

  onZoneUpdate(cb: (zone: Zone) => void): void {
    this.on('zoneUpdate', cb);
  }

  private requireCore(): NonNullable<RoonConnection['core']> {
    if (!this.core) {
      throw new Error('Not connected to Roon');
    }
    return this.core;
  }

  private resolveZoneRef(zone: string): RoonZoneRaw {
    const byId = this.zones.get(zone);
    if (byId) return byId;
    const byName = [...this.zones.values()].filter((x) => x.display_name === zone);
    if (byName.length > 1) {
      throw new Error(`Ambiguous zone name "${zone}" — duplicate display names; use zone_id from Roon`);
    }
    if (byName.length === 1) return byName[0]!;
    throw new Error(`Unknown zone: ${zone}`);
  }

  private browse(svc: typeof RoonApiBrowse.prototype, opts: Record<string, unknown>): Promise<BrowseBody> {
    return new Promise((resolve, reject) => {
      svc.browse(opts, (err: unknown, body: BrowseBody) => {
        if (err) reject(new Error(errMsg(err) || 'browse failed'));
        else resolve(body);
      });
    });
  }

  private load(
    svc: typeof RoonApiBrowse.prototype,
    opts: { hierarchy: string; offset?: number; count?: number; set_display_offset?: number },
  ): Promise<{ items: BrowseItem[]; list: BrowseList }> {
    return new Promise((resolve, reject) => {
      svc.load(opts, (err: unknown, body: { items: BrowseItem[]; list: BrowseList }) => {
        if (err) reject(new Error(errMsg(err) || 'load failed'));
        else resolve(body);
      });
    });
  }

  private async loadAllItems(svc: typeof RoonApiBrowse.prototype, hierarchy: string): Promise<BrowseItem[]> {
    const out: BrowseItem[] = [];
    let offset = 0;
    const count = 100;
    for (;;) {
      const body = await this.load(svc, { hierarchy, offset, count, set_display_offset: offset });
      const list = body.list;
      if (!list) break;
      out.push(...body.items);
      if (out.length >= list.count) break;
      offset += body.items.length;
      if (body.items.length === 0) break;
    }
    return out;
  }

  private async collectLeaves(hierarchy: 'internet_radio' | 'playlists' | 'genres', zoneId: string): Promise<BrowseLeaf[]> {
    const { RoonApiBrowse: svc } = this.requireCore().services;
    const res = await this.browse(svc, {
      hierarchy,
      zone_or_output_id: zoneId,
      pop_all: true,
    });
    if (res.action !== 'list') {
      throw new Error(res.message || `browse ${hierarchy}: expected list, got ${res.action}`);
    }
    const leaves: BrowseLeaf[] = [];
    const scanLevel = async (pathKeys: string[]) => {
      if (pathKeys.length > RoonConnection.MAX_BROWSE_DEPTH) {
        return;
      }
      const items = await this.loadAllItems(svc, hierarchy);
      for (const item of items) {
        if (item.hint === 'header') continue;
        const hint = item.hint;
        if ((hint === 'list' || hint === 'action_list') && item.item_key) {
          const r2 = await this.browse(svc, { hierarchy, zone_or_output_id: zoneId, item_key: item.item_key });
          if (r2.action !== 'list') {
            await this.browse(svc, { hierarchy, zone_or_output_id: zoneId, pop_levels: 1 });
            continue;
          }
          await scanLevel([...pathKeys, item.item_key]);
          await this.browse(svc, { hierarchy, zone_or_output_id: zoneId, pop_levels: 1 });
        } else if (item.item_key) {
          leaves.push({ title: item.title, pathKeys: [...pathKeys, item.item_key] });
        }
      }
    };
    await scanLevel([]);
    return leaves;
  }

  private async populateBrowseTitlesIfNeeded(): Promise<void> {
    if (this.browsePrimed || !this.core || this.zones.size === 0) {
      return;
    }
    this.browsePrimed = true;
    try {
      const zid = [...this.zones.keys()][0];
      // Sequential: one browse stack per Roon connection — parallel hierarchies can corrupt session state.
      const r = await this.collectLeaves('internet_radio', zid);
      const p = await this.collectLeaves('playlists', zid);
      const g = await this.collectLeaves('genres', zid);
      this.radioTitles = uniqTitles(r);
      this.playlistTitles = uniqTitles(p);
      this.genreTitles = uniqTitles(g);
    } catch (e) {
      this.browsePrimed = false;
      this.emit('error', e);
    }
  }

  /** Call when first zone appears so browse lists can load. */
  async refreshBrowseLists(): Promise<void> {
    if (!this.core || this.zones.size === 0) return;
    this.browsePrimed = false;
    await this.populateBrowseTitlesIfNeeded();
  }

  private async playByTitle(hierarchy: 'internet_radio' | 'playlists' | 'genres', zoneId: string, title: string): Promise<void> {
    const leaves = await this.collectLeaves(hierarchy, zoneId);
    const leaf = leaves.find((l) => l.title === title);
    if (!leaf) {
      throw new Error(`Item not found in ${hierarchy}: ${title}`);
    }
    const { RoonApiBrowse: svc } = this.requireCore().services;
    const transport = this.requireCore().services.RoonApiTransport;
    await this.browse(svc, { hierarchy, zone_or_output_id: zoneId, pop_all: true });
    for (const key of leaf.pathKeys) {
      await this.browse(svc, { hierarchy, zone_or_output_id: zoneId, item_key: key });
    }
    const z = this.resolveZoneRef(zoneId);
    transport.control(z, 'play', this.transportResult('play'));
  }

  playRadio(zone: string, station: string): void {
    try {
      const z = this.resolveZoneRef(zone);
      void this.playByTitle('internet_radio', z.zone_id, station).catch((e) => this.emit('error', e));
    } catch (e) {
      this.emit('error', e);
    }
  }

  playPlaylist(zone: string, playlist: string): void {
    try {
      const z = this.resolveZoneRef(zone);
      void this.playByTitle('playlists', z.zone_id, playlist).catch((e) => this.emit('error', e));
    } catch (e) {
      this.emit('error', e);
    }
  }

  playGenre(zone: string, genre: string): void {
    try {
      const z = this.resolveZoneRef(zone);
      void this.playByTitle('genres', z.zone_id, genre).catch((e) => this.emit('error', e));
    } catch (e) {
      this.emit('error', e);
    }
  }

  pause(zone: string): void {
    try {
      const z = this.resolveZoneRef(zone);
      this.requireCore().services.RoonApiTransport.control(z, 'pause', this.transportResult('pause'));
    } catch (e) {
      this.emit('error', e);
    }
  }

  play(zone: string): void {
    try {
      const z = this.resolveZoneRef(zone);
      this.requireCore().services.RoonApiTransport.control(z, 'play', this.transportResult('play'));
    } catch (e) {
      this.emit('error', e);
    }
  }

  stop(zone: string): void {
    try {
      const z = this.resolveZoneRef(zone);
      this.requireCore().services.RoonApiTransport.control(z, 'stop', this.transportResult('stop'));
    } catch (e) {
      this.emit('error', e);
    }
  }

  setVolume(zone: string, volume: number): void {
    try {
      const z = this.resolveZoneRef(zone);
      const transport = this.requireCore().services.RoonApiTransport;
      const outputs = z.outputs ? Object.values(z.outputs) : [];
      const v = Math.max(0, Math.min(100, volume));
      for (const o of outputs) {
        const vol = o.volume;
        if (!vol || vol.type === 'incremental') continue;
        if (vol.min != null && vol.max != null) {
          const abs = vol.min + (v / 100) * (vol.max - vol.min);
          transport.change_volume(o, 'absolute', abs, this.transportResult(`change_volume(${o.display_name})`));
        }
      }
    } catch (e) {
      this.emit('error', e);
    }
  }

  /** Relative volume change in percent-points (e.g. +5 or -5). */
  changeVolumeRelative(zone: string, delta: number): void {
    try {
      const z = this.resolveZoneRef(zone);
      const transport = this.requireCore().services.RoonApiTransport;
      const outputs = z.outputs ? Object.values(z.outputs) : [];
      for (const o of outputs) {
        const vol = o.volume;
        if (!vol) continue;
        if (vol.type === 'incremental') {
          transport.change_volume(o, 'relative_step', delta > 0 ? 1 : -1, this.transportResult(`vol_step(${o.display_name})`));
        } else if (vol.min != null && vol.max != null && vol.value != null) {
          const step = ((vol.max - vol.min) * Math.abs(delta)) / 100;
          transport.change_volume(o, 'relative', delta > 0 ? step : -step, this.transportResult(`vol_rel(${o.display_name})`));
        }
      }
    } catch (e) {
      this.emit('error', e);
    }
  }

  setMuted(zone: string, muted: boolean): void {
    try {
      const z = this.resolveZoneRef(zone);
      const transport = this.requireCore().services.RoonApiTransport;
      const outputs = z.outputs ? Object.values(z.outputs) : [];
      for (const o of outputs) {
        if (o.volume) {
          transport.mute(o, muted ? 'mute' : 'unmute', this.transportResult(`mute(${o.display_name})`));
        }
      }
    } catch (e) {
      this.emit('error', e);
    }
  }
}
