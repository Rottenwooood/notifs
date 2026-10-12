import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { ProducerManifest } from '@notify-hub/contracts';

export interface TrialResult {
  /** 程序在试运行期间"将会上报"的事件（已被拦下，没有真的入库/通知） */
  events: unknown[];
  heartbeatCount: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

export interface TrialOptions {
  /** 试运行多久后掐掉，默认 15 秒 */
  timeoutMs?: number;
  baseEnv?: NodeJS.ProcessEnv;
  /** 额外注入（测试用） */
  extraEnv?: Record<string, string>;
}

/**
 * 试运行（§5.4.1）：把程序指向一个**只记录、不转发**的接收端跑一小段时间，
 * 看它"将会上报什么"。这是审核阶段最重要的信任来源——程序是真人协议，但输出被拦截。
 */
export async function trialRun(
  dir: string,
  manifest: ProducerManifest,
  opts: TrialOptions = {},
): Promise<TrialResult> {
  const events: unknown[] = [];
  let heartbeatCount = 0;

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        if (req.url?.endsWith('/heartbeat')) heartbeatCount += 1;
        else if (req.url?.endsWith('/events')) {
          const parsed = body ? (JSON.parse(body) as unknown) : {};
          if (Array.isArray(parsed)) events.push(...parsed);
          else events.push(parsed);
        }
      } catch {
        /* 忽略无法解析的 body */
      }
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end('{"accepted":true,"deduplicated":false,"event_ids":[]}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  const command = manifest.command ?? [];
  const env: NodeJS.ProcessEnv = {
    ...(opts.baseEnv ?? process.env),
    ...(opts.extraEnv ?? {}),
    NOTIFY_BASE_URL: `http://127.0.0.1:${port}`,
    NOTIFY_TOKEN: 'trial',
    NOTIFY_PRODUCER_ID: 'trial',
    NOTIFY_STATE_DIR: join(dir, '.trial-state'),
    NOTIFY_CONFIG: JSON.stringify(manifest.config ?? {}),
  };
  for (const name of manifest.credentials ?? []) {
    const v = (opts.baseEnv ?? process.env)[name] ?? (opts.baseEnv ?? process.env)[`NOTIFY_SECRET_${name}`];
    if (v !== undefined) env[name] = v;
  }

  const startedAt = Date.now();
  const child = spawn(command[0] ?? 'node', command.slice(1), {
    cwd: dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d) => (stdout += String(d)));
  child.stderr?.on('data', (d) => (stderr += String(d)));

  let timedOut = false;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2_000).unref?.();
  }, timeoutMs);
  timer.unref?.();

  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on('exit', (c, s) => resolve({ code: c, signal: s }));
      child.on('error', () => resolve({ code: null, signal: null }));
    },
  );
  clearTimeout(timer);
  await new Promise<void>((r) => server.close(() => r()));

  return {
    events,
    heartbeatCount,
    stdout: stdout.slice(-4000),
    stderr: stderr.slice(-4000),
    exitCode: code,
    signal,
    timedOut,
    durationMs: Date.now() - startedAt,
  };
}
