import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  dataDir: string;
  /** 监控程序清单目录（producers/*​/producer.json） */
  producersDir: string;
  /** 注入给托管子进程的 NOTIFY_BASE_URL */
  baseUrl: string;
  /** 卡在 sending 超过多久视为崩溃遗留，启动时重置 */
  stuckSendingMs: number;
  /** outbox worker 空闲轮询间隔 */
  workerIdleMs: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env['NOTIFY_DATA_DIR'] ?? resolve(process.cwd(), 'data');
  const host = env['NOTIFY_HOST'] ?? '127.0.0.1';
  const port = Number(env['NOTIFY_PORT'] ?? 7710);
  return {
    host,
    port,
    dbPath: env['NOTIFY_DB'] ?? resolve(dataDir, 'notify-hub.db'),
    dataDir,
    producersDir: env['NOTIFY_PRODUCERS_DIR'] ?? resolve(process.cwd(), 'producers'),
    baseUrl: env['NOTIFY_BASE_URL'] ?? `http://${host}:${port}`,
    stuckSendingMs: Number(env['NOTIFY_STUCK_MS'] ?? 5 * 60_000),
    workerIdleMs: Number(env['NOTIFY_WORKER_IDLE_MS'] ?? 1_000),
    logLevel: env['NOTIFY_LOG_LEVEL'] ?? 'info',
  };
}

export function defaultDataDir(): string {
  return resolve(homedir(), '.local/share/notify-hub');
}
