import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue, Service } from 'hap-nodejs';
import { RoonConnection, Zone } from '../roonConnection';

export class VolumeFanAccessory {
  private updatingFromRoon = false;

  constructor(
    _log: Logger,
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly roon: RoonConnection,
    private readonly zoneId: string,
  ) {
    const { Service: Svc, Characteristic } = api.hap;

    const name = (this.accessory.context.zoneDisplayName as string) || 'Roon Volume';
    this.accessory.displayName = name;

    this.accessory
      .getService(Svc.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Volume (Speaker)');

    // Cleanup from older versions (when this accessory was implemented as Fanv2).
    const staleFan = this.accessory.getService(Svc.Fanv2);
    if (staleFan) this.accessory.removeService(staleFan);

    let svc = this.accessory.getService(Svc.Speaker) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.Speaker, name);
    }

    // Active indicates playback state (playing vs not playing).
    svc.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        return (z?.state ?? 'stopped') === 'playing'
          ? Characteristic.Active.ACTIVE
          : Characteristic.Active.INACTIVE;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const active = value === Characteristic.Active.ACTIVE;
        if (active) {
          this.roon.setMuted(this.zoneId, false);
          this.roon.play(this.zoneId);
        } else {
          this.roon.stop(this.zoneId);
          this.roon.setMuted(this.zoneId, true);
        }
      });

    svc.getCharacteristic(Characteristic.Volume)
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        return z?.volumePercent ?? 0;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setVolume(this.zoneId, value as number);
      });

    // Required by the HAP Speaker service.
    svc.getCharacteristic(Characteristic.Mute)
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        return z?.isMuted ?? false;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setMuted(this.zoneId, value as boolean);
      });

    this.roon.onZoneUpdate((z) => {
      if (z.zone_id !== this.zoneId) return;
      this.applyZone(z, svc!, Characteristic);
    });

    const initial = this.roon.getZones().find((z) => z.zone_id === zoneId);
    if (initial) {
      this.applyZone(initial, svc, Characteristic);
    }
  }

  private applyZone(
    z: Zone,
    svc: Service,
    Characteristic: typeof import('hap-nodejs').Characteristic,
  ): void {
    this.updatingFromRoon = true;
    try {
      svc.getCharacteristic(Characteristic.Active)!.updateValue(
        z.state === 'playing' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
      );
      svc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      svc.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

