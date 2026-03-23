#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const host = process.env.HOMEBRIDGE_DEPLOY_HOST;
const user = process.env.HOMEBRIDGE_DEPLOY_USER || 'root';
const basePath = process.env.HOMEBRIDGE_DEPLOY_PATH;
const key = process.env.HOMEBRIDGE_DEPLOY_KEY;
const port = process.env.HOMEBRIDGE_DEPLOY_PORT || '22';

if (!host || !basePath) {
  console.error(
    'Set HOMEBRIDGE_DEPLOY_HOST and HOMEBRIDGE_DEPLOY_PATH.\n' +
      'Example: HOMEBRIDGE_DEPLOY_PATH=/path/on/host/to/homebridge/node_modules',
  );
  process.exit(1);
}

const root = path.join(__dirname, '..');
const remoteDir = `${basePath.replace(/\/$/, '')}/homebridge-roon-complete/`;
const target = `${user}@${host}:${remoteDir}`;

function shellQuote(s) {
  if (!/[^\w@%+=:,./-]/i.test(s)) return s;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

let ssh = `ssh -p ${shellQuote(String(port))}`;
if (key) {
  ssh += ` -i ${shellQuote(key)}`;
}

const sources = [path.join(root, 'dist') + '/', path.join(root, 'package.json'), path.join(root, 'config.schema.json')];

const r = spawnSync('rsync', ['-avz', '--delete', '-e', ssh, ...sources, target], {
  stdio: 'inherit',
  shell: false,
});

if (r.status !== 0) {
  console.error('rsync failed with code', r.status);
  process.exit(r.status ?? 1);
}

console.log('Deployed to', target);
