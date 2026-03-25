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
      .setCharacteristic(Characteristic.Model, 'Volume (SmartSpeaker)');

    // Cleanup from older versions (when this accessory was implemented as Lightbulb/Fan/Speaker).
    const staleServices = [Svc.Lightbulb, Svc.Fanv2, Svc.Speaker].map((T) => this.accessory.getService(T));
    for (const s of staleServices) {
      if (s) this.accessory.removeService(s);
    }

    let svc = this.accessory.getService(Svc.SmartSpeaker) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.SmartSpeaker, name);
    }
    svc.setPrimaryService(true);
    svc.setCharacteristic(Characteristic.ConfiguredName, name);
    this.log.info(
      `[DBG-H1] volumeFan wiring zoneId=${this.zoneId} service=SmartSpeaker hadLightbulb=${!!staleServices[0]} hadFanv2=${!!staleServices[1]} hadSpeaker=${!!staleServices[2]}`,
    );
    this.log.info(
      `[DBG-H8] volumeFan service-map zoneId=${this.zoneId} services=${this.accessory.services.map((s) => s.UUID).join(',')} primaryUUID=${svc.UUID}`,
    );
    const getZ = () => this.roon.getZones().find((z) => z.zone_id === this.zoneId);

    const mapToCurrentMediaState = (z: Zone | undefined): number => {
      const state = z?.state ?? 'stopped';
      if (state === 'playing') return Characteristic.CurrentMediaState.PLAY;
      if (state === 'paused') return Characteristic.CurrentMediaState.PAUSE;
      if (state === 'loading') return Characteristic.CurrentMediaState.LOADING;
      return Characteristic.CurrentMediaState.STOP;
    };

    const mapToTargetMediaState = (z: Zone | undefined): number => {
      const state = z?.state ?? 'stopped';
      if (state === 'playing') return Characteristic.TargetMediaState.PLAY;
      if (state === 'paused') return Characteristic.TargetMediaState.PAUSE;
      // TargetMediaState only supports PLAY/PAUSE/STOP (0..2), not LOADING.
      return Characteristic.TargetMediaState.STOP;
    };

    // Required by HAP SmartSpeaker.
    svc.getCharacteristic(Characteristic.CurrentMediaState).onGet(() => mapToCurrentMediaState(getZ()));

    svc.getCharacteristic(Characteristic.TargetMediaState)
      .onGet(() => mapToTargetMediaState(getZ()))
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const target = value as number;
        if (target === Characteristic.TargetMediaState.PLAY) this.roon.play(this.zoneId);
        else if (target === Characteristic.TargetMediaState.PAUSE) this.roon.pause(this.zoneId);
        else this.roon.stop(this.zoneId);
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

    // Optional: mute toggle.
    svc.getCharacteristic(Characteristic.Mute)
      .onGet(() => {
        const z = getZ();
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
      const currentState =
        z.state === 'playing'
          ? Characteristic.CurrentMediaState.PLAY
          : z.state === 'paused'
            ? Characteristic.CurrentMediaState.PAUSE
            : z.state === 'loading'
              ? Characteristic.CurrentMediaState.LOADING
              : Characteristic.CurrentMediaState.STOP;
      const targetState =
        z.state === 'playing'
          ? Characteristic.TargetMediaState.PLAY
          : z.state === 'paused'
            ? Characteristic.TargetMediaState.PAUSE
            : Characteristic.TargetMediaState.STOP;
      svc.getCharacteristic(Characteristic.CurrentMediaState)!.updateValue(currentState);
      svc.getCharacteristic(Characteristic.TargetMediaState)!.updateValue(targetState);
      svc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      svc.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

