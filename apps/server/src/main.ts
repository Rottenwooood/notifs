import { mkdirSync } from 'node:fs';
import { pino } from 'pino';
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';
import { controllerToken } from './credentials.ts';
import { KernelHost } from './kernel-host.ts';
import { listenMessagingIPC } from './ipc.ts';
import { startAdapters } from './adapters.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  mkdirSync(config.dataDir, {recursive: true, mode: 0o700});
  const logger = pino({level: config.logLevel});
  const token = controllerToken(config.configDir);
  const messaging = new KernelHost({dbPath: config.dbPath, adminToken: token});
  await messaging.call('authenticate', token);
  const ipc = await listenMessagingIPC(config.socketPath, messaging);
  const adapters = startAdapters(messaging, token, err => logger.warn({err}, '适配器交付失败；消息保留等待重试'));
  const app = buildServer({messaging, logLevel: config.logLevel});
  await app.listen({host: config.host, port: config.port});
  logger.info({address: app.server.address(), socket: config.socketPath}, 'notifs started');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await ipc.close(); await app.close(); await adapters.stop(); await messaging.close();
  };
  process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
}
main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
