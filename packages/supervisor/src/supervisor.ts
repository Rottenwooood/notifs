import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProducerManifest } from '@notify-hub/contracts';
import { backoffDelay } from '@notify-hub/core';
import type { StoredProducerConfig } from '@notify-hub/producers';
import type { ProducerRow, Store } from '@notify-hub/store';

export interface SupervisorLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface SupervisorOptions {
  /** 注入给子进程的 NOTIFY_BASE_URL */
  baseUrl: string;
  /** 心跳超时（视为卡死）后重启，默认 90s */
  healthTimeoutMs?: number;
  /** 健康检查周期，默认 15s */
  healthCheckIntervalMs?: number;
  /** 每个 producer 保留的日志行数，默认 500 */
  maxLogLines?: number;
  /** 重启退避表（毫秒），默认为 core 的 BACKOFF_MS */
  backoffMs?: number[];
  /** 凭据解析（加密密钥库 → 环境变量）；不提供则只查环境变量 */
  resolveSecret?: (name: string) => string | undefined;
  logger?: SupervisorLogger;
}

interface Running {
  child: ChildProcess;
  startedAt: number;
  stopping: boolean;
  killTimer?: NodeJS.Timeout;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 托管 managed 监控程序（§5.3.2）：启停、心跳、崩溃/卡死重启、日志。
 * 远程自部署的程序不经过这里，只遵守协议往中心推。
 */
export class Supervisor {
  private readonly running = new Map<string, Running>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly logs = new Map<string, string[]>();
  private readonly stateDirs = new Map<string, string>();
  private readonly healthTimeoutMs: number;
  private readonly healthCheckIntervalMs: number;
  private readonly maxLogLines: number;
  private healthTimer?: NodeJS.Timeout;

  constructor(
    private readonly store: Store,
    private readonly opts: SupervisorOptions,
  ) {
    this.healthTimeoutMs = opts.healthTimeoutMs ?? 90_000;
    this.healthCheckIntervalMs = opts.healthCheckIntervalMs ?? 15_000;
    this.maxLogLines = opts.maxLogLines ?? 500;
  }

  /** 启动：先对齐一次，再周期做健康检查。 */
  start(): void {
    this.reconcile();
    this.healthTimer = setInterval(() => this.handleHealth(), this.healthCheckIntervalMs);
    this.healthTimer.unref?.();
  }

  stop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    for (const t of this.restartTimers.values()) clearTimeout(t);
    this.restartTimers.clear();
    for (const id of [...this.running.keys()]) this.stopProducer(id);
  }

  /** 让启用状态与运行状态对齐（磁盘/DB 变化后调用）。 */
  reconcile(): void {
    for (const p of this.store.listProducers()) {
      if (p.kind !== 'managed') continue;
      const isRunning = this.running.has(p.id);
      if (p.enabled && !isRunning && !this.restartTimers.has(p.id)) this.startProducer(p.id);
      else if (!p.enabled && isRunning) this.stopProducer(p.id);
    }
  }

