import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as lark from '@larksuiteoapi/node-sdk';
import { feishuMessageFromEvent, startFeishuInbound } from '@notify-hub/adapters';
import { MessageClient } from '@notify-hub/core';
import { acquireInstanceLock } from './lock.ts';

const baseUrl = process.env.NOTIFS_BASE_URL ?? 'http://127.0.0.1:7710';
const token = process.env.NOTIFS_TOKEN;
const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
const onlyRelevant = process.env.FEISHU_ONLY_RELEVANT !== 'false';
if (!token) throw new Error('缺少 NOTIFS_TOKEN（入站身份凭据）');

const lockId = createHash('sha256').update(appId ?? verificationToken ?? 'feishu-http').digest('hex').slice(0, 16);
const lockPath = process.env.FEISHU_LOCK_FILE ?? join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `notifs-feishu-${lockId}.lock`);
const releaseLock = acquireInstanceLock(lockPath);
process.on('exit', releaseLock);

const client = new MessageClient({ baseUrl, token });

async function publish(data: unknown): Promise<void> {
  const converted = feishuMessageFromEvent(data as Parameters<typeof feishuMessageFromEvent>[0], onlyRelevant);
  if (!converted) return;
  const result = await client.send(converted.message, { id: converted.idempotencyKey });
  console.log(`feishu inbound -> notifs ${result.id} recipients=${result.recipients.join(',')}`);
}

let close: () => Promise<void>;
let mode: string;

if (appId && appSecret) {
  // Real Feishu event subscription: the SDK holds an outbound WebSocket to Feishu.
  // No public URL, no local Feishu process, no inbound firewall rule.
  const wsClient = new lark.WSClient({
    appId,
    appSecret,
    domain: process.env.FEISHU_DOMAIN === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
    autoReconnect: true,
    onError: error => console.error(`feishu long connection error: ${error.message}`),
    onReconnecting: () => console.error('feishu long connection reconnecting'),
    onReconnected: () => console.log('feishu long connection reconnected'),
  });
  const dispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async data => {
      try { await publish(data); } catch (error) {
        console.error(`feishu inbound publish failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
  await wsClient.start({ eventDispatcher: dispatcher });
  mode = 'long-connection';
  close = async () => { wsClient.close({ force: true }); };
  console.log('feishu inbound: long connection started');
} else {
  // Fallback for deployments that receive Feishu HTTP event callbacks.
  if (!verificationToken) throw new Error('缺少 FEISHU_APP_ID/SECRET 或 FEISHU_VERIFICATION_TOKEN');
  const server = await startFeishuInbound({
    client,
    verificationToken,
    host: process.env.FEISHU_INBOUND_HOST ?? '127.0.0.1',
    port: Number(process.env.FEISHU_INBOUND_PORT ?? 7720),
    path: process.env.FEISHU_INBOUND_PATH ?? '/feishu/events',
    onlyRelevant,
    log: line => console.log(line),
  });
  mode = 'http-callback';
  close = server.close;
  console.log(`feishu inbound: HTTP callback listening on ${server.url}`);
}

const stop = async () => { await close(); client.close(); releaseLock(); process.exit(0); };
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
console.log(`feishu inbound mode=${mode}`);
