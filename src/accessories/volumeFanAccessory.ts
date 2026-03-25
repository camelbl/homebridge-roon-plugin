import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue, Service } from 'hap-nodejs';
import { RoonConnection, Zone } from '../roonConnection';

export class VolumeFanAccessory {
  private updatingFromRoon = false;
  private readonly log: Logger;

  constructor(
    _log: Logger,
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly roon: RoonConnection,
    private readonly zoneId: string,
  ) {
    this.log = _log;
    const { Service: Svc, Characteristic } = api.hap;

    const name = (this.accessory.context.zoneDisplayName as string) || 'Roon Volume';
    this.accessory.displayName = name;

    this.accessory
      .getService(Svc.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Volume')
      .setCharacteristic(Characteristic.SerialNumber, `roon-zone-${this.zoneId}`);

    // Cleanup from older service types (Fan/Speaker/SmartSpeaker).
    for (const SvcType of [Svc.Fanv2, Svc.Speaker, Svc.SmartSpeaker]) {
      const s = this.accessory.getService(SvcType);
      if (s) this.accessory.removeService(s);
    }

    let svc = this.accessory.getService(Svc.Lightbulb) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.Lightbulb, name);
    }
    svc.setPrimaryService(true);
    svc.setCharacteristic(Characteristic.Name, name);

    this.log.info(`RoonComplete: wiring volume tile zone="${name}" (${this.zoneId})`);

    const getZ = () => this.roon.getZones().find((z) => z.zone_id === this.zoneId);

    const mapToOn = (z: Zone | undefined): boolean => {
      const state = z?.state ?? 'stopped';
      return state !== 'stopped';
    };

    // On/Off maps to stream play/stop.
    svc.getCharacteristic(Characteristic.On)
      .onGet(() => mapToOn(getZ()))
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        if (value as boolean) this.roon.play(this.zoneId);
        else this.roon.stop(this.zoneId);
      });

    // Brightness slider maps to zone volume percent (0–100).
    svc.getCharacteristic(Characteristic.Brightness)
      .onGet(() => getZ()?.volumePercent ?? 0)
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const requested = value as number;
        if (Number.isFinite(requested)) {
          this.roon.setVolume(this.zoneId, requested);
        }
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
      svc.getCharacteristic(Characteristic.On)!.updateValue(z.state !== 'stopped');
      svc.getCharacteristic(Characteristic.Brightness)!.updateValue(z.volumePercent);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}
