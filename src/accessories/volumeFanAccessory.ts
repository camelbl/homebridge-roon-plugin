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

    const serial = `roon-zone-${this.zoneId}`;
    const infoSvc = this.accessory
      .getService(Svc.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Volume (SmartSpeaker)')
      .setCharacteristic(Characteristic.SerialNumber, serial);
    this.log.info(
      `[DBG-H16] accessory info zoneId=${this.zoneId} serial=${String(infoSvc.getCharacteristic(Characteristic.SerialNumber).value ?? '')} expectedSerial=${serial} category=${this.accessory.category}`,
    );
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-8',hypothesisId:'H7',location:'src/accessories/volumeFanAccessory.ts:constructor',message:'accessory info snapshot',data:{zoneId:this.zoneId,serial:String(infoSvc.getCharacteristic(Characteristic.SerialNumber).value ?? ''),expectedSerial:serial,category:this.accessory.category},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

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
    svc.setCharacteristic(Characteristic.Name, name);
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
    svc.getCharacteristic(Characteristic.CurrentMediaState).onGet(() => {
      const value = mapToCurrentMediaState(getZ());
      this.log.info(`[DBG-H13] CurrentMediaState onGet zoneId=${this.zoneId} value=${value}`);
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-5',hypothesisId:'H4',location:'src/accessories/volumeFanAccessory.ts:CurrentMediaState.onGet',message:'current media state requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return value;
    });

    svc.getCharacteristic(Characteristic.TargetMediaState)
      .onGet(() => {
        const value = mapToTargetMediaState(getZ());
        this.log.info(`[DBG-H13] TargetMediaState onGet zoneId=${this.zoneId} value=${value}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-5',hypothesisId:'H4',location:'src/accessories/volumeFanAccessory.ts:TargetMediaState.onGet',message:'target media state requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return value;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const target = value as number;
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-4',hypothesisId:'H5',location:'src/accessories/volumeFanAccessory.ts:TargetMediaState.onSet',message:'target media state set',data:{zoneId:this.zoneId,target},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (target === Characteristic.TargetMediaState.PLAY) this.roon.play(this.zoneId);
        else if (target === Characteristic.TargetMediaState.PAUSE) this.roon.pause(this.zoneId);
        else this.roon.stop(this.zoneId);
      });

    // Some HomeKit clients only render controllable cards when Active is present.
    svc.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        const state = getZ()?.state ?? 'stopped';
        const value = state === 'playing' || state === 'paused' || state === 'loading'
          ? Characteristic.Active.ACTIVE
          : Characteristic.Active.INACTIVE;
        this.log.info(`[DBG-H17] Active onGet zoneId=${this.zoneId} value=${value}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-9',hypothesisId:'H10',location:'src/accessories/volumeFanAccessory.ts:Active.onGet',message:'active requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return value;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const active = value as number;
        this.log.info(`[DBG-H17] Active onSet zoneId=${this.zoneId} value=${active}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-9',hypothesisId:'H10',location:'src/accessories/volumeFanAccessory.ts:Active.onSet',message:'active set from HomeKit',data:{zoneId:this.zoneId,active},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (active === Characteristic.Active.ACTIVE) {
          this.roon.play(this.zoneId);
        } else {
          this.roon.stop(this.zoneId);
        }
      });

    // Optional: volume slider.
    svc.getCharacteristic(Characteristic.Volume)
      .onGet(() => {
        const z = getZ();
        const value = z?.volumePercent ?? 0;
        this.log.info(`[DBG-H13] Volume onGet zoneId=${this.zoneId} value=${value}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-5',hypothesisId:'H4',location:'src/accessories/volumeFanAccessory.ts:Volume.onGet',message:'volume requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return value;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const requested = value as number;
        this.log.info(
          `[DBG-H12] volume onSet zoneId=${this.zoneId} requested=${requested} isFinite=${Number.isFinite(requested)}`,
        );
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-4',hypothesisId:'H2',location:'src/accessories/volumeFanAccessory.ts:Volume.onSet',message:'volume set from HomeKit',data:{zoneId:this.zoneId,requested,isFinite:Number.isFinite(requested)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        this.roon.setVolume(this.zoneId, requested);
      });

    // Optional: mute toggle.
    svc.getCharacteristic(Characteristic.Mute)
      .onGet(() => {
        const z = getZ();
        const value = z?.isMuted ?? false;
        this.log.info(`[DBG-H13] Mute onGet zoneId=${this.zoneId} value=${value}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-5',hypothesisId:'H4',location:'src/accessories/volumeFanAccessory.ts:Mute.onGet',message:'mute requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return value;
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
      this.log.info(
        `[DBG-H11] applyZone zoneId=${this.zoneId} state=${z.state} currentState=${currentState} targetState=${targetState} volume=${z.volumePercent} muted=${z.isMuted}`,
      );
      try {
        svc.getCharacteristic(Characteristic.CurrentMediaState)!.updateValue(currentState);
      } catch (e) {
        this.log.error(`[DBG-H11E] currentMediaState update failed zoneId=${this.zoneId} value=${currentState} err=${String(e)}`);
        throw e;
      }
      try {
        svc.getCharacteristic(Characteristic.TargetMediaState)!.updateValue(targetState);
      } catch (e) {
        this.log.error(`[DBG-H11E] targetMediaState update failed zoneId=${this.zoneId} value=${targetState} err=${String(e)}`);
        throw e;
      }
      try {
        svc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      } catch (e) {
        this.log.error(`[DBG-H11E] volume update failed zoneId=${this.zoneId} value=${z.volumePercent} err=${String(e)}`);
        throw e;
      }
      try {
        svc.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
      } catch (e) {
        this.log.error(`[DBG-H11E] mute update failed zoneId=${this.zoneId} value=${z.isMuted} err=${String(e)}`);
        throw e;
      }
      try {
        const activeValue =
          z.state === 'playing' || z.state === 'paused' || z.state === 'loading'
            ? Characteristic.Active.ACTIVE
            : Characteristic.Active.INACTIVE;
        svc.getCharacteristic(Characteristic.Active)!.updateValue(activeValue);
      } catch (e) {
        this.log.error(`[DBG-H11E] active update failed zoneId=${this.zoneId} err=${String(e)}`);
        throw e;
      }
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-4',hypothesisId:'H1',location:'src/accessories/volumeFanAccessory.ts:applyZone',message:'applyZone updateValue payload',data:{zoneId:this.zoneId,state:z.state,currentState,targetState,volumePercent:z.volumePercent,isVolumeFinite:Number.isFinite(z.volumePercent),isMuted:z.isMuted},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

