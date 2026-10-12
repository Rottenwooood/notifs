import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  dataDir: string;
  /** 监控程序清单目录（producers/*​/producer.json） */
  producersDir: string;
  /** Agent 生成的草稿目录 */
  draftsDir: string;
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
    draftsDir: env['NOTIFY_DRAFTS_DIR'] ?? resolve(dataDir, 'drafts'),
    baseUrl: env['NOTIFY_BASE_URL'] ?? `http://${host}:${port}`,
    stuckSendingMs: Number(env['NOTIFY_STUCK_MS'] ?? 5 * 60_000),
    workerIdleMs: Number(env['NOTIFY_WORKER_IDLE_MS'] ?? 1_000),
    logLevel: env['NOTIFY_LOG_LEVEL'] ?? 'info',
  };
}

/** LLM 提供方配置（Agent 生成监控程序用）。缺省时 authoring 不可用。 */
export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const model = env['NOTIFY_LLM_MODEL'];
  if (!model) return null;
  return {
    baseUrl: (env['NOTIFY_LLM_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model,
    apiKey: env['NOTIFY_LLM_API_KEY'] ?? env['OPENAI_API_KEY'],
  };
}

export function defaultDataDir(): string {
  return resolve(homedir(), '.local/share/notify-hub');
}
