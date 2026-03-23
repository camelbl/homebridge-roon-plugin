import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './constants';
import { RoonCompletePlatform } from './platform';

export = (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, RoonCompletePlatform);
};
