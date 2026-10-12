import type { Channel } from '@notify-hub/contracts';
import { localChannel } from './local.ts';
import { webhookChannel } from './webhook.ts';

export { localChannel, type LocalConfig } from './local.ts';
export { webhookChannel, renderTemplate, type WebhookConfig } from './webhook.ts';

const REGISTRY = new Map<string, Channel>([
  [localChannel.kind, localChannel],
  [webhookChannel.kind, webhookChannel],
]);

export function getChannelImpl(kind: string): Channel | undefined {
  return REGISTRY.get(kind);
}

export function channelKinds(): string[] {
  return [...REGISTRY.keys()];
}

/** 供测试 / 插件注册新通道实现。 */
export function registerChannel(ch: Channel): void {
  REGISTRY.set(ch.kind, ch);
}
