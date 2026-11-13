import type { MessageBatch, MessagingService, EndpointSpec } from '@notify-hub/contracts';
import { deliverBatch } from '@notify-hub/adapters';

/** Each configured push destination is a consumer of the same durable queue. */
export function startAdapters(service: MessagingService, token: string, onError: (error: unknown) => void): { stop(): Promise<void> } {
  const abort = new AbortController();
  const loops = new Map<string, Promise<void>>();
  let refreshing = false;
  async function consume(endpoint: EndpointSpec): Promise<void> {
    let backoff = 0;
    while (!abort.signal.aborted) {
      let renew: NodeJS.Timeout | undefined;
      let batch: MessageBatch | null = null;
      try {
        const claimed = await service.call<{ batch: MessageBatch | null }>('delivery.claim', token, { endpoint: endpoint.name, wait_ms: 30_000 }, abort.signal);
        batch = claimed.batch;
        if (!batch) { backoff = 0; continue; }
        const current = (await service.call<EndpointSpec[]>('endpoints.list', token)).find(e => e.name === endpoint.name);
        if (!current) return;
        const currentBatch = batch;
        renew = setInterval(() => { void service.call('delivery.renew', token, {id: currentBatch.id, lease: currentBatch.lease}).catch(onError); }, 10_000);
        renew.unref();
        const result = await deliverBatch(current.delivery.kind, batch, current.delivery.config, {
          endpoint:endpoint.name, attempt:batch.attempt, now:new Date(), signal:abort.signal,
          resolveSecret:name=>process.env[name],
        });
        if (!result.ok && !result.retryable) {
          // 配置或凭据错误重试不会成功；直接保留为 held，避免用满重试次数。
          await service.call('delivery.fail', token, { id: batch.id, lease: batch.lease });
          onError(new Error(`${endpoint.name} 不可重试的投递错误：${result.error}；批次已保留为 held`));
          backoff = 0;
          continue;
        }
        if (!result.ok) throw new Error(`${endpoint.name} 投递失败：${result.error}`);
        await service.call('delivery.ack', token, { id: batch.id, lease: batch.lease });
        backoff = 0;
      } catch (err) {
        if (abort.signal.aborted) break;
        onError(err);
        if (batch) {
          // 可重试失败或提交失败：释放租约，否则要等满 30 秒租约才能在下一轮领取。
          await service.call('delivery.release', token, { id: batch.id, lease: batch.lease }).catch(() => {});
          batch = null;
        }
        backoff = Math.min(backoff ? backoff * 2 : 1_000, 60_000);
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, backoff);
          abort.signal.addEventListener('abort', done, {once: true});
        });
      } finally { clearInterval(renew); }
    }
  }
  async function refresh(): Promise<void> {
    if (refreshing || abort.signal.aborted) return;
    refreshing = true;
    try {
      const endpoints = await service.call<EndpointSpec[]>('endpoints.list', token);
      for (const endpoint of endpoints) {
        if (loops.has(endpoint.name)) continue;
        loops.set(endpoint.name, consume(endpoint).finally(() => loops.delete(endpoint.name)));
      }
    } catch (err) { if (!abort.signal.aborted) onError(err); }
    finally { refreshing = false; }
  }
  const timer = setInterval(() => void refresh(), 1000); timer.unref(); void refresh();
  return { async stop() { clearInterval(timer); abort.abort(); await Promise.allSettled(loops.values()); } };
}
