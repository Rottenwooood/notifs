import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
export function controllerToken(configDir: string): string {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const path = join(configDir, 'controller-token');
  const token = randomBytes(32).toString('base64url');
  try { writeFileSync(path, `${token}\n`, { flag: 'wx', mode: 0o600 }); return token; }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; }
  const existing = readFileSync(path, 'utf8').trim();
  if (!existing) throw new Error('controller-token 文件为空');
  return existing;
}
export function clientToken(configDir: string): string {
  if (process.env.NOTIFS_TOKEN) return process.env.NOTIFS_TOKEN;
  try { return readFileSync(join(configDir, 'controller-token'), 'utf8').trim(); }
  catch { throw new Error('缺少身份凭据；人先运行 notifs init，agent/程序设置 NOTIFS_TOKEN'); }
}
