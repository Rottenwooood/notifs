import { watch, type FSWatcher } from 'node:fs';
import { pino } from 'pino';
import { openStore } from '@notify-hub/store';
import { syncProducers } from '@notify-hub/producers';
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';
import { ingestOne } from './ingest.ts';
import { OutboxWorker } from './worker.ts';
import { Supervisor } from '@notify-hub/supervisor';
import { PollerScheduler } from '@notify-hub/supervisor';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });

  const store = openStore(config.dbPath);
  store.migrate();
  const reset = store.resetStuckSending(config.stuckSendingMs);
  if (reset > 0) logger.warn({ count: reset }, '启动时重置了卡住的投递');

  // 磁盘清单 → DB（幂等），再让 Supervisor / PollerScheduler 对齐运行状态
  const sync = syncProducers(store, { producersDir: config.producersDir, dataDir: config.dataDir });
  for (const e of sync.errors) logger.warn({ dir: e.dir }, `producer 清单问题: ${e.error}`);
  if (sync.entries.length > 0) {
    logger.info({ producers: sync.entries.map((e) => `${e.slug}(${e.action})`) }, '已同步监控程序清单');
  }

  const worker = new OutboxWorker(store, { logger, idleMs: config.workerIdleMs });
  worker.start();

  const supervisor = new Supervisor(store, { baseUrl: config.baseUrl, logger });
  supervisor.start();

  // 监控程序目录变化 → 重新同步并启停（这样"放一个目录进去"就生效，无需重启）
  let watcher: FSWatcher | undefined;
  let reloadTimer: NodeJS.Timeout | undefined;
  try {
    watcher = watch(config.producersDir, { recursive: true }, () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        const r = syncProducers(store, { producersDir: config.producersDir, dataDir: config.dataDir });
        for (const e of r.errors) logger.warn({ dir: e.dir }, `producer 清单问题: ${e.error}`);
        supervisor.reconcile();
        logger.info({ count: r.entries.length }, '监控程序目录变化，已重新同步');
      }, 500);
      reloadTimer.unref?.();
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '无法监听监控程序目录（改动后需重启才生效）');
  }

  const pollers = new PollerScheduler(store, {
    logger,
    secrets: (names) => {
      const out: Record<string, string | undefined> = {};
      for (const n of names ?? []) out[n] = process.env[n] ?? process.env[`NOTIFY_SECRET_${n}`];
      return out;
    },
    onEvent: (sourceName, event) => {
      const source = store.getSourceByName(sourceName);
      if (!source) return;
      const outcome = ingestOne(source, event, { store });
      if (!outcome.accepted) logger.warn({ source: sourceName, error: outcome.error }, 'poller 事件被拒');
    },
  });
  pollers.start();

  const app = buildServer({
    store,
    logger,
    logLevel: config.logLevel,
    onHeartbeat: (id) => supervisor.noteHeartbeat(id),
  });
  await app.listen({ host: config.host, port: config.port });
  logger.info({ host: config.host, port: config.port, db: config.dbPath }, 'notify-hub server 已启动');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, '正在关闭…');
    if (reloadTimer) clearTimeout(reloadTimer);
    watcher?.close();
    pollers.stop();
    supervisor.stop();
    worker.stop();
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
