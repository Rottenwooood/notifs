import type { MessageBatch, SendContext, SendResult } from '@notify-hub/contracts';
import { getAdapter } from './index.ts';
import { deliverWebhook } from './webhook.ts';
import { deliverOpenCode } from './opencode.ts';

/** The adapter boundary owns payload conversion; routing and scheduling retain raw messages. */
export async function deliverBatch(kind:string, batch:MessageBatch, config:Record<string,unknown>, context:Omit<SendContext,'deliveryId'|'idempotencyKey'>):Promise<SendResult> {
  if (kind === 'webhook') return deliverWebhook(batch,config,context.signal);
  if (kind === 'opencode') return deliverOpenCode(batch,config,context.signal);
  const adapter = getAdapter(kind);
  if (!adapter) return {ok:false,retryable:false,error:`缺少适配器 ${kind}`};
  for (const message of batch.messages) {
    const result = await adapter.send({
      title:message.type, body:typeof message.content === 'string' ? message.content : JSON.stringify(message.content,null,2),
      severity:'info',message_id:message.id,
    },config,{...context,deliveryId:`${message.id}:${batch.endpoint}`,idempotencyKey:`${message.id}:${batch.endpoint}`});
    if (!result.ok) return result;
  }
  return {ok:true};
}
