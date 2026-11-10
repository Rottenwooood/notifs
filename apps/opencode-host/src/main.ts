import { pathToFileURL } from 'node:url';
import { MessageClient } from '@notify-hub/core';
import type { MessageInput, PublishResult } from '@notify-hub/contracts';

/**
 * OpenCode 宿主侧的回复出口。
 *
 * 中心只负责把消息推入 OpenCode 会话；模型回答后，需要宿主把最终文本作为
 * agent 身份发布回中心。这个桥不参与入站，也不修改会话内容，只观察已经完成的
 * assistant 消息，因此不会把 synthetic 输入当成用户回复。
 */
export interface OpenCodePart {
  type?: string;
  text?: string;
}

export interface OpenCodeMessage {
  id?: string;
  type?: string;
  agent?: string;
  model?: { providerID?: string; id?: string };
  time?: { created?: number; completed?: number };
  content?: OpenCodePart[];
}

export interface OpenCodeHostOptions {
  opencodeUrl: string;
  session: string;
  /** 绑定到该会话的 OpenCode agent profile；设置后不匹配就拒绝启动。 */
  expectedAgent?: string;
  authHeader?: string;
  pollMs?: number;
  fetcher?: typeof fetch;
  publish?: (message: MessageInput, id: string) => Promise<PublishResult>;
  log?: (line: string) => void;
}

export function extractReplyText(message: OpenCodeMessage): string {
  const parts = Array.isArray(message.content) ? message.content : [];
  return parts
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text!)
    .join('\n')
    .trim();
}

export function replyIdFor(session: string, messageId: string): string {
  return `opencode:${session}:${messageId}`.slice(0, 200);
}

function isCompletedAssistant(message: OpenCodeMessage): boolean {
  return message.type === 'assistant' && message.time?.completed !== undefined && Boolean(message.id);
}

export class OpenCodeReplyHost {
  private readonly seen = new Set<string>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private readonly fetcher: typeof fetch;
  private readonly pollMs: number;

  constructor(private readonly options: OpenCodeHostOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.pollMs = options.pollMs ?? 750;
  }

  private headers(): Record<string, string> {
    return this.options.authHeader ? { authorization: this.options.authHeader } : {};
  }

  private async messages(): Promise<OpenCodeMessage[]> {
    const url = `${this.options.opencodeUrl.replace(/\/+$/, '')}/api/session/${encodeURIComponent(this.options.session)}/message`;
    const response = await this.fetcher(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`OpenCode HTTP ${response.status}`);
    const body = await response.json() as { data?: OpenCodeMessage[] } | OpenCodeMessage[];
    return Array.isArray(body) ? body : body.data ?? [];
  }

  private async verifyAgent(): Promise<void> {
    if (!this.options.expectedAgent) return;
    const url = `${this.options.opencodeUrl.replace(/\/+$/, '')}/api/session/${encodeURIComponent(this.options.session)}`;
    const response = await this.fetcher(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`OpenCode HTTP ${response.status}`);
    const body = await response.json() as { data?: { agent?: string }; agent?: string };
    const agent = (body.data ?? body).agent;
    if (agent !== this.options.expectedAgent) {
      throw new Error(`OpenCode 会话 agent=${agent ?? 'unknown'}，要求 ${this.options.expectedAgent}`);
    }
    this.options.log?.(`opencode session agent=${agent}`);
  }

  /** 第一次只建立基线，避免启动时把历史回复重复发出去。 */
  private markBaseline(messages: OpenCodeMessage[]): void {
    for (const message of messages) {
      if (isCompletedAssistant(message)) this.seen.add(message.id!);
    }
  }

  private async publishReplies(messages: OpenCodeMessage[]): Promise<void> {
    for (const message of messages) {
      if (!isCompletedAssistant(message)) continue;
      const id = message.id!;
      if (this.seen.has(id)) continue;
      const text = extractReplyText(message);
      if (!text) continue;
      const publish = this.options.publish;
      if (!publish) throw new Error('缺少 publish 回调');
      try {
        const result = await publish({
          type: 'reply',
          content: {
            text,
            opencode: {
              session_id: this.options.session,
              message_id: id,
              agent: message.agent ?? null,
              model: message.model ? `${message.model.providerID ?? ''}/${message.model.id ?? ''}` : null,
            },
          },
        }, replyIdFor(this.options.session, id));
        this.seen.add(id);
        this.options.log?.(`opencode reply -> notifs ${result.id} recipients=${result.recipients.join(',')}`);
      } catch (error) {
        // 不标记 seen，下一轮重试；发布 ID 不变，中心自行去重。
        this.options.log?.(`opencode reply publish failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async start(): Promise<void> {
    await this.verifyAgent();
    this.markBaseline(await this.messages());
    this.timer = setInterval(() => { void this.poll(); }, this.pollMs);
    this.options.log?.(`opencode host watching ${this.options.session}`);
  }

  async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.publishReplies(await this.messages());
    } catch (error) {
      this.options.log?.(`opencode host poll failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

async function main(): Promise<void> {
  const password = process.env.OPENCODE_PASSWORD;
  const authHeader = process.env.OPENCODE_AUTH_HEADER
    ?? (password ? `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` : undefined);
  const client = new MessageClient({
    baseUrl: process.env.NOTIFS_BASE_URL ?? 'http://127.0.0.1:7710',
    token: required('NOTIFS_TOKEN'),
  });
  const host = new OpenCodeReplyHost({
    opencodeUrl: process.env.OPENCODE_URL ?? 'http://127.0.0.1:49374',
    session: required('OPENCODE_SESSION'),
    expectedAgent: process.env.OPENCODE_AGENT,
    authHeader,
    pollMs: Number(process.env.OPENCODE_POLL_MS ?? 750),
    publish: (message, id) => client.send(message, { id }),
    log: line => console.log(line),
  });
  await host.start();
  const stop = () => { host.stop(); client.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
