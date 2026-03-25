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
    this.log.info(
      `[DBG-H1] volumeFan wiring zoneId=${this.zoneId} service=SmartSpeaker hadLightbulb=${!!staleServices[0]} hadFanv2=${!!staleServices[1]} hadSpeaker=${!!staleServices[2]}`,
    );
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H1',location:'src/accessories/volumeFanAccessory.ts:35',message:'volumeFan service wiring',data:{zoneId:this.zoneId,serviceType:'SmartSpeaker',hadLightbulb:!!staleServices[0],hadFanv2:!!staleServices[1],hadSpeaker:!!staleServices[2],model:'Volume (SmartSpeaker)'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const getZ = () => this.roon.getZones().find((z) => z.zone_id === this.zoneId);

    const mapToCurrentMediaState = (z: Zone | undefined): number => {
      const state = z?.state ?? 'stopped';
      if (state === 'playing') return Characteristic.CurrentMediaState.PLAY;
      if (state === 'paused') return Characteristic.CurrentMediaState.PAUSE;
      if (state === 'loading') return Characteristic.CurrentMediaState.LOADING;
      return Characteristic.CurrentMediaState.STOP;
    };

    const mapTargetToAction = (target: number): { action: 'play' | 'pause' | 'stop'; mute?: boolean } => {
      if (target === Characteristic.TargetMediaState.PLAY) return { action: 'play', mute: false };
      if (target === Characteristic.TargetMediaState.PAUSE) return { action: 'pause', mute: false };
      if (target === Characteristic.TargetMediaState.STOP) return { action: 'stop', mute: true };
      return { action: 'stop', mute: true };
    };

    // Required by HAP SmartSpeaker.
    svc.getCharacteristic(Characteristic.CurrentMediaState).onGet(() => mapToCurrentMediaState(getZ()));

    svc.getCharacteristic(Characteristic.TargetMediaState)
      .onGet(() => mapToCurrentMediaState(getZ()))
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const target = value as number;
        const { action, mute } = mapTargetToAction(target);

        if (typeof mute === 'boolean') this.roon.setMuted(this.zoneId, mute);
        if (action === 'play') this.roon.play(this.zoneId);
        else if (action === 'pause') this.roon.pause(this.zoneId);
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

    // Optional: mute toggle (sync only; "Off" uses TargetMediaState/STOP).
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
      const mediaState =
        z.state === 'playing'
          ? Characteristic.CurrentMediaState.PLAY
          : z.state === 'paused'
            ? Characteristic.CurrentMediaState.PAUSE
            : z.state === 'loading'
              ? Characteristic.CurrentMediaState.LOADING
              : Characteristic.CurrentMediaState.STOP;

      svc.getCharacteristic(Characteristic.CurrentMediaState)!.updateValue(mediaState);
      svc.getCharacteristic(Characteristic.TargetMediaState)!.updateValue(mediaState);
      svc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      svc.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

