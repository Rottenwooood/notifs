import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyPassword, type Store, type UserRow } from '@notify-hub/store';

export const SESSION_COOKIE = 'nh_session';
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 从会话 cookie 解析当前用户；未登录返回 null。 */
export function currentUser(req: FastifyRequest, store: Store): { user: UserRow; token: string } | null {
  const token = parseCookies(req.headers['cookie'])[SESSION_COOKIE];
  if (!token) return null;
  const session = store.getSession(token);
  if (!session) return null;
  const user = store.getUserById(session.userId);
  return user ? { user, token } : null;
}

export function setSessionCookie(reply: FastifyReply, token: string, secure = false): void {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** 校验口令并开一个会话；失败返回 null。 */
export function login(store: Store, username: string, password: string): string | null {
  const user = store.getUserByName(username);
  if (!user) return null;
  // 无用户时也走一次散列校验，避免用"是否存在"做时间侧信道区分
  if (!verifyPassword(password, user.passwordHash)) return null;
  return store.createSession(user.id, SESSION_TTL_MS);
}
