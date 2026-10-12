import type { Channel } from '@notify-hub/contracts';
import { localChannel } from './local.ts';
import { webhookChannel } from './webhook.ts';
import { ntfyChannel } from './ntfy.ts';
import { barkChannel } from './bark.ts';
import { wecomChannel } from './wecom.ts';
import { feishuChannel } from './feishu.ts';
import { feishuAppChannel } from './feishu-app.ts';

export { localChannel, type LocalConfig } from './local.ts';
export { webhookChannel, renderTemplate, type WebhookConfig } from './webhook.ts';
export { ntfyChannel, type NtfyConfig } from './ntfy.ts';
export { barkChannel, type BarkConfig } from './bark.ts';
export { wecomChannel, type WecomConfig } from './wecom.ts';
export { feishuChannel, feishuSign, buildFeishuBody, type FeishuConfig } from './feishu.ts';
export { feishuAppChannel, type FeishuAppConfig } from './feishu-app.ts';

const REGISTRY = new Map<string, Channel>([
  [localChannel.kind, localChannel],
  [webhookChannel.kind, webhookChannel],
  [ntfyChannel.kind, ntfyChannel],
  [barkChannel.kind, barkChannel],
  [wecomChannel.kind, wecomChannel],
  [feishuChannel.kind, feishuChannel],
  [feishuAppChannel.kind, feishuAppChannel],
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
