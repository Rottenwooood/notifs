import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { MessagingError, type MessagingService } from '@notify-hub/contracts';

import { FrameDecoder, encodeFrame } from '../../../packages/core/src/framing.ts';
const MAX_FRAME = 1_048_576;
export async function listenMessagingIPC(path: string, service: MessagingService): Promise<{ server: Server; close(): Promise<void> }> {
  // Never unlink an arbitrary path or a socket owned by a running instance.
  if (existsSync(path)) {
    const old = lstatSync(path);
    if (!old.isSocket() || (process.getuid && old.uid !== process.getuid())) throw new Error(`拒绝覆盖非本用户 socket：${path}`);
    const active = await new Promise<boolean>((resolve, reject) => {
      const probe = createConnection(path);
      probe.once('connect', () => { probe.destroy(); resolve(true); });
      probe.once('error', err => {
        if (['ECONNREFUSED', 'ENOENT'].includes((err as NodeJS.ErrnoException).code ?? '')) resolve(false);
        else reject(err);
      });
      probe.setTimeout(1000, () => { probe.destroy(); resolve(true); });
    });
    if (active) throw new Error(`已有中心占用 IPC：${path}`);
    if (existsSync(path) && lstatSync(path).ino === old.ino) unlinkSync(path);
  }
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    const decoder = new FrameDecoder();
    const calls = new Map<string, AbortController>();
    let token: string | undefined;
    let authenticating = false;
    const send = (value: unknown) => {
      if (socket.destroyed) return;
      if (socket.writableLength > 2 * MAX_FRAME) { socket.destroy(); return; }
      socket.write(encodeFrame(value));
    };
    socket.on('data', chunk => {
      try {
        decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, value => {
          const req = value as { id?: unknown; operation?: unknown; token?: unknown; input?: unknown };
          if (!req || typeof req !== 'object' || typeof req.id !== 'string' || req.id.length > 100 || typeof req.operation !== 'string') throw new MessagingError('invalid_frame', '非法 IPC 请求');
          const id = req.id;
          if (calls.has(id)) throw new MessagingError('invalid_frame', 'IPC 请求编号重复');
          if (calls.size >= 32) { send({ id, error: { code: 'overloaded', message: '连接请求过多', status: 429 } }); return; }
          if (!token && (req.operation !== 'authenticate' || typeof req.token !== 'string' || authenticating)) {
            send({ id, error: { code: 'unauthorized', message: '请先认证连接', status: 401 } }); return;
          }
          if (token && (req.operation === 'authenticate' || req.token !== undefined)) throw new MessagingError('invalid_frame', '已认证连接不能变更身份');
          const authToken = token ?? req.token as string;
          if (!token) authenticating = true;
          const controller = new AbortController(); calls.set(id, controller);
          void service.call(req.operation, authToken, req.input ?? {}, controller.signal).then(result => {
            if (req.operation === 'authenticate') token = authToken;
            send({ id, result });
          }).catch(cause => {
            if (socket.destroyed) return;
            const err = cause instanceof MessagingError ? cause : new MessagingError('internal_error', '通信服务不可用', 503);
            send({ id, error: { code: err.code, message: err.message, status: err.status } });
          }).finally(() => { authenticating = false; calls.delete(id); });
        });
      } catch { socket.destroy(); }
    });
    socket.on('close', () => { sockets.delete(socket); for (const controller of calls.values()) controller.abort(); calls.clear(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => { server.off('error', reject); resolve(); });
  });
  chmodSync(path, 0o600);
  const inode = lstatSync(path).ino;
  return { server, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    if (existsSync(path) && lstatSync(path).ino === inode) unlinkSync(path);
  } };
}
