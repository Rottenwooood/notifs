import type { DeliveryContext, MessageBatch, SendResult } from '@notify-hub/contracts';
import { getAdapter } from './index.ts';

/** Core dispatches complete batches. The adapter owns rendering, delivery and acknowledgement semantics. */
export async function deliverBatch(
  kind: string,
  batch: MessageBatch,
  config: Record<string, unknown>,
  context: Omit<DeliveryContext, 'batchId'>,
): Promise<SendResult> {
  const adapter = getAdapter(kind);
  if (!adapter) return {ok:false, retryable:false, error:`缺少适配器 ${kind}`};
  return adapter.deliver(batch, config, { ...context, batchId: batch.id });
}
