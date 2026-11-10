import { MessageClient } from '@notify-hub/core';
import { startFeishuInbound } from '@notify-hub/adapters';

const baseUrl = process.env.NOTIFS_BASE_URL ?? 'http://127.0.0.1:7710';
const token = process.env.NOTIFS_TOKEN;
const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
if (!token) throw new Error('缺少 NOTIFS_TOKEN（入站身份凭据）');
if (!verificationToken) throw new Error('缺少 FEISHU_VERIFICATION_TOKEN');

const client = new MessageClient({ baseUrl, token });
const server = await startFeishuInbound({
  client,
  verificationToken,
  host: process.env.FEISHU_INBOUND_HOST ?? '127.0.0.1',
  port: Number(process.env.FEISHU_INBOUND_PORT ?? 7720),
  path: process.env.FEISHU_INBOUND_PATH ?? '/feishu/events',
  log: line => console.log(line),
});
console.log(`feishu inbound listening on ${server.url}`);

const stop = async () => { await server.close(); client.close(); process.exit(0); };
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
