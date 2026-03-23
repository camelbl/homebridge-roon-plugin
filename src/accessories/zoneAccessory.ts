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

    let speaker = accessory.getService(Svc.SmartSpeaker);
    if (!speaker) {
      speaker = accessory.addService(Svc.SmartSpeaker, this.accessory.displayName);
    }

    let volBulb = accessory.getServiceById(Svc.Lightbulb, 'volume');
    if (!volBulb) {
      volBulb = accessory.addService(Svc.Lightbulb, 'Volume', 'volume');
    }
    volBulb.getCharacteristic(Characteristic.On)!.setValue(true);

    let muteBulb = accessory.getServiceById(Svc.Lightbulb, 'mute');
    if (!muteBulb) {
      muteBulb = accessory.addService(Svc.Lightbulb, 'Mute', 'mute');
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

    volBulb
      .getCharacteristic(Characteristic.Brightness)!
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setVolume(this.zoneId, value as number);
      });

    muteBulb.getCharacteristic(Characteristic.On)!.onSet((value: CharacteristicValue) => {
      if (this.updatingFromRoon) return;
      this.roon.setMuted(this.zoneId, value as boolean);
    });

    this.roon.onZoneUpdate((z) => {
      if (z.zone_id !== this.zoneId) return;
      this.applyZone(z, speaker!, volBulb!, muteBulb!, Characteristic);
    });

    const initial = this.roon.getZones().find((z) => z.zone_id === zoneId);
    if (initial) {
      this.applyZone(initial, speaker, volBulb, muteBulb, Characteristic);
    }
  }

  private applyZone(
    z: Zone,
    speaker: Service,
    volBulb: Service,
    muteBulb: Service,
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

      volBulb.getCharacteristic(Characteristic.Brightness)!.updateValue(z.volumePercent);
      volBulb.getCharacteristic(Characteristic.On)!.updateValue(z.volumePercent > 0);

      muteBulb.getCharacteristic(Characteristic.On)!.updateValue(z.isMuted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}
