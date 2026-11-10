import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireInstanceLock } from '../apps/feishu-inbound/src/lock.ts';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });

describe('Feishu instance lock', () => {
  it('rejects a second live owner and releases cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notifs-feishu-lock-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'bridge.lock');
    const release = acquireInstanceLock(path, process.pid);
    expect(() => acquireInstanceLock(path, process.pid)).toThrow('已在运行');
    release();
    const again = acquireInstanceLock(path, process.pid);
    expect(readFileSync(path, 'utf8').trim()).toBe(String(process.pid));
    again();
  });

  it('removes a stale owner instead of blocking forever', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notifs-feishu-lock-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'bridge.lock');
    writeFileSync(path, '999999\n');
    const release = acquireInstanceLock(path, process.pid);
    expect(readFileSync(path, 'utf8').trim()).toBe(String(process.pid));
    release();
  });
});
