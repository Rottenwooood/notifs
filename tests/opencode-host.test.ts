import { describe, expect, it, vi } from 'vitest';
import {
  OpenCodeReplyHost,
  extractReplyText,
  replyIdFor,
  type OpenCodeMessage,
} from '../apps/opencode-host/src/main.ts';

function completed(id: string, text: string): OpenCodeMessage {
  return {
    id,
    type: 'assistant',
    agent: 'guarded',
    model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' },
    time: { created: 1, completed: 2 },
    content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text }],
  };
}

function response(messages: OpenCodeMessage[]): Response {
  return { ok: true, json: async () => ({ data: messages }) } as Response;
}

describe('OpenCode reply host', () => {
  it('extracts only text parts and builds a bounded publication id', () => {
    expect(extractReplyText(completed('msg_1', '回答'))).toBe('回答');
    expect(extractReplyText({ content: [{ type: 'reasoning', text: 'x' }] })).toBe('');
    expect(replyIdFor('ses_a', 'msg_1')).toBe('opencode:ses_a:msg_1');
  });

  it('baselines old replies, publishes new completed replies once, and skips streaming messages', async () => {
    let messages: OpenCodeMessage[] = [completed('msg_old', '旧回答')];
    const fetcher = vi.fn(async () => response(messages));
    const publish = vi.fn(async () => ({ id: 'evt_1', deduplicated: false, recipients: ['feishu-human'] }));
    const host = new OpenCodeReplyHost({
      opencodeUrl: 'http://opencode', session: 'ses_a', fetcher, publish, pollMs: 60_000,
    });

    await host.start();
    expect(publish).not.toHaveBeenCalled();

    messages = [...messages, { ...completed('msg_new', '新回答'), time: { created: 3 } }];
    await host.poll();
    expect(publish).not.toHaveBeenCalled();

    messages = [...messages.slice(0, -1), completed('msg_new', '新回答')];
    await host.poll();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reply',
        content: expect.objectContaining({
          text: '新回答',
          opencode: expect.objectContaining({ session_id: 'ses_a', message_id: 'msg_new' }),
        }),
      }),
      'opencode:ses_a:msg_new',
    );

    await host.poll();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('retries a failed publication without marking the message as sent', async () => {
    const messages = [completed('msg_old', '旧回答')];
    const fetcher = vi.fn(async () => response(messages));
    const publish = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'evt_1', deduplicated: false, recipients: [] });
    const host = new OpenCodeReplyHost({
      opencodeUrl: 'http://opencode', session: 'ses_a', fetcher, publish, pollMs: 60_000,
    });
    await host.start();

    messages.push(completed('msg_new', '回答'));
    await host.poll();
    expect(publish).toHaveBeenCalledTimes(1);

    await host.poll();
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
