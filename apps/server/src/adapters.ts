import type { MessageBatch, MessagingService, EndpointSpec } from '@notify-hub/contracts';
import { deliverBatch } from '@notify-hub/adapters';

/** Each configured push destination is a consumer of the same durable queue. */
export function startAdapters(service: MessagingService, token: string, onError: (error: unknown) => void): { stop(): Promise<void> } {
  const abort = new AbortController();
  const loops = new Map<string, Promise<void>>();
  let refreshing = false;
  async function consume(endpoint: EndpointSpec): Promise<void> {
    while (!abort.signal.aborted) {
      let renew: NodeJS.Timeout | undefined;
      try {
        const { batch } = await service.call<{ batch: MessageBatch | null }>('delivery.claim', token, { endpoint: endpoint.name, wait_ms: 30_000 }, abort.signal);
        if (!batch) continue;
        const current = (await service.call<EndpointSpec[]>('endpoints.list', token)).find(e => e.name === endpoint.name);
        if (!current) return;
        renew = setInterval(() => { void service.call('delivery.renew', token, {id: batch.id, lease: batch.lease}).catch(onError); }, 10_000);
        renew.unref();
        const result = await deliverBatch(current.delivery.kind, batch, current.delivery.config, {
          endpoint:endpoint.name, attempt:batch.attempt, now:new Date(), signal:abort.signal,
          resolveSecret:name=>process.env[name],
        });
        if (!result.ok) throw new Error(result.error);
        await service.call('delivery.ack', token, { id: batch.id, lease: batch.lease });
      } catch (err) {
        if (abort.signal.aborted) break;
        onError(err);
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 1000); abort.signal.addEventListener('abort', done, {once: true});
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
