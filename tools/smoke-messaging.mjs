#!/usr/bin/env node
// Supplementary smoke test; does not replace external OpenCode acceptance.
// Uses only an isolated temp directory and local sockets. Run after node tools/build.mjs.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'notifs-e2e-'));
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const { port } = reserve.address();
await new Promise(resolve => reserve.close(resolve));
const env = { ...process.env, NOTIFY_DATA_DIR: join(dir, 'data'), NOTIFS_CONFIG_DIR: join(dir, 'config'), NOTIFY_PORT: String(port), NOTIFY_LOG_LEVEL: 'error', NOTIFS_SOCKET: join(dir, 'hub.sock') };
delete env.NOTIFS_ADMIN_TOKEN; delete env.NOTIFS_TOKEN; delete env.NOTIFY_TOKEN; delete env.NOTIFY_DB; delete env.NOTIFY_BASE_URL;
const cli = resolve('dist/cli.mjs');
async function command(args, token) {
  const { stdout } = await run(process.execPath, [cli, ...args], { env: { ...env, ...(token ? { NOTIFS_TOKEN: token } : {}) } });
  return JSON.parse(stdout);
}
let server;
let logs = '';
async function start() {
  server = spawn(process.execPath, [resolve('dist/server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', x => { logs += x; }); server.stderr.on('data', x => { logs += x; });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await delay(30);
  }
  throw new Error(`Service not ready: ${logs}`);
}
async function stop(signal = 'SIGTERM') {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill(signal);
  const timeout = setTimeout(() => server.kill('SIGKILL'), 3000);
  await exited; clearTimeout(timeout);
}
try {
  await run(process.execPath, [cli, 'init'], { env });
  await start();
  const sender = await command(['identity', 'add', 'sender']);
  const sister = await command(['identity', 'add', 'sister']);
  await command(['endpoint', 'put', '--config', JSON.stringify({ name: 'sister', owner: 'sister', max_wait_ms: 50 })]);
  await command(['subscription', 'put', '--config', JSON.stringify({ name: 'all', endpoint: 'sister', source: 'sender', type: 'message' })]);
  const published = await command(['message', 'send', '--type', 'message', '--content', '{"result":[1,"中文"]}', '--id', 'once', '--to', 'sister'], sender.token);
  const received = await command(['message', 'receive', 'sister', '--wait', '1', '--socket', env.NOTIFS_SOCKET], sister.token);
  assert.equal(received.batch.messages[0].id, published.id);
  assert.deepEqual(received.batch.messages[0].content, { result: [1, '中文'] });
  await command(['message', 'ack', received.batch.id, '--lease', received.batch.lease], sister.token);
  const duplicate = await command(['message', 'send', '--type', 'message', '--content', '{"result":[1,"中文"]}', '--id', 'once', '--to', 'sister', '--socket', env.NOTIFS_SOCKET], sender.token);
  assert.equal(duplicate.id, published.id); assert.equal(duplicate.deduplicated, true);
  await command(['message', 'send', 'survives restart', '--type', 'message'], sender.token);
  await stop('SIGKILL'); await start();
  const recovered = await command(['message', 'receive', 'sister', '--wait', '1'], sister.token);
  assert.equal(recovered.batch.messages[0].content, 'survives restart');
  await command(['message', 'ack', recovered.batch.id, '--lease', recovered.batch.lease, '--socket', env.NOTIFS_SOCKET], sister.token);
  assert.deepEqual(await command(['message', 'receive', 'sister'], sister.token), { batch: null });
  const legacy = await readFile(join(env.NOTIFS_CONFIG_DIR, 'token'), 'utf8');
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/events`, {
    method: 'POST', headers: { authorization: `Bearer ${legacy.trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'legacy.works', text: 'unchanged' }),
  });
  assert.equal(response.status, 202);
  console.log('PASS: packaged service + CLI, HTTP/IPC, exact JSON, idempotent retry, restart recovery, legacy API');
} finally { await stop(); await rm(dir, { recursive: true, force: true }); }
