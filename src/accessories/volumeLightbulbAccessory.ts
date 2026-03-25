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
      .setCharacteristic(Characteristic.Model, 'Volume (Speaker)');

    // Cleanup from older versions (when this accessory was implemented as Lightbulb/Fan/SmartSpeaker).
    const staleServices = [Svc.Lightbulb, Svc.Fanv2, Svc.SmartSpeaker].map((T) => this.accessory.getService(T));
    for (const s of staleServices) {
      if (s) this.accessory.removeService(s);
    }

    let svc = this.accessory.getService(Svc.Speaker) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.Speaker, name);
    }

    const getZ = () => this.roon.getZones().find((z) => z.zone_id === this.zoneId);

    // Required by HAP Speaker.
    // HomeKit "Mute" acts like On/Off: unmuted => play, muted => stop.
    svc.getCharacteristic(Characteristic.Mute)
      .onGet(() => {
        const z = getZ();
        // Treat non-playing as muted/off to reflect "stop" state.
        return (z?.state ?? 'stopped') !== 'playing' || (z?.isMuted ?? false);
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const muted = value as boolean;
        if (muted) {
          this.roon.stop(this.zoneId);
          this.roon.setMuted(this.zoneId, true);
        } else {
          this.roon.setMuted(this.zoneId, false);
          this.roon.play(this.zoneId);
        }
      });

    // Optional: volume slider.
    svc.getCharacteristic(Characteristic.Volume)
      .onGet(() => {
        const z = getZ();
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
      svc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      // Treat non-playing as muted/off.
      const muted = z.state !== 'playing' || z.isMuted;
      svc.getCharacteristic(Characteristic.Mute)!.updateValue(muted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

