import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue } from 'hap-nodejs';
import type { Service } from 'hap-nodejs';
import { RoonConnection, Zone } from '../roonConnection';

export class ZoneAccessory {
  private updatingFromRoon = false;

  constructor(
    _log: Logger,
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly roon: RoonConnection,
    private readonly zoneId: string,
  ) {
    const { Service: Svc, Characteristic } = api.hap;

    const name = (this.accessory.context.zoneDisplayName as string) || 'Roon Zone';
    this.accessory.displayName = name;
    this.accessory
      .getService(Svc.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Zone');

    // Remove stale services from previous plugin versions.
    for (const id of ['volume', 'mute']) {
      const s = this.accessory.getServiceById(Svc.Lightbulb, id);
      if (s) this.accessory.removeService(s);
    }
    for (const SvcType of [Svc.SmartSpeaker, Svc.Speaker]) {
      const s = this.accessory.getService(SvcType);
      if (s) this.accessory.removeService(s);
    }

    // Service.Television shows reliably in Home "Lautsprecher & TVs" on all iOS versions.
    // SmartSpeaker shows "Nicht unterstützt" on some iOS / HomeKit versions.
    let tv = this.accessory.getService(Svc.Television);
    if (!tv) {
      tv = this.accessory.addService(Svc.Television, name);
    }
    tv.setPrimaryService(true);
    tv.setCharacteristic(Characteristic.ConfiguredName, name);
    tv.setCharacteristic(
      Characteristic.SleepDiscoveryMode,
      Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );

    tv.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        return z?.state === 'playing'
          ? Characteristic.Active.ACTIVE
          : Characteristic.Active.INACTIVE;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        if (value === Characteristic.Active.ACTIVE) {
          this.roon.play(this.zoneId);
        } else {
          this.roon.pause(this.zoneId);
        }
      });

    // ActiveIdentifier is required by Television; we don't use input sources so fix it at 1.
    tv.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => 1)
      .onSet(() => {
        /* no-op */
      });

    // TelevisionSpeaker handles volume + mute and links to the Television tile.
    let tvSpeaker = this.accessory.getService(Svc.TelevisionSpeaker);
    if (!tvSpeaker) {
      tvSpeaker = this.accessory.addService(Svc.TelevisionSpeaker);
    }
    tv.addLinkedService(tvSpeaker);
    // RELATIVE_WITH_CURRENT lets HomeKit use VolumeSelector (physical buttons) AND absolute Volume.
    tvSpeaker.setCharacteristic(
      Characteristic.VolumeControlType,
      Characteristic.VolumeControlType.RELATIVE_WITH_CURRENT,
    );

    tvSpeaker
      .getCharacteristic(Characteristic.Volume)!
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        return z?.volumePercent ?? 0;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setVolume(this.zoneId, value as number);
      });

    tvSpeaker.getCharacteristic(Characteristic.Mute)!
      .onGet(() => {
        const z = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
        return z?.isMuted ?? false;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setMuted(this.zoneId, value as boolean);
      });

    // VolumeSelector: triggered by physical volume buttons and iOS TV remote.
    tvSpeaker.getCharacteristic(Characteristic.VolumeSelector)!
      .onSet((value: CharacteristicValue) => {
        const increment = value === Characteristic.VolumeSelector.INCREMENT;
        this.roon.changeVolumeRelative(this.zoneId, increment ? 5 : -5);
      });

    this.roon.onZoneUpdate((z) => {
      if (z.zone_id !== this.zoneId) return;
      this.applyZone(z, tv!, tvSpeaker!, Characteristic);
    });

    const initial = this.roon.getZones().find((z) => z.zone_id === zoneId);
    if (initial) {
      this.applyZone(initial, tv, tvSpeaker, Characteristic);
    }
  }

  private applyZone(
    z: Zone,
    tv: Service,
    tvSpeaker: Service,
    Characteristic: typeof import('hap-nodejs').Characteristic,
  ): void {
    this.updatingFromRoon = true;
    try {
      tv.getCharacteristic(Characteristic.Active)!.updateValue(
        z.state === 'playing' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
      );
      tvSpeaker.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      tvSpeaker.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}
