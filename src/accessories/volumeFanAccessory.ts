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
      .setCharacteristic(Characteristic.Model, 'Volume (Lightbulb)')
      .setCharacteristic(Characteristic.SerialNumber, serial);
    this.log.info(
      `[DBG-H16] accessory info zoneId=${this.zoneId} serial=${String(infoSvc.getCharacteristic(Characteristic.SerialNumber).value ?? '')} expectedSerial=${serial} category=${this.accessory.category}`,
    );
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-8',hypothesisId:'H7',location:'src/accessories/volumeFanAccessory.ts:constructor',message:'accessory info snapshot',data:{zoneId:this.zoneId,serial:String(infoSvc.getCharacteristic(Characteristic.SerialNumber).value ?? ''),expectedSerial:serial,category:this.accessory.category},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Cleanup from older versions (Fan/Speaker/SmartSpeaker).
    const staleServices = [Svc.Fanv2, Svc.Speaker, Svc.SmartSpeaker].map((T) => this.accessory.getService(T));
    for (const s of staleServices) {
      if (s) this.accessory.removeService(s);
    }

    let svc = this.accessory.getService(Svc.Lightbulb) as Service | undefined;
    if (!svc) {
      svc = this.accessory.addService(Svc.Lightbulb, name);
    }
    svc.setPrimaryService(true);
    svc.setCharacteristic(Characteristic.ConfiguredName, name);
    svc.setCharacteristic(Characteristic.Name, name);
    this.log.info(
      `[DBG-H1] volumeFan wiring zoneId=${this.zoneId} service=Lightbulb hadFanv2=${!!staleServices[0]} hadSpeaker=${!!staleServices[1]} hadSmartSpeaker=${!!staleServices[2]}`,
    );
    this.log.info(
      `[DBG-H8] volumeFan service-map zoneId=${this.zoneId} services=${this.accessory.services.map((s) => s.UUID).join(',')} primaryUUID=${svc.UUID}`,
    );
    const getZ = () => this.roon.getZones().find((z) => z.zone_id === this.zoneId);

    const mapToOn = (z: Zone | undefined): boolean => {
      const state = z?.state ?? 'stopped';
      return state !== 'stopped';
    };

    // Lightbulb power maps to stream stop/play.
    svc.getCharacteristic(Characteristic.On)
      .onGet(() => {
        const value = mapToOn(getZ());
        this.log.info(`[DBG-H13] On onGet zoneId=${this.zoneId} value=${value}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-12',hypothesisId:'H12',location:'src/accessories/volumeFanAccessory.ts:On.onGet',message:'on requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return value;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const on = value as boolean;
        this.log.info(`[DBG-H12] On onSet zoneId=${this.zoneId} value=${on}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-12',hypothesisId:'H12',location:'src/accessories/volumeFanAccessory.ts:On.onSet',message:'on set from HomeKit',data:{zoneId:this.zoneId,on},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (on) this.roon.play(this.zoneId);
        else this.roon.stop(this.zoneId);
      });

    // Lightbulb slider (Brightness) mapped to zone volume percent.
    svc.getCharacteristic(Characteristic.Brightness)
      .onGet(() => {
        const z = getZ();
        const value = z?.volumePercent ?? 0;
        this.log.info(`[DBG-H13] Brightness onGet zoneId=${this.zoneId} value=${value}`);
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-12',hypothesisId:'H12',location:'src/accessories/volumeFanAccessory.ts:Brightness.onGet',message:'brightness requested by HomeKit',data:{zoneId:this.zoneId,value},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return value;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const requested = value as number;
        this.log.info(
          `[DBG-H12] brightness onSet zoneId=${this.zoneId} requested=${requested} isFinite=${Number.isFinite(requested)}`,
        );
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-12',hypothesisId:'H12',location:'src/accessories/volumeFanAccessory.ts:Brightness.onSet',message:'brightness set from HomeKit',data:{zoneId:this.zoneId,requested,isFinite:Number.isFinite(requested)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        this.roon.setVolume(this.zoneId, requested);
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
      const on = z.state !== 'stopped';
      this.log.info(
        `[DBG-H11] applyZone zoneId=${this.zoneId} state=${z.state} on=${on} brightness=${z.volumePercent} muted=${z.isMuted}`,
      );
      try {
        svc.getCharacteristic(Characteristic.On)!.updateValue(on);
      } catch (e) {
        this.log.error(`[DBG-H11E] on update failed zoneId=${this.zoneId} value=${on} err=${String(e)}`);
        throw e;
      }
      try {
        svc.getCharacteristic(Characteristic.Brightness)!.updateValue(z.volumePercent);
      } catch (e) {
        this.log.error(`[DBG-H11E] brightness update failed zoneId=${this.zoneId} value=${z.volumePercent} err=${String(e)}`);
        throw e;
      }
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-12',hypothesisId:'H12',location:'src/accessories/volumeFanAccessory.ts:applyZone',message:'applyZone lightbulb update payload',data:{zoneId:this.zoneId,state:z.state,on,brightness:z.volumePercent,isBrightnessFinite:Number.isFinite(z.volumePercent),isMuted:z.isMuted},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

