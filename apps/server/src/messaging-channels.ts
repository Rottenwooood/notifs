import type { MessageBatch, MessagingService, EndpointSpec } from '@notify-hub/contracts';
import { getChannelImpl } from '@notify-hub/channels';
import type { Store } from '@notify-hub/store';

/** Notification rendering is an edge adapter; the kernel always retains the original JSON. */
export function startMessageChannels(service: MessagingService, admin: string, store: Store, resolveSecret: (name: string) => string | undefined,
  onError: (error: unknown) => void): { stop(): Promise<void> } {
  const abort = new AbortController();
  const loops = new Map<string, Promise<void>>();
  let refreshing = false;
  async function consume(endpoint: EndpointSpec): Promise<void> {
    while (!abort.signal.aborted) {
      let renew: NodeJS.Timeout | undefined;
      try {
        const { batch } = await service.call<{ batch: MessageBatch | null }>('receive', admin, { endpoint: endpoint.name, wait_ms: 30_000 }, abort.signal);
        if (!batch) continue;
        const current = (await service.call<EndpointSpec[]>('endpoints.list', admin)).find(e => e.name === endpoint.name);
        const channel = current?.channel ? store.getChannelByName(current.channel) : undefined;
        if (!channel?.enabled) throw new Error(`消息渠道不可用: ${endpoint.name}`);
        const impl = getChannelImpl(channel.kind);
        if (!impl) throw new Error(`缺少消息渠道实现: ${channel.kind}`);
        renew = setInterval(() => {
          void service.call('renew', admin, { id: batch.id, lease: batch.lease }).catch(onError);
        }, 10_000);
        renew.unref();
        for (const message of batch.messages) {
          const result = await impl.send({
            title: message.type,
            body: typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2),
            severity: 'info', event_id: message.id,
          }, JSON.parse(channel.configJson), {
            channelId: channel.id, channelName: channel.name,
            deliveryId: `${message.id}:${endpoint.name}`, idempotencyKey: `${message.id}:${endpoint.name}`,
            attempt: batch.attempt, now: new Date(), resolveSecret,
          });
          if (!result.ok) throw new Error(result.error);
        }
        await service.call('ack', admin, { id: batch.id, lease: batch.lease });
      } catch (err) {
        if (abort.signal.aborted) break;
        onError(err);
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 1000); abort.signal.addEventListener('abort', done, { once: true });
        });
      } finally { clearInterval(renew); }
    }
  }
  async function refresh(): Promise<void> {
    if (refreshing || abort.signal.aborted) return;
    refreshing = true;
    try {
      const endpoints = await service.call<EndpointSpec[]>('endpoints.list', admin);
      for (const endpoint of endpoints) {
        if (!endpoint.channel || loops.has(endpoint.name)) continue;
        loops.set(endpoint.name, consume(endpoint).finally(() => loops.delete(endpoint.name)));
      }
    } catch (err) { if (!abort.signal.aborted) onError(err); }
    finally { refreshing = false; }
  }
  const timer = setInterval(() => void refresh(), 2000); timer.unref(); void refresh();
  return { async stop() { clearInterval(timer); abort.abort(); await Promise.allSettled(loops.values()); } };
}
