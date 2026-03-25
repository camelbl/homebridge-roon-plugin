import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue } from 'hap-nodejs';
import { RoonConnection } from '../roonConnection';

export class GenreAccessory {
  constructor(
    _log: Logger,
    api: API,
    accessory: PlatformAccessory,
    roon: RoonConnection,
    zoneId: string,
    zoneDisplayName: string,
    genreName: string,
    onSelected?: () => void,
  ) {
    const { Service, Characteristic } = api.hap;
    accessory.displayName = `${genreName} ${zoneDisplayName}`;
    accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Genre');

    let sw = accessory.getService(Service.Switch);
    if (!sw) {
      sw = accessory.addService(Service.Switch, accessory.displayName);
    }

    sw.getCharacteristic(Characteristic.On)!.onSet((value: CharacteristicValue) => {
      const on = value as boolean;
      if (!on) return;
      onSelected?.();
      roon.playGenre(zoneId, genreName);
      setTimeout(() => {
        sw!.getCharacteristic(Characteristic.On)!.updateValue(false);
      }, 1000);
    });
  }
}
