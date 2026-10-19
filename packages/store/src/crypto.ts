import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 主密钥：数据目录下 600 权限的随机 32 字节；不存在则生成。 */
export function loadOrCreateMasterKey(path: string): Buffer {
  if (existsSync(path)) return readFileSync(path);
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* 某些文件系统不支持，忽略 */
  }
  return key;
}

/** AES-256-GCM 封装。格式：base64(iv):base64(tag):base64(ciphertext)。 */
export function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function open_(key: Buffer, sealed: string): string {
  const [ivB64, tagB64, ctB64] = sealed.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('密文格式非法');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
