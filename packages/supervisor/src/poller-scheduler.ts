import type { EventInput } from '@notify-hub/contracts';
import { parseInterval, runPoller, type PollerState, type StoredProducerConfig } from '@notify-hub/producers';
import type { ProducerRow, Store } from '@notify-hub/store';
import type { SupervisorLogger } from './supervisor.ts';

export interface PollerSchedulerOptions {
  /** 轮询命中变化时回调（由中心注入 ingest）。 */
  onEvent: (sourceName: string, event: EventInput) => void;
  /** 解析 {{secrets.NAME}}：默认从环境变量取。 */
  secrets?: (names: string[] | undefined) => Record<string, string | undefined>;
  logger?: SupervisorLogger;
  tickMs?: number;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 中心内建的 Poller 调度（§5.3.3）：按各自 interval 跑声明式轮询，
 * 命中变化就把事件交给中心。请求失败时**不推进快照**，只标记 degraded。
 */
export class PollerScheduler {
  private running = false;
  private readonly nextRun = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: Store,
    private readonly opts: PollerSchedulerOptions,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.tickOnce(), this.opts.tickMs ?? 1_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  /** 到期的 poller 各跑一次；返回本轮实际执行的数量。 */
  async tickOnce(now: number = Date.now()): Promise<number> {
    if (!this.running) return 0;
    let ran = 0;
    for (const p of this.store.listProducers()) {
      if (p.kind !== 'poller' || !p.enabled) continue;
      const due = this.nextRun.get(p.id) ?? 0;
      // 首次（due=0）立即跑；之后按 interval 排期
      const next = due === 0 ? now : due;
      if (now < next) continue;
      this.nextRun.set(p.id, now + this.intervalOf(p));
      try {
        await this.runOnce(p.id);
        ran++;
      } catch (err) {
        this.store.setProducerStatus(p.id, 'degraded', message(err));
        this.opts.logger?.warn({ producer: p.id, err: message(err) }, 'poller 轮询失败');
      }
    }
    return ran;
  }

  /** 跑一次指定 poller（供测试 / CLI 手动触发）。返回产出事件数。 */
  async runOnce(producerId: string): Promise<number> {
    const p = this.store.getProducerById(producerId);
    if (!p || p.kind !== 'poller') throw new Error('不是 poller');
    const manifest = this.parseManifest(p);
    if (!manifest?.poller) throw new Error('缺少 poller 配置');
    const source = this.store.getSourceById(p.sourceId);
    if (!source) throw new Error('source 不存在');

    const state: PollerState = JSON.parse(this.store.getPollerState(producerId) ?? '{"items":{}}');
    const result = await runPoller(manifest.poller, state, {
      secrets: this.opts.secrets?.(manifest.credentials),
    });

    // 先落快照，再交事件：即便 ingest 失败也不会重复产出（至少一次由 ingest 幂等兜底）
    this.store.setPollerState(producerId, 'default', JSON.stringify(result.state));
    for (const ev of result.events) this.opts.onEvent(source.name, ev);
    this.store.updateProducerHeartbeat(producerId, 'ok', null);
    if (result.errors.length > 0) {
      this.opts.logger?.warn({ producer: producerId, errors: result.errors.slice(0, 5) }, 'poller 有条目映射失败');
    }
    if (result.events.length > 0) {
      this.opts.logger?.info({ producer: producerId, events: result.events.length }, 'poller 产出事件');
    }
    return result.events.length;
  }

  private intervalOf(p: ProducerRow): number {
    try {
      const manifest = this.parseManifest(p);
      return parseInterval(manifest?.poller?.interval ?? '60s');
    } catch {
      return 60_000;
    }
  }

  private parseManifest(p: ProducerRow): StoredProducerConfig {
    return JSON.parse(p.configJson ?? '{}') as StoredProducerConfig;
  }
}
