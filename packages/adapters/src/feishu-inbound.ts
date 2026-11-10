import type { Json, MessageInput } from '@notify-hub/contracts';

export type FeishuInboundEvent =
  | { kind: 'challenge'; challenge: string }
  | { kind: 'message'; idempotencyKey: string; message: MessageInput }
  | { kind: 'ignore' };

interface FeishuEnvelope {
  type?: string;
  challenge?: string;
  token?: string;
  schema?: string;
  header?: {
    event_id?: string;
    event_type?: string;
    token?: string;
  };
  event?: {
    sender?: {
      sender_type?: string;
      sender_id?: { open_id?: string; user_id?: string; union_id?: string };
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
    };
  };
}

function textContent(messageType: string | undefined, raw: string | undefined): { text: string; content: unknown } {
  if (raw === undefined || raw === '') return { text: '', content: '' };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (messageType === 'text' && parsed && typeof parsed === 'object' && typeof (parsed as { text?: unknown }).text === 'string') {
      return { text: (parsed as { text: string }).text, content: parsed };
    }
    if (typeof parsed === 'string') return { text: parsed, content: parsed };
    return { text: JSON.stringify(parsed), content: parsed };
  } catch {
    return { text: raw, content: raw };
  }
}

/**
 * Map a Feishu event subscription payload to one notifs message.
 * The bridge owns platform verification and identity; the core sees only type+content.
 */
export function parseFeishuEvent(raw: unknown, verificationToken: string): FeishuInboundEvent {
  const body = raw as FeishuEnvelope;
  if (!body || typeof body !== 'object') throw new Error('请求体必须是 JSON 对象');
  if (body.type === 'url_verification' || (body.challenge !== undefined && body.header === undefined)) {
    if (!verificationToken || body.token !== verificationToken) throw new Error('飞书 verification token 不匹配');
    if (typeof body.challenge !== 'string') throw new Error('缺少 challenge');
    return { kind: 'challenge', challenge: body.challenge };
  }
  const header = body.header;
  if (!header || body.schema !== '2.0') throw new Error('只接受飞书 v2 事件');
  if (!verificationToken || header.token !== verificationToken) throw new Error('飞书 verification token 不匹配');
  if (header.event_type !== 'im.message.receive_v1') return { kind: 'ignore' };
  if (body.event?.sender?.sender_type === 'app') return { kind: 'ignore' };
  const message = body.event?.message;
  if (!message || typeof message.message_id !== 'string') return { kind: 'ignore' };
  const { text, content } = textContent(message.message_type, message.content);
  const idempotencyKey = `feishu:${header.event_id ?? message.message_id}`;
  return {
    kind: 'message',
    idempotencyKey,
    message: {
      type: 'human.message',
      content: {
        channel: 'feishu',
        text,
        message_type: message.message_type ?? 'text',
        message_id: message.message_id,
        chat_id: message.chat_id ?? null,
        chat_type: message.chat_type ?? null,
        sender: {
          open_id: body.event?.sender?.sender_id?.open_id ?? null,
          user_id: body.event?.sender?.sender_id?.user_id ?? null,
          union_id: body.event?.sender?.sender_id?.union_id ?? null,
        },
        raw: content as Json,
      },
    },
  };
}
