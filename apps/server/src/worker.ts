import { getChannelImpl } from '@notify-hub/channels';
import type { RenderedMessage } from '@notify-hub/contracts';
import { backoffDelay } from '@notify-hub/core';
import type { DeliveryRow, Store } from '@notify-hub/store';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface WorkerLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface WorkerOptions {
  batch?: number;
  idleMs?: number;
  logger?: WorkerLogger;
  /** 供出口按名解析凭据（加密密钥库 → 环境变量） */
  resolveSecret?: (name: string) => string | undefined;
}

/** outbox 投递 worker（§5.6.3）：认领 pending → 调通道 → 成功/重试/死信。 */
export class OutboxWorker {
  private running = false;
  private readonly batch: number;
  private readonly idleMs: number;
  private readonly logger?: WorkerLogger;
  private readonly resolveSecret?: (name: string) => string | undefined;

  constructor(
    private readonly store: Store,
    opts: WorkerOptions = {},
  ) {
    this.batch = opts.batch ?? 20;
    this.idleMs = opts.idleMs ?? 1_000;
    this.logger = opts.logger;
    this.resolveSecret = opts.resolveSecret;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  /** 处理一批到期投递，返回处理条数（供测试同步驱动）。 */
  async tick(now: Date = new Date()): Promise<number> {
    const claimed = this.store.claimPending(this.batch, now);
    for (const d of claimed) await this.deliver(d, now);
    return claimed.length;
  }

  private async deliver(d: DeliveryRow, now: Date): Promise<void> {
    const ch = this.store.getChannelById(d.channelId);
    if (!ch) {
      this.store.markDead(d.id, '通道不存在');
      return;
    }
    const impl = getChannelImpl(ch.kind);
    if (!impl) {
      this.store.markDead(d.id, `无通道实现: ${ch.kind}`);
      return;
    }
    let cfg: unknown = {};
    let msg: RenderedMessage;
    try {
      cfg = JSON.parse(ch.configJson || '{}');
      msg = JSON.parse(d.renderedJson || '{}') as RenderedMessage;
    } catch (err) {
      this.store.markDead(d.id, `配置/消息解析失败: ${(err as Error).message}`);
      return;
    }

    let result: Awaited<ReturnType<typeof impl.send>>;
    try {
      result = await impl.send(msg, cfg, {
        channelId: ch.id,
        channelName: ch.name,
        deliveryId: d.id,
        attempt: d.attempts + 1,
        idempotencyKey: d.idempotencyKey,
        now,
        resolveSecret: (name: string) => this.resolveSecret?.(name) ?? process.env[name] ?? process.env[`NOTIFY_SECRET_${name}`],
      });
    } catch (err) {
      result = { ok: false, retryable: true, error: String(err) };
    }

    if (result.ok) {
      this.store.markSent(d.id, result.providerId ?? null, now);
      this.logger?.info({ delivery: d.id, channel: ch.name }, '已送达');
      return;
    }

    const attempts = d.attempts + 1;
    if (!result.retryable || attempts >= d.maxAttempts) {
      this.store.markDead(d.id, result.error);
      this.logger?.warn({ delivery: d.id, channel: ch.name, attempts, error: result.error }, '投递失败（死信）');
      return;
    }
    const next = new Date(now.getTime() + backoffDelay(attempts - 1));
    this.store.markRetry(d.id, attempts, next, result.error);
    this.logger?.warn(
      { delivery: d.id, channel: ch.name, attempts, next: next.toISOString(), error: result.error },
      '投递失败，稍后重试',
    );
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let n = 0;
      try {
        n = await this.tick();
      } catch (err) {
        this.logger?.error({ err }, 'worker tick 异常');
      }
      if (n === 0) await sleep(this.idleMs);
    }
  }
}
