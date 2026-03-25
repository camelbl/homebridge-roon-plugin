import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { CharacteristicValue } from 'homebridge';
import { RoonConnection } from '../roonConnection';

export class PlaylistAccessory {
  constructor(
    _log: Logger,
    api: API,
    accessory: PlatformAccessory,
    roon: RoonConnection,
    zoneId: string,
    zoneDisplayName: string,
    playlistName: string,
  ) {
    const { Service, Characteristic } = api.hap;
    accessory.displayName = `${playlistName} ${zoneDisplayName}`;
    accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Roon')
      .setCharacteristic(Characteristic.Model, 'Playlist');

    let sw = accessory.getService(Service.Switch);
    if (!sw) {
      sw = accessory.addService(Service.Switch, accessory.displayName);
    }

    sw.getCharacteristic(Characteristic.On)!.onSet((value: CharacteristicValue) => {
      const on = value as boolean;
      if (!on) return;
      roon.playPlaylist(zoneId, playlistName);
      setTimeout(() => {
        sw!.getCharacteristic(Characteristic.On)!.updateValue(false);
      }, 1000);
    });
  }
}
