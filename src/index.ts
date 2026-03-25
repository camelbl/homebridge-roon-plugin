import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './constants';
import { RoonControlPlatform } from './platform';

export = (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, RoonControlPlatform);
};
