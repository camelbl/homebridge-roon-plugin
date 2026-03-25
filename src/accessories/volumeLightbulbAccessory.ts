import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue, Service } from 'homebridge';
import { RoonConnection, Zone } from '../roonConnection';

export class VolumeLightbulbAccessory {
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
      .setCharacteristic(Characteristic.Model, 'Volume');

    // Cleanup from older service types.
    for (const SvcType of [Svc.Lightbulb, Svc.Fanv2, Svc.Speaker]) {
      const s = this.accessory.getService(SvcType);
      if (s) this.accessory.removeService(s);
    }

    let svc = this.accessory.getService(Svc.SmartSpeaker) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.SmartSpeaker, name);
    }
    svc.setPrimaryService(true);
    svc.setCharacteristic(Characteristic.ConfiguredName, name);

    this.log.info(`RoonControl: wiring SmartSpeaker volume tile zone="${name}" (${this.zoneId})`);

    const getZ = () => this.roon.getZones().find((z) => z.zone_id === this.zoneId);

    svc.getCharacteristic(Characteristic.CurrentMediaState).onGet(() => {
      const state = getZ()?.state ?? 'stopped';
      if (state === 'playing') return Characteristic.CurrentMediaState.PLAY;
      if (state === 'paused') return Characteristic.CurrentMediaState.PAUSE;
      if (state === 'loading') return Characteristic.CurrentMediaState.LOADING;
      return Characteristic.CurrentMediaState.STOP;
    });

    svc.getCharacteristic(Characteristic.TargetMediaState)
      .onGet(() => {
        const state = getZ()?.state ?? 'stopped';
        if (state === 'playing') return Characteristic.TargetMediaState.PLAY;
        if (state === 'paused') return Characteristic.TargetMediaState.PAUSE;
        return Characteristic.TargetMediaState.STOP;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const target = value as number;
        if (target === Characteristic.TargetMediaState.PLAY) this.roon.play(this.zoneId);
        else if (target === Characteristic.TargetMediaState.PAUSE) this.roon.pause(this.zoneId);
        else this.roon.stop(this.zoneId);
      });

    svc.getCharacteristic(Characteristic.Volume)
      .onGet(() => getZ()?.volumePercent ?? 0)
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setVolume(this.zoneId, value as number);
      });

    svc.getCharacteristic(Characteristic.Mute)
      .onGet(() => getZ()?.isMuted ?? false)
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
    Characteristic: typeof import('homebridge').Characteristic,
  ): void {
    this.updatingFromRoon = true;
    try {
      const currentState =
        z.state === 'playing' ? Characteristic.CurrentMediaState.PLAY :
        z.state === 'paused'  ? Characteristic.CurrentMediaState.PAUSE :
        z.state === 'loading' ? Characteristic.CurrentMediaState.LOADING :
                                Characteristic.CurrentMediaState.STOP;
      const targetState =
        z.state === 'playing' ? Characteristic.TargetMediaState.PLAY :
        z.state === 'paused'  ? Characteristic.TargetMediaState.PAUSE :
                                Characteristic.TargetMediaState.STOP;
      svc.getCharacteristic(Characteristic.CurrentMediaState)!.updateValue(currentState);
      svc.getCharacteristic(Characteristic.TargetMediaState)!.updateValue(targetState);
      svc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      svc.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}
