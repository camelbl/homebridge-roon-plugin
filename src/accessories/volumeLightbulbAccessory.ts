import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue, Service } from 'hap-nodejs';
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
    this.log.info(
      `[DBG-H1] volumeLightbulb wiring zoneId=${this.zoneId} service=Speaker hadLightbulb=${!!staleServices[0]} hadFanv2=${!!staleServices[1]} hadSmartSpeaker=${!!staleServices[2]}`,
    );
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H1',location:'src/accessories/volumeLightbulbAccessory.ts:35',message:'volumeLightbulb service wiring',data:{zoneId:this.zoneId,serviceType:'SmartSpeaker',hadLightbulb:!!staleServices[0],hadFanv2:!!staleServices[1],hadSpeaker:!!staleServices[2],model:'Volume (SmartSpeaker)'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const getZ = () => this.roon.getZones().find((z) => z.zone_id === this.zoneId);

    // Optional on Speaker, used as simple play/stop toggle in HomeKit.
    svc.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        const z = getZ();
        return (z?.state ?? 'stopped') === 'playing'
          ? Characteristic.Active.ACTIVE
          : Characteristic.Active.INACTIVE;
      })
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        const active = value === Characteristic.Active.ACTIVE;
        if (active) this.roon.play(this.zoneId);
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

    // Required by Speaker service.
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
      svc.getCharacteristic(Characteristic.Active)!.updateValue(
        z.state === 'playing' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
      );
      svc.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
      svc.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
    } finally {
      this.updatingFromRoon = false;
    }
  }
}

