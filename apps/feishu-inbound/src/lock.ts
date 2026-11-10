import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Fail fast when two Feishu long-connection bridges use the same app.
 * Stale PID files are removed; a live owner is never preempted.
 */
export function acquireInstanceLock(path: string, pid = process.pid): () => void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      writeFileSync(fd, `${pid}\n`, 'utf8');
      closeSync(fd);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try { unlinkSync(path); } catch { /* already removed */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = Number(readFileSync(path, 'utf8').trim());
      if (Number.isInteger(owner) && owner > 0 && alive(owner)) {
        throw new Error(`飞书 bridge 已在运行 (pid ${owner})，同一应用不能启动两个长连接客户端`);
      }
      try { unlinkSync(path); } catch { /* raced */ }
    }
  }
  throw new Error(`无法取得飞书单实例锁：${path}`);
}