  startProducer(id: string): boolean {
    const p = this.store.getProducerById(id);
    if (!p || p.kind !== 'managed' || !p.enabled || this.running.has(id)) return false;

    const manifest = this.parseManifest(p);
    const command = manifest?.command ?? [];
    if (command.length === 0) {
      this.store.setProducerStatus(id, 'error', '缺少 command');
      return false;
    }
    const stateDir = p.stateDir ?? '';
    let token = '';
    try {
      token = readFileSync(join(stateDir, 'token'), 'utf8').trim();
    } catch {
      this.store.setProducerStatus(id, 'error', `token 文件缺失：${join(stateDir, 'token')}`);
      return false;
    }

    const child = spawn(command[0]!, command.slice(1), {
      cwd: manifest?.dir,
      env: {
        ...process.env,
        NOTIFY_BASE_URL: this.opts.baseUrl,
        NOTIFY_TOKEN: token,
        NOTIFY_PRODUCER_ID: id,
        NOTIFY_STATE_DIR: stateDir,
        NOTIFY_CONFIG: JSON.stringify(manifest?.config ?? {}),
        ...this.credentialEnv(manifest),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const run: Running = { child, startedAt: Date.now(), stopping: false };
    this.running.set(id, run);
    this.stateDirs.set(id, stateDir);
    this.appendLog(id, `[hub] 启动 pid=${child.pid ?? '?'}: ${command.join(' ')}`);
    child.stdout?.on('data', (d) => this.appendLog(id, this.prefixLines(d, '[out]')));
    child.stderr?.on('data', (d) => this.appendLog(id, this.prefixLines(d, '[err]')));
    child.on('error', (err) => {
      this.appendLog(id, `[hub] spawn 失败: ${err.message}`);
      this.store.setProducerStatus(id, 'error', err.message);
    });
    child.on('exit', (code, signal) => this.onExit(id, code, signal, run));

    this.store.setProducerPid(id, child.pid ?? null, 'running');
    return true;
  }

  stopProducer(id: string): void {
    const t = this.restartTimers.get(id);
    if (t) {
      clearTimeout(t);
      this.restartTimers.delete(id);
    }
    const run = this.running.get(id);
    if (!run) {
      this.store.setProducerPid(id, null, 'stopped');
      return;
    }
    run.stopping = true;
    this.appendLog(id, '[hub] 停止（SIGTERM）');
    run.child.kill('SIGTERM');
    run.killTimer = setTimeout(() => {
      this.appendLog(id, '[hub] 强杀（SIGKILL）');
      run.child.kill('SIGKILL');
    }, 10_000);
    run.killTimer.unref?.();
  }

  /** HTTP 心跳入口：收到健康心跳即重置退避计数。 */
  noteHeartbeat(id: string): void {
    this.store.resetProducerRestart(id);
  }

  logsFor(id: string): string[] {
    return this.logs.get(id) ?? [];
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** 心跳超时的 managed producer → 视为卡死并重启。 */
  handleHealth(now: number = Date.now()): string[] {
    const restarted: string[] = [];
    const idleBefore = new Map<string, number>();
    for (const [id, run] of this.running) {
      const p = this.store.getProducerById(id);
      if (!p) {
        this.stopProducer(id);
        continue;
      }
      if (!p.enabled) {
        this.stopProducer(id);
        continue;
      }
      const hb = p.lastHeartbeatAt ? Date.parse(p.lastHeartbeatAt) : null;
      const last = hb ?? run.startedAt;
      if (now - last > this.healthTimeoutMs) {
        this.opts.logger?.warn({ producer: p.sourceId, id }, '心跳超时，重启监控程序');
        this.appendLog(id, `[hub] 心跳超时（>${Math.round(this.healthTimeoutMs / 1000)}s），重启`);
        this.store.incProducerRestart(id, '心跳超时');
        idleBefore.set(id, last);
        this.killForRestart(id);
        restarted.push(id);
      }
    }
    return restarted;
  }

  private killForRestart(id: string): void {
    const run = this.running.get(id);
    if (!run) {
      this.scheduleRestart(id);
      return;
    }
    run.child.kill('SIGTERM');
    run.killTimer = setTimeout(() => run.child.kill('SIGKILL'), 10_000);
    run.killTimer.unref?.();
  }

  private onExit(id: string, code: number | null, signal: NodeJS.Signals | null, run: Running): void {
    this.running.delete(id);
    if (run.killTimer) clearTimeout(run.killTimer);

    const clean = code === 0;
    this.store.setProducerPid(id, null, clean ? 'stopped' : 'crashed');
    this.store.setProducerStatus(
      id,
      clean ? 'stopped' : 'crashed',
      clean ? null : `退出码 ${code}${signal ? ` / 信号 ${signal}` : ''}`,
    );
    this.appendLog(id, `[hub] 退出 code=${code} signal=${signal ?? '-'}`);

    const p = this.store.getProducerById(id);
    if (run.stopping || !p?.enabled) return; // 主动停止 / 已禁用 → 不重启
    if (clean) return; // 正常结束（exit 0）→ 按协议不重启

    const restarts = this.store.incProducerRestart(id, `退出码 ${code}`);
    const delay = backoffDelay(restarts - 1, { table: this.opts.backoffMs });
    this.opts.logger?.warn({ id, restarts, delayMs: delay }, '监控程序异常退出，稍后重启');
    this.scheduleRestart(id, delay);
  }

  private scheduleRestart(id: string, delayMs?: number): void {
    if (this.restartTimers.has(id)) return;
    const p = this.store.getProducerById(id);
    if (!p?.enabled) return;
    const delay = delayMs ?? backoffDelay(Math.max(0, p.restartCount - 1), { table: this.opts.backoffMs });
    const t = setTimeout(() => {
      this.restartTimers.delete(id);
      this.startProducer(id);
    }, delay);
    t.unref?.();
    this.restartTimers.set(id, t);
  }

  private parseManifest(p: ProducerRow): StoredProducerConfig | null {
    try {
      return JSON.parse(p.configJson ?? '{}') as StoredProducerConfig;
    } catch {
      return null;
    }
  }

  /** 声明式凭据注入：manifest 的 credentials 从加密密钥库/中心环境取值后注入子进程。 */
  private credentialEnv(manifest: StoredProducerConfig | null): Record<string, string> {
    const env: Record<string, string> = {};
    for (const name of manifest?.credentials ?? []) {
      const v =
        this.opts.resolveSecret?.(name) ?? process.env[name] ?? process.env[`NOTIFY_SECRET_${name}`];
      if (v !== undefined) env[name] = v;
    }
    return env;
  }

  private prefixLines(chunk: Buffer | string, prefix: string): string {
    return String(chunk)
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => `${prefix} ${l}`)
      .join('\n');
  }

  private appendLog(id: string, line: string): void {
    const lines = this.logs.get(id) ?? [];
    lines.push(...line.split('\n'));
    while (lines.length > this.maxLogLines) lines.shift();
    this.logs.set(id, lines);
    const stateDir = this.stateDirs.get(id);
    if (stateDir) {
      try {
        appendFileSync(join(stateDir, 'hub.log'), line + '\n');
      } catch {
        /* 日志落盘失败不影响运行 */
      }
    }
    this.opts.logger?.info({ producer: id }, line);
  }
}
