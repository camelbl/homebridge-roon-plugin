#!/usr/bin/env node
/**
 * Find the Roon Core WebSocket extension port from inside the container.
 * Tests all ports Roon is listening on for HTTP WebSocket upgrade acceptance.
 *
 * docker cp scripts/roon-port-scan.js homebridge:/tmp/
 * docker exec homebridge node /tmp/roon-port-scan.js
 */
const net = require('net');
const crypto = require('crypto');

const host = process.env.ROON_HOST || 'host.docker.internal';
// All ports seen in ss -tlnp on the NUC (add/remove as needed)
const ports = [9100, 9150, 9330, 9331, 9332, 36751, 33837, 33597, 38815, 55000, 40313];

function testWsUpgrade(port) {
  return new Promise((resolve) => {
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

    const sock = net.connect(port, host, () => sock.write(req));
    let buf = '';
    const t = setTimeout(() => { sock.destroy(); resolve({ port, result: 'timeout' }); }, 3000);
    sock.on('data', (chunk) => {
      buf += chunk.toString('binary');
      if (buf.includes('\r\n')) {
        clearTimeout(t);
        const status = buf.split('\r\n')[0];
        sock.destroy();
        resolve({ port, result: buf.includes('101') ? 'WS_OK' : `HTTP:${status.slice(0, 60)}` });
      }
    });
    sock.on('error', (e) => { clearTimeout(t); resolve({ port, result: `ERR:${e.message}` }); });
  });
}

(async () => {
  console.log(`Scanning ${host} for Roon WebSocket API port...`);
  for (const port of ports) {
    const r = await testWsUpgrade(port);
    const marker = r.result === 'WS_OK' ? '✓ WS ACCEPTED' : r.result === 'timeout' ? '  timeout' : `  ${r.result}`;
    console.log(`  :${r.port}  ${marker}`);
  }
  console.log('Done. Port showing "WS ACCEPTED" is the extension API port.');
})();
