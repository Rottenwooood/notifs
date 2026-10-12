import { pino } from 'pino';
import { openStore } from '@notify-hub/store';
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';
import { OutboxWorker } from './worker.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });

  const store = openStore(config.dbPath);
  store.migrate();
  const reset = store.resetStuckSending(config.stuckSendingMs);
  if (reset > 0) logger.warn({ count: reset }, '启动时重置了卡住的投递');

  const worker = new OutboxWorker(store, { logger, idleMs: config.workerIdleMs });
  worker.start();

  const app = buildServer({ store, logger, logLevel: config.logLevel });
  await app.listen({ host: config.host, port: config.port });
  logger.info({ host: config.host, port: config.port, db: config.dbPath }, 'notify-hub server 已启动');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, '正在关闭…');
    worker.stop();
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('启动失败:', err);
  process.exit(1);
});
