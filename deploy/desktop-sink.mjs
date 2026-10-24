#!/usr/bin/env node
// notifs desktop sink
//
// 服务器上的 notifs 通过反向 SSH 隧道把 webhook 打到这里，
// 这个进程调用 notify-send 把它变成真正的桌面通知。
//
// 只监听 127.0.0.1；正常部署下这个端口只有隧道能访问。

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.NOTIFS_SINK_PORT || 7711);
const TOKEN = process.env.NOTIFS_SINK_TOKEN || '';
const log = (...a) => console.error(new Date().toISOString(), ...a);

/** 幂等：hub 是至少一次投递，重试时不重复弹。只留最近 200 个 key。 */
const seen = new Set();
const order = [];
function firstTime(key) {
  if (!key) return true;
  if (seen.has(key)) return false;
  seen.add(key);
  order.push(key);
  if (order.length > 200) seen.delete(order.shift());
  return true;
}

function notify(title, body, severity) {
  const urgency = severity === 'critical' ? 'critical' : 'normal';
  return new Promise((resolve) => {
    execFile(
      'notify-send',
      ['--app-name=notifs', `--urgency=${urgency}`, title, body],
      (err) => resolve(!err),
    );
  });
}

createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/notify')) {
    res.writeHead(404).end();
    return;
  }
  if (TOKEN && req.headers['x-sink-token'] !== TOKEN) {
    res.writeHead(403).end('forbidden');
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy();
  });

  req.on('end', async () => {
    let msg = {};
    try {
      msg = JSON.parse(raw || '{}');
    } catch {
      log('[skip] body 不是 JSON');
    }

    const key = req.headers['x-notify-idempotency-key'];
    if (firstTime(key)) {
      const title = String(msg.title || 'notifs');
      const body = [msg.body, msg.url].filter(Boolean).join('\n');
      const ok = await notify(title, body, msg.severity);
      log(`[notify] ${ok ? 'ok' : 'FAILED'} ${title}`);
    }

    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  });
}).listen(PORT, '127.0.0.1', () => log(`[sink] listening 127.0.0.1:${PORT}`));
