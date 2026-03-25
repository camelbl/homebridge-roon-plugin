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
      .setCharacteristic(Characteristic.Model, 'Volume (Fan)');

    let svc = this.accessory.getService(Svc.Fanv2) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.Fanv2, name);
    }

    svc.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        // Tile "Active" represents playback state, not mute.
        return (z?.state ?? 'stopped') === 'playing' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const active = value === Characteristic.Active.ACTIVE;
        if (active) {
          this.roon.setMuted(this.zoneId, false);
          this.roon.play(this.zoneId);
        } else {
          this.roon.stop(this.zoneId);
        }
      });

    svc.getCharacteristic(Characteristic.RotationSpeed)
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        return z?.volumePercent ?? 0;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setVolume(this.zoneId, value as number);
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
      svc.getCharacteristic(Characteristic.RotationSpeed)!.updateValue(z.volumePercent);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

