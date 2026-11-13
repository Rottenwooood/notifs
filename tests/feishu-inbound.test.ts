import { afterEach, describe, expect, it } from 'vitest';
import { parseFeishuEvent, startFeishuInbound } from '@notify-hub/adapters';

const TOKEN = 'verify';
const event = {
  schema: '2.0',
  header: { event_id: 'evt-1', event_type: 'im.message.receive_v1', token: TOKEN },
  event: {
    sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
    message: { message_id: 'om_1', chat_id: 'oc_1', chat_type: 'p2p', message_type: 'text', content: '{"text":"你好"}' },
  },
};

describe('Feishu inbound adapter', () => {
  it('answers url verification and maps a text message', () => {
    expect(parseFeishuEvent({ type: 'url_verification', token: TOKEN, challenge: 'c1' }, TOKEN)).toEqual({ kind: 'challenge', challenge: 'c1' });
    const parsed = parseFeishuEvent(event, TOKEN);
    expect(parsed.kind).toBe('message');
    if (parsed.kind !== 'message') return;
    expect(parsed.idempotencyKey).toBe('feishu:evt-1');
    expect(parsed.message.type).toBe('human.message');
    expect((parsed.message.content as any).text).toBe('你好');
    expect((parsed.message.content as any).sender.open_id).toBe('ou_1');
  });

  it('keeps private chats and filters only group chatter', () => {
    // 私聊默认就是对着机器人说话，不引用、不 @ 也必须转发。
    expect(parseFeishuEvent(event, TOKEN, { onlyRelevant: true }).kind).toBe('message');
    const group = { ...event, event: { ...event.event, message: { ...event.event.message, chat_id: 'oc_g', chat_type: 'group' } } };
    expect(parseFeishuEvent(group, TOKEN, { onlyRelevant: true })).toEqual({ kind: 'ignore' });
    const mentioned = { ...group, event: { ...group.event, message: { ...group.event.message, mentions: [{ key: '@_user_1', name: 'notifs' }] } } };
    expect(parseFeishuEvent(mentioned, TOKEN, { onlyRelevant: true }).kind).toBe('message');
    const replied = { ...group, event: { ...group.event, message: { ...group.event.message, parent_id: 'om_0' } } };
    expect(parseFeishuEvent(replied, TOKEN, { onlyRelevant: true }).kind).toBe('message');
    expect(parseFeishuEvent(group, TOKEN, { onlyRelevant: false }).kind).toBe('message');
  });

  it('ignores bot messages and rejects a wrong token', () => {
    expect(parseFeishuEvent({ ...event, event: { ...event.event, sender: { sender_type: 'app' } } }, TOKEN)).toEqual({ kind: 'ignore' });
    expect(() => parseFeishuEvent(event, 'wrong')).toThrow('verification token');
  });

  it('receives a real HTTP event and publishes with an idempotency key', async () => {
    const sent: unknown[] = [];
    const server = await startFeishuInbound({
      client: { async send(message, options) { sent.push({ message, options }); return { id: 'msg-1', deduplicated: false, recipients: ['last-order'] }; } },
      verificationToken: TOKEN,
      port: 0,
      log: () => {},
    });
    try {
      const challenge = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'url_verification', token: TOKEN, challenge: 'c2' }) });
      expect(await challenge.json()).toEqual({ challenge: 'c2' });
      const response = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
      expect(response.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect((sent[0] as any).options.id).toBe('feishu:evt-1');
      expect((sent[0] as any).message.type).toBe('human.message');
    } finally {
      await server.close();
    }
  });
});
