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
      .setCharacteristic(Characteristic.Model, 'Volume (Fanv2)')
      .setCharacteristic(Characteristic.SerialNumber, serial);
    this.log.info(
      `[DBG-H16] accessory info zoneId=${this.zoneId} serial=${String(infoSvc.getCharacteristic(Characteristic.SerialNumber).value ?? '')} expectedSerial=${serial} category=${this.accessory.category}`,
    );
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-8',hypothesisId:'H7',location:'src/accessories/volumeFanAccessory.ts:constructor',message:'accessory info snapshot',data:{zoneId:this.zoneId,serial:String(infoSvc.getCharacteristic(Characteristic.SerialNumber).value ?? ''),expectedSerial:serial,category:this.accessory.category},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Cleanup from older versions (Lightbulb / Speaker / SmartSpeaker).
    const staleServices = [Svc.Lightbulb, Svc.Speaker, Svc.SmartSpeaker].map((T) => this.accessory.getService(T));
    for (const s of staleServices) {
      if (s) this.accessory.removeService(s);
    }

    let svc = this.accessory.getService(Svc.Fanv2) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.Fanv2, name);
    }
    svc.setPrimaryService(true);
    svc.setCharacteristic(Characteristic.Name, name);
    this.log.info(
      `[DBG-H1] volumeFan wiring zoneId=${this.zoneId} service=Fanv2 hadLightbulb=${!!staleServices[0]} hadSpeaker=${!!staleServices[1]} hadSmartSpeaker=${!!staleServices[2]}`,
    );
    this.log.info(
      `[DBG-H8] volumeFan service-map zoneId=${this.zoneId} services=${this.accessory.services.map((s) => s.UUID).join(',')} primaryUUID=${svc.UUID}`,
    );
    const getZ = () => this.roon.getZones().find((z) => z.zone_id === this.zoneId);

    const mapToActive = (z: Zone | undefined): number => {
      const state = z?.state ?? 'stopped';
      return state === 'stopped' ? Characteristic.Active.INACTIVE : Characteristic.Active.ACTIVE;
    };

    const mapToCurrentFanState = (z: Zone | undefined): number => {
      const state = z?.state ?? 'stopped';
      return state === 'playing' ? Characteristic.CurrentFanState.BLOWING_AIR : Characteristic.CurrentFanState.IDLE;
    };

    // Fanv2 power maps to stream stop/play.
    svc.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        const value = mapToActive(getZ());
        this.log.info(`[DBG-H13] Active onGet zoneId=${this.zoneId} value=${value}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-10',hypothesisId:'H11',location:'src/accessories/volumeFanAccessory.ts:Active.onGet',message:'active requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return value;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const active = value as number;
        this.log.info(`[DBG-H12] Active onSet zoneId=${this.zoneId} value=${active}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-10',hypothesisId:'H11',location:'src/accessories/volumeFanAccessory.ts:Active.onSet',message:'active set from HomeKit',data:{zoneId:this.zoneId,active},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (active === Characteristic.Active.ACTIVE) this.roon.play(this.zoneId);
        else this.roon.stop(this.zoneId);
      });

    svc.getCharacteristic(Characteristic.CurrentFanState).onGet(() => {
      const value = mapToCurrentFanState(getZ());
      this.log.info(`[DBG-H13] CurrentFanState onGet zoneId=${this.zoneId} value=${value}`);
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-10',hypothesisId:'H11',location:'src/accessories/volumeFanAccessory.ts:CurrentFanState.onGet',message:'current fan state requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return value;
    });
    // Volume slider.
    svc.getCharacteristic(Characteristic.Volume)
      .onGet(() => {
        const z = getZ();
        const value = z?.volumePercent ?? 0;
        this.log.info(`[DBG-H13] Volume onGet zoneId=${this.zoneId} value=${value}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-10',hypothesisId:'H11',location:'src/accessories/volumeFanAccessory.ts:Volume.onGet',message:'volume requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
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
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-10',hypothesisId:'H11',location:'src/accessories/volumeFanAccessory.ts:Volume.onSet',message:'volume set from HomeKit',data:{zoneId:this.zoneId,requested,isFinite:Number.isFinite(requested)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        this.roon.setVolume(this.zoneId, requested);
      });

    // Mirror HomeKit tile state.
    svc.getCharacteristic(Characteristic.TargetFanState)
      .onGet(() => Characteristic.TargetFanState.AUTO)
      .onSet(() => undefined);

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
      const activeState = z.state === 'stopped' ? Characteristic.Active.INACTIVE : Characteristic.Active.ACTIVE;
      const currentFanState =
        z.state === 'playing' ? Characteristic.CurrentFanState.BLOWING_AIR : Characteristic.CurrentFanState.IDLE;
      this.log.info(
        `[DBG-H11] applyZone zoneId=${this.zoneId} state=${z.state} active=${activeState} fanState=${currentFanState} volume=${z.volumePercent} muted=${z.isMuted}`,
      );
      try {
        svc.getCharacteristic(Characteristic.Active)!.updateValue(activeState);
      } catch (e) {
        this.log.error(`[DBG-H11E] active update failed zoneId=${this.zoneId} value=${activeState} err=${String(e)}`);
        throw e;
      }
      try {
        svc.getCharacteristic(Characteristic.CurrentFanState)!.updateValue(currentFanState);
      } catch (e) {
        this.log.error(`[DBG-H11E] currentFanState update failed zoneId=${this.zoneId} value=${currentFanState} err=${String(e)}`);
        throw e;
      }
      try {
        svc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      } catch (e) {
        this.log.error(`[DBG-H11E] volume update failed zoneId=${this.zoneId} value=${z.volumePercent} err=${String(e)}`);
        throw e;
      }
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-10',hypothesisId:'H11',location:'src/accessories/volumeFanAccessory.ts:applyZone',message:'applyZone fanv2 update payload',data:{zoneId:this.zoneId,state:z.state,activeState,currentFanState,volumePercent:z.volumePercent,isVolumeFinite:Number.isFinite(z.volumePercent),isMuted:z.isMuted},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

