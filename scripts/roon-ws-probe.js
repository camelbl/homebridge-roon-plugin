#!/usr/bin/env node
/**
 * Test WebSocket upgrade to Roon Core — uses raw net module (no 'ws' needed).
 * Also checks if ws module is available from the plugin's own node_modules.
 *
 * From host:
 *   docker cp scripts/roon-ws-probe.js homebridge:/tmp/
 *   docker exec homebridge node /tmp/roon-ws-probe.js
 */
const net = require('net');
const crypto = require('crypto');
const path = require('path');

const host = process.env.ROON_WS_HOST || 'host.docker.internal';
const port = parseInt(String(process.env.ROON_WS_PORT || '9150'), 10);

console.log(`Probing ws://${host}:${port}/api via raw TCP WebSocket upgrade...`);

const key = crypto.randomBytes(16).toString('base64');
const req = [
  `GET /api HTTP/1.1`,
  `Host: ${host}:${port}`,
  `Upgrade: websocket`,
  `Connection: Upgrade`,
  `Sec-WebSocket-Key: ${key}`,
  `Sec-WebSocket-Version: 13`,
  `\r\n`,
].join('\r\n');

const sock = net.connect(port, host, () => {
  sock.write(req);
});

let buf = '';
const t = setTimeout(() => {
  console.error('FAIL: timeout (no HTTP response within 8s)');
  sock.destroy();
  process.exit(2);
}, 8000);

sock.on('data', (chunk) => {
  buf += chunk.toString('binary');
  if (buf.includes('\r\n\r\n')) {
    clearTimeout(t);
    const statusLine = buf.split('\r\n')[0];
    if (buf.includes('101')) {
      console.log('OK: WebSocket upgrade accepted (HTTP 101) — Roon /api path is reachable.');
    } else {
      console.error('FAIL: unexpected HTTP response:', statusLine);
    }
    sock.destroy();
    process.exit(buf.includes('101') ? 0 : 1);
  }
});

sock.on('error', (e) => {
  clearTimeout(t);
  console.error('FAIL (TCP):', e.message);
  process.exit(1);
});

// Also check if the plugin's ws module is reachable
const pluginSrc = '/var/lib/homebridge/homebridge-roon-complete-src';
try {
  const ws = require(path.join(pluginSrc, 'node_modules', 'ws'));
  console.log('Plugin ws module: found at', path.join(pluginSrc, 'node_modules', 'ws'));
} catch (e) {
  console.warn('Plugin ws module: NOT found at', path.join(pluginSrc, 'node_modules', 'ws'),
    '— node-roon-api may fail. Run: npm install --omit=dev --prefix', pluginSrc);
}
