import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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

// ------------------------------------------------------------------ 口令

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');
  const actual = scryptSync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
