/** LLM 提供方抽象（§5.4.2「模型可配」）。默认 OpenAI 兼容的 chat/completions。 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: LlmMessage[], opts?: { temperature?: number; timeoutMs?: number }): Promise<string>;
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  name?: string;
}

export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): LlmProvider {
  const base = opts.baseUrl.replace(/\/+$/, '');
  return {
    name: opts.name ?? `openai-compatible:${opts.model}`,
    async complete(messages, o = {}) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 120_000);
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: opts.model,
            messages,
            temperature: o.temperature ?? 0.2,
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`LLM 请求失败: HTTP ${res.status} ${text.slice(0, 300)}`);
        }
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.length === 0) {
          throw new Error('LLM 返回内容为空');
        }
        return content;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
