import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const dataDir = env.NOTIFS_DATA_DIR ?? join(env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'notifs');
  const configDir = env.NOTIFS_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'notifs');
  const host = env.NOTIFS_HOST ?? '127.0.0.1';
  const port = Number(env.NOTIFS_PORT ?? 7710);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('NOTIFS_PORT 非法');
  const retentionDays = Number(env.NOTIFS_RETENTION_DAYS ?? 30);
  const cleanupIntervalMs = Number(env.NOTIFS_CLEANUP_INTERVAL_MS ?? 3_600_000);
  if (!Number.isFinite(retentionDays) || retentionDays < 0) throw new Error('NOTIFS_RETENTION_DAYS 非法');
  if (!Number.isInteger(cleanupIntervalMs) || cleanupIntervalMs < 60_000) throw new Error('NOTIFS_CLEANUP_INTERVAL_MS 非法');
  return {
    host, port, dataDir, configDir, retentionDays, cleanupIntervalMs,
    dbPath: env.NOTIFS_DB ?? resolve(dataDir, 'hub.db'),
    socketPath: env.NOTIFS_SOCKET ?? join(dataDir, 'notifs.sock'),
    baseUrl: env.NOTIFS_BASE_URL ?? `http://${host}:${port}`,
    logLevel: env.NOTIFS_LOG_LEVEL ?? 'info',
  };
}
