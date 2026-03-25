import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue } from 'homebridge';
import { RoonConnection } from '../roonConnection';

export class RadioAccessory {
  constructor(
    _log: Logger,
    api: API,
    accessory: PlatformAccessory,
    roon: RoonConnection,
    zoneId: string,
    zoneDisplayName: string,
    stationName: string,
    onSelected?: () => void,
  ) {
    const { Service, Characteristic } = api.hap;
    accessory.displayName = `${stationName} ${zoneDisplayName}`;
    accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Internet Radio');

    let sw = accessory.getService(Service.Switch);
    if (!sw) {
      sw = accessory.addService(Service.Switch, accessory.displayName);
    }

    sw.getCharacteristic(Characteristic.On)!.onSet((value: CharacteristicValue) => {
      const on = value as boolean;
      if (!on) return;
      onSelected?.();
      roon.playRadio(zoneId, stationName);
      setTimeout(() => {
        sw!.getCharacteristic(Characteristic.On)!.updateValue(false);
      }, 1000);
    });
  }
}
