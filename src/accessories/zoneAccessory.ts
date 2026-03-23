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

    this.accessory.displayName = (this.accessory.context.zoneDisplayName as string) || 'Roon Zone';
    this.accessory
      .getService(Svc.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Zone');

    // Remove old lightbulb services from cached accessories (previous plugin version used them).
    for (const id of ['volume', 'mute']) {
      const old = accessory.getServiceById(Svc.Lightbulb, id);
      if (old) accessory.removeService(old);
    }

    let speaker = accessory.getService(Svc.SmartSpeaker);
    if (!speaker) {
      speaker = accessory.addService(Svc.SmartSpeaker, this.accessory.displayName);
    }
    speaker.setPrimaryService(true);
    speaker.setCharacteristic(Characteristic.ConfiguredName, this.accessory.displayName);

    // Service.Speaker provides native Volume (0-100) + Mute — shows as a speaker in Home, not a light.
    let volSvc = accessory.getService(Svc.Speaker);
    if (!volSvc) {
      volSvc = accessory.addService(Svc.Speaker);
    }

    speaker
      .getCharacteristic(Characteristic.TargetMediaState)!
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const v = value as number;
        if (v === Characteristic.TargetMediaState.PAUSE) {
          this.roon.pause(this.zoneId);
        } else if (v === Characteristic.TargetMediaState.PLAY) {
          this.roon.play(this.zoneId);
        } else if (v === Characteristic.TargetMediaState.STOP) {
          this.roon.stop(this.zoneId);
        }
      });

    volSvc
      .getCharacteristic(Characteristic.Volume)!
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setVolume(this.zoneId, value as number);
      });

    volSvc.getCharacteristic(Characteristic.Mute)!.onSet((value: CharacteristicValue) => {
      if (this.updatingFromRoon) return;
      this.roon.setMuted(this.zoneId, value as boolean);
    });

    this.roon.onZoneUpdate((z) => {
      if (z.zone_id !== this.zoneId) return;
      this.applyZone(z, speaker!, volSvc!, Characteristic);
    });

    const initial = this.roon.getZones().find((z) => z.zone_id === zoneId);
    if (initial) {
      this.applyZone(initial, speaker, volSvc, Characteristic);
    }
  }

  private applyZone(
    z: Zone,
    speaker: Service,
    volSvc: Service,
    Characteristic: typeof import('hap-nodejs').Characteristic,
  ): void {
    this.updatingFromRoon = true;
    try {
      const { CurrentMediaState, TargetMediaState } = Characteristic;
      let cur = CurrentMediaState.STOP;
      if (z.state === 'playing') cur = CurrentMediaState.PLAY;
      else if (z.state === 'paused') cur = CurrentMediaState.PAUSE;
      else if (z.state === 'loading') cur = CurrentMediaState.LOADING;

      speaker.getCharacteristic(CurrentMediaState)!.updateValue(cur);
      speaker.getCharacteristic(TargetMediaState)!.updateValue(cur);

      volSvc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      volSvc.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}
