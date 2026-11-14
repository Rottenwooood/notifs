import type { DeliveryAdapter, OutboundAdapter } from '@notify-hub/contracts';
import { localAdapter } from './local.ts';
import { ntfyAdapter } from './ntfy.ts';
import { barkAdapter } from './bark.ts';
import { wecomAdapter } from './wecom.ts';
import { feishuAdapter } from './feishu.ts';
import { feishuAppAdapter } from './feishu-app.ts';
import { webhookAdapter } from './webhook.ts';
import { opencodeAdapter } from './opencode.ts';
import { renderBatch } from './render.ts';

export { localAdapter, type LocalConfig } from './local.ts';
export { ntfyAdapter, type NtfyConfig } from './ntfy.ts';
export { barkAdapter, type BarkConfig } from './bark.ts';
export { wecomAdapter, type WecomConfig } from './wecom.ts';
export { feishuAdapter, feishuSign, buildFeishuBody, type FeishuConfig } from './feishu.ts';
export { feishuAppAdapter, type FeishuAppConfig } from './feishu-app.ts';
export { webhookAdapter, validateWebhook, deliverWebhook } from './webhook.ts';
export { opencodeAdapter, validateOpenCode, deliverOpenCode, renderAgentMessages } from './opencode.ts';
export { renderMessage, renderBatch } from './render.ts';
export { parseFeishuEvent, feishuMessageFromEvent, type FeishuInboundEvent, type FeishuMessageEventData } from './feishu-inbound.ts';
export { startFeishuInbound, type FeishuInboundOptions } from './feishu-inbound-server.ts';

/** A single-message human adapter is wrapped into the same batch contract as every other target. */
function asBatchAdapter(adapter: OutboundAdapter): DeliveryAdapter {
  return {
    ...adapter,
    deliver: (batch, config, context) => adapter.send(renderBatch(batch), config, {
      endpoint: context.endpoint,
      deliveryId: context.batchId,
      attempt: context.attempt,
      idempotencyKey: context.batchId,
      now: context.now,
      signal: context.signal,
      resolveSecret: context.resolveSecret,
    }),
  };
}

const REGISTRY = new Map<string, DeliveryAdapter>([
  [localAdapter.kind, asBatchAdapter(localAdapter)],
  [ntfyAdapter.kind, asBatchAdapter(ntfyAdapter)],
  [barkAdapter.kind, asBatchAdapter(barkAdapter)],
  [wecomAdapter.kind, asBatchAdapter(wecomAdapter)],
  [feishuAdapter.kind, asBatchAdapter(feishuAdapter)],
  [feishuAppAdapter.kind, asBatchAdapter(feishuAppAdapter)],
  [webhookAdapter.kind, webhookAdapter],
  [opencodeAdapter.kind, opencodeAdapter],
]);

export function getAdapter(kind: string): DeliveryAdapter | undefined {
  return REGISTRY.get(kind);
}

/** 供测试注入临时通道实现；生产路径只读 REGISTRY。 */
export function registerAdapter(adapter: DeliveryAdapter): void {
  REGISTRY.set(adapter.kind, adapter);
}

export function validateDelivery(kind: string, config: unknown): {ok: true} | {ok: false; error: string} {
  const adapter = getAdapter(kind);
  return adapter?.validateConfig(config) ?? {ok: false, error: `未知适配器 ${kind}`};
}

export { deliverBatch } from './delivery.ts';
