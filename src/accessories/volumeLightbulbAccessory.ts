import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue, Service } from 'hap-nodejs';
import { RoonConnection, Zone } from '../roonConnection';

export class VolumeLightbulbAccessory {
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
      .setCharacteristic(Characteristic.Model, 'Volume (Dimmer)');

    let svc = this.accessory.getService(Svc.Lightbulb) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.Lightbulb, name);
    }

    svc.getCharacteristic(Characteristic.On)
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        return !(z?.isMuted ?? false);
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setMuted(this.zoneId, !(value as boolean));
      });

    svc.getCharacteristic(Characteristic.Brightness)
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
      svc.getCharacteristic(Characteristic.On)!.updateValue(!z.isMuted);
      svc.getCharacteristic(Characteristic.Brightness)!.updateValue(z.volumePercent);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

