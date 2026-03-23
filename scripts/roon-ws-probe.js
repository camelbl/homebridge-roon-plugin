#!/usr/bin/env node
/**
 * Test WebSocket upgrade to Roon Core (same URL node-roon-api uses).
 *
 * From host:
 *   docker cp scripts/roon-ws-probe.js homebridge:/tmp/
 *   docker exec homebridge node /tmp/roon-ws-probe.js
 *
 * Optional env (inside container):
 *   ROON_WS_HOST=192.168.1.12 ROON_WS_PORT=9150 node /tmp/roon-ws-probe.js
 */
const host = process.env.ROON_WS_HOST || 'host.docker.internal';
const port = parseInt(String(process.env.ROON_WS_PORT || '9150'), 10);
let WS;
try {
  WS = require('ws');
} catch {
  console.error('This container has no "ws" module (try: npm install -g ws in container, or run from host with node+ws).');
  process.exit(1);
}
const url = `ws://${host}:${port}/api`;
console.log('Connecting to', url);
const ws = new WebSocket(url);
const t = setTimeout(() => {
  console.error('FAIL: timeout (no open within 8s)');
  process.exit(2);
}, 8000);
ws.on('open', () => {
  clearTimeout(t);
  console.log('OK: WebSocket open (Roon should accept extension traffic on this URL).');
  ws.close();
  process.exit(0);
});
ws.on('error', (e) => {
  clearTimeout(t);
  console.error('FAIL:', e.message);
  process.exit(1);
});
