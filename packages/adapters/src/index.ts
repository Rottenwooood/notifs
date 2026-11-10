import type { OutboundAdapter } from '@notify-hub/contracts';
import { localAdapter } from './local.ts';
import { ntfyAdapter } from './ntfy.ts';
import { barkAdapter } from './bark.ts';
import { wecomAdapter } from './wecom.ts';
import { feishuAdapter } from './feishu.ts';
import { feishuAppAdapter } from './feishu-app.ts';

export { localAdapter, type LocalConfig } from './local.ts';
export { ntfyAdapter, type NtfyConfig } from './ntfy.ts';
export { barkAdapter, type BarkConfig } from './bark.ts';
export { wecomAdapter, type WecomConfig } from './wecom.ts';
export { feishuAdapter, feishuSign, buildFeishuBody, type FeishuConfig } from './feishu.ts';
export { feishuAppAdapter, type FeishuAppConfig } from './feishu-app.ts';

const REGISTRY = new Map<string, OutboundAdapter>([
  [localAdapter.kind, localAdapter],
  [ntfyAdapter.kind, ntfyAdapter],
  [barkAdapter.kind, barkAdapter],
  [wecomAdapter.kind, wecomAdapter],
  [feishuAdapter.kind, feishuAdapter],
  [feishuAppAdapter.kind, feishuAppAdapter],
]);

export function getAdapter(kind: string): OutboundAdapter | undefined {
  return REGISTRY.get(kind);
}

export function adapterKinds(): string[] {
  return [...REGISTRY.keys()];
}

/** 供测试 / 插件注册新通道实现。 */
export function registerAdapter(ch: OutboundAdapter): void {
  REGISTRY.set(ch.kind, ch);
}
import { validateWebhook } from './webhook.ts';
export { validateWebhook, deliverWebhook } from './webhook.ts';

export function validateDelivery(kind: string, config: unknown): {ok: true} | {ok: false; error: string} {
  if (kind === 'pull') return {ok: true};
  if (kind === 'webhook') return validateWebhook(config);
  const adapter = getAdapter(kind);
  return adapter?.validateConfig(config) ?? {ok: false, error: `未知适配器 ${kind}`};
}
