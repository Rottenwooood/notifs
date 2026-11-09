import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function managementToken(configDir: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.NOTIFS_ADMIN_TOKEN) return env.NOTIFS_ADMIN_TOKEN;
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const file = join(configDir, 'admin-token');
  const token = randomBytes(32).toString('base64url');
  try { writeFileSync(file, `${token}\n`, { flag: 'wx', mode: 0o600 }); return token; }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; }
  const existing = readFileSync(file, 'utf8').trim();
  if (!existing) throw new Error('订阅管理凭据文件为空');
  return existing;
}
