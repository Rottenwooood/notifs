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
  /** 单次补全的超时。生成"整个程序"属于长输出，默认给到 10 分钟。 */
  timeoutMs?: number;
}

/** 默认超时：生成一个完整程序实测 50–200s，给足余量避免误伤。 */
export const DEFAULT_LLM_TIMEOUT_MS = 600_000;

export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): LlmProvider {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  return {
    name: opts.name ?? `openai-compatible:${opts.model}`,
    async complete(messages, o = {}) {
      const timeoutMs = o.timeoutMs ?? defaultTimeout;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
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
      } catch (err) {
        // 把裸的 "aborted" 换成人能看懂的说明
        if (ac.signal.aborted) {
          const seconds = Math.round(timeoutMs / 1000);
          throw new Error(
            `模型在 ${seconds} 秒内没有返回（生成整个程序属于长输出，可能要 1–3 分钟）。` +
              `可以把需求描述得更具体以缩短输出，或用 NOTIFY_LLM_TIMEOUT_MS 调大超时（当前 ${seconds}s）。`,
          );
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
