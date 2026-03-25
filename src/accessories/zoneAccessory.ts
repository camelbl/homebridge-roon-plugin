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
    private readonly deviceType: 'tv' | 'smartSpeaker' | 'speaker' = 'tv',
  ) {
    const { Service: Svc, Characteristic } = api.hap;

    const name = (this.accessory.context.zoneDisplayName as string) || 'Roon Zone';
    this.accessory.displayName = name;
    this.accessory
      .getService(Svc.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Zone');

    // Remove stale services from previous plugin versions / previous deviceType.
    for (const id of ['volume', 'mute']) {
      const s = this.accessory.getServiceById(Svc.Lightbulb, id);
      if (s) this.accessory.removeService(s);
    }
    for (const SvcType of [Svc.SmartSpeaker, Svc.Speaker, Svc.Television, Svc.TelevisionSpeaker]) {
      const s = this.accessory.getService(SvcType);
      if (s) this.accessory.removeService(s);
    }
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/8b52b340-8ba1-49eb-88ff-74b8697313f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'579cc3'},body:JSON.stringify({sessionId:'579cc3',runId:'run-1',hypothesisId:'H4',location:'src/accessories/zoneAccessory.ts:36',message:'zone accessory setup branch',data:{zoneId:this.zoneId,deviceType:this.deviceType,displayName:name},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (this.deviceType === 'tv') {
      this.setupTelevision(name, Svc, Characteristic);
    } else if (this.deviceType === 'speaker') {
      this.setupSpeaker(name, Svc, Characteristic);
    } else {
      this.setupSmartSpeaker(name, Svc, Characteristic);
    }
  }

  private applyZoneTv(
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

  private setupTelevision(
    name: string,
    Svc: typeof import('hap-nodejs').Service,
    Characteristic: typeof import('hap-nodejs').Characteristic,
  ): void {
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
        if (value === Characteristic.Active.ACTIVE) this.roon.play(this.zoneId);
        else this.roon.pause(this.zoneId);
      });

    tv.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => 1)
      .onSet(() => { /* no-op */ });

    let tvSpeaker = this.accessory.getService(Svc.TelevisionSpeaker);
    if (!tvSpeaker) {
      tvSpeaker = this.accessory.addService(Svc.TelevisionSpeaker);
    }
    tv.addLinkedService(tvSpeaker);
    tvSpeaker.setCharacteristic(
      Characteristic.VolumeControlType,
      Characteristic.VolumeControlType.RELATIVE_WITH_CURRENT,
    );

    tvSpeaker.getCharacteristic(Characteristic.Volume)!
      .onGet(() => this.roon.getZones().find((z) => z.zone_id === this.zoneId)?.volumePercent ?? 0)
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setVolume(this.zoneId, value as number);
      });

    tvSpeaker.getCharacteristic(Characteristic.Mute)!
      .onGet(() => this.roon.getZones().find((z) => z.zone_id === this.zoneId)?.isMuted ?? false)
      .onSet((value: CharacteristicValue) => {
        if (this.updatingFromRoon) return;
        this.roon.setMuted(this.zoneId, value as boolean);
      });

    tvSpeaker.getCharacteristic(Characteristic.VolumeSelector)!
      .onSet((value: CharacteristicValue) => {
        const increment = value === Characteristic.VolumeSelector.INCREMENT;
        this.roon.changeVolumeRelative(this.zoneId, increment ? 5 : -5);
      });

    this.roon.onZoneUpdate((z) => {
      if (z.zone_id !== this.zoneId) return;
      this.applyZoneTv(z, tv!, tvSpeaker!, Characteristic);
    });

    const initial = this.roon.getZones().find((z) => z.zone_id === this.zoneId);
    if (initial) {
      this.applyZoneTv(initial, tv, tvSpeaker, Characteristic);
    }
  }

  private setupSmartSpeaker(
    name: string,
    Svc: typeof import('hap-nodejs').Service,
    Characteristic: typeof import('hap-nodejs').Characteristic,
  ): void {
    let s = this.accessory.getService(Svc.SmartSpeaker);
    if (!s) s = this.accessory.addService(Svc.SmartSpeaker, name);
    s.setPrimaryService(true);
    s.setCharacteristic(Characteristic.ConfiguredName, name);
    s.addOptionalCharacteristic(Characteristic.Volume);
    s.addOptionalCharacteristic(Characteristic.Mute);

    s.getCharacteristic(Characteristic.TargetMediaState)!.onSet((value: CharacteristicValue) => {
      if (this.updatingFromRoon) return;
      const v = value as number;
      if (v === Characteristic.TargetMediaState.PAUSE) this.roon.pause(this.zoneId);
      else if (v === Characteristic.TargetMediaState.PLAY) this.roon.play(this.zoneId);
      else if (v === Characteristic.TargetMediaState.STOP) this.roon.stop(this.zoneId);
    });
    s.getCharacteristic(Characteristic.Volume)!.onSet((value: CharacteristicValue) => {
      if (this.updatingFromRoon) return;
      this.roon.setVolume(this.zoneId, value as number);
    });
    s.getCharacteristic(Characteristic.Mute)!.onSet((value: CharacteristicValue) => {
      if (this.updatingFromRoon) return;
      this.roon.setMuted(this.zoneId, value as boolean);
    });

    this.roon.onZoneUpdate((z) => {
      if (z.zone_id !== this.zoneId) return;
      this.updatingFromRoon = true;
      try {
        const { CurrentMediaState, TargetMediaState } = Characteristic;
        let cur = CurrentMediaState.STOP;
        if (z.state === 'playing') cur = CurrentMediaState.PLAY;
        else if (z.state === 'paused') cur = CurrentMediaState.PAUSE;
        else if (z.state === 'loading') cur = CurrentMediaState.LOADING;
        s!.getCharacteristic(CurrentMediaState)!.updateValue(cur);
        s!.getCharacteristic(TargetMediaState)!.updateValue(cur);
        s!.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
        s!.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
      } finally {
        this.updatingFromRoon = false;
      }
    });
  }

  private setupSpeaker(
    name: string,
    Svc: typeof import('hap-nodejs').Service,
    Characteristic: typeof import('hap-nodejs').Characteristic,
  ): void {
    let s = this.accessory.getService(Svc.Speaker);
    if (!s) s = this.accessory.addService(Svc.Speaker, name);
    s.setPrimaryService(true);
    s.setCharacteristic(Characteristic.ConfiguredName, name);

    s.getCharacteristic(Characteristic.On)!.onSet((value: CharacteristicValue) => {
      if (this.updatingFromRoon) return;
      if (value as boolean) this.roon.play(this.zoneId);
      else this.roon.pause(this.zoneId);
    });
    s.getCharacteristic(Characteristic.Volume)!.onSet((value: CharacteristicValue) => {
      if (this.updatingFromRoon) return;
      this.roon.setVolume(this.zoneId, value as number);
    });
    s.getCharacteristic(Characteristic.Mute)!.onSet((value: CharacteristicValue) => {
      if (this.updatingFromRoon) return;
      this.roon.setMuted(this.zoneId, value as boolean);
    });

    this.roon.onZoneUpdate((z) => {
      if (z.zone_id !== this.zoneId) return;
      this.updatingFromRoon = true;
      try {
        s!.getCharacteristic(Characteristic.On)!.updateValue(z.state === 'playing');
        s!.getCharacteristic(Characteristic.Volume)!.updateValue(z.volumePercent);
        s!.getCharacteristic(Characteristic.Mute)!.updateValue(z.isMuted);
      } finally {
        this.updatingFromRoon = false;
      }
    });
  }
}
