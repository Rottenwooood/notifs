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

function extractMessageText(messageType: string | undefined, raw: string | undefined): { text: string; content: unknown } {
  if (raw === undefined || raw === '') return { text: '', content: '' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return { text: raw, content: raw }; }
  if (messageType === 'text' && parsed && typeof parsed === 'object' && typeof (parsed as { text?: unknown }).text === 'string') {
    return { text: (parsed as { text: string }).text, content: parsed };
  }
  if (messageType === 'post' && parsed && typeof parsed === 'object') {
    const record = parsed as { title?: unknown; content?: unknown; zh_cn?: { content?: unknown } };
    const blocks = Array.isArray(record.content) ? record.content : Array.isArray(record.zh_cn?.content) ? record.zh_cn.content : [];
    const lines: string[] = [];
    if (typeof record.title === 'string' && record.title) lines.push(record.title);
    for (const line of blocks) {
      if (!Array.isArray(line)) continue;
      lines.push(line.map((node: unknown) => {
        if (!node || typeof node !== 'object') return '';
        const n = node as { text?: unknown; href?: unknown; tag?: unknown };
        return typeof n.text === 'string' ? n.text : n.tag === 'a' && typeof n.href === 'string' ? n.href : '';
      }).join(''));
    }
    return { text: lines.filter(Boolean).join('\n'), content: parsed };
  }
  if (messageType === 'image') return { text: '[图片]', content: parsed };
  if (messageType === 'file') return { text: '[文件]', content: parsed };
  if (messageType === 'audio') return { text: '[语音]', content: parsed };
  if (messageType === 'media') return { text: '[视频]', content: parsed };
  if (messageType === 'sticker') return { text: '[表情]', content: parsed };
  return { text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed), content: parsed };
}


export interface FeishuMessageEventData {
  event_id?: string;
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
    parent_id?: string;
    root_id?: string;
    mentions?: Array<{ key?: string; name?: string }>;
  };
}

/** Long-connection callback data and HTTP event payload share this shape. */
export function feishuMessageFromEvent(data: FeishuMessageEventData, onlyRelevant = false): { idempotencyKey: string; message: MessageInput } | null {
  if (data.sender?.sender_type === 'app') return null;
  const message = data.message;
  if (!message || typeof message.message_id !== 'string') return null;
  if (onlyRelevant && !message.parent_id && !message.root_id && !(Array.isArray(message.mentions) && message.mentions.length > 0)) return null;
  const extracted = extractMessageText(message.message_type, message.content);
  let text = extracted.text;
  for (const mention of message.mentions ?? []) {
    if (mention.key) text = text.split(mention.key).join('');
  }
  text = text.replace(/\s+/g, ' ').trim();
  const content = extracted.content;
  return {
    idempotencyKey: `feishu:${data.event_id ?? message.message_id}`,
    message: {
      type: 'human.message',
      content: {
        channel: 'feishu',
        text,
        message_type: message.message_type ?? 'text',
        message_id: message.message_id,
        chat_id: message.chat_id ?? null,
        chat_type: message.chat_type ?? null,
        reply_to: message.parent_id ?? message.root_id ?? null,
        mentions: (message.mentions ?? []).map(mention => mention.name).filter((name): name is string => typeof name === 'string'),
        event_id: data.event_id ?? null,
        sender_type: data.sender?.sender_type ?? null,
        sender: {
          open_id: data.sender?.sender_id?.open_id ?? null,
          user_id: data.sender?.sender_id?.user_id ?? null,
          union_id: data.sender?.sender_id?.union_id ?? null,
        },
        raw: content as Json,
      },
    },
  };
}

/**
 * Map a Feishu event subscription payload to one notifs message.
 * The bridge owns platform verification and identity; the core sees only type+content.
 */
export function parseFeishuEvent(raw: unknown, verificationToken: string, options: { onlyRelevant?: boolean } = {}): FeishuInboundEvent {
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
  const converted = feishuMessageFromEvent({ event_id: header.event_id, ...body.event }, options.onlyRelevant ?? false);
  if (!converted) return { kind: 'ignore' };
  return { kind: 'message', ...converted };
}
