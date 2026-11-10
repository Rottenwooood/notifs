import { createHash } from 'node:crypto';
import type { MessageBatch, SendResult } from '@notify-hub/contracts';
import { validateWebhook } from './webhook.ts';

/** OpenCode 2.x API: session creation, model and agent selection belong to the host. */
export function validateOpenCode(config: unknown): {ok:true} | {ok:false;error:string} {
  const c = config as Record<string, unknown> | null;
  const validation = validateWebhook(config);
  if (!validation.ok) return validation;
  if (typeof c?.session !== 'string' || !/^ses[\w-]+$/.test(c.session) ||
      (c.resume !== undefined && typeof c.resume !== 'boolean') ||
      (c.headers_env !== undefined && typeof c.headers_env !== 'string')) {
    return {ok:false,error:'opencode 要求 session；resume 可选布尔值，headers_env 可选环境变量名'};
  }
  return {ok:true};
}

export async function deliverOpenCode(batch: MessageBatch, config: Record<string, unknown>, signal?: AbortSignal): Promise<SendResult> {
  try {
    const headers: unknown = config.headers_env ? JSON.parse(process.env[String(config.headers_env)] ?? 'null') : config.headers ?? {};
    if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.values(headers).some(v => typeof v !== 'string')) {
      return {ok:false,retryable:false,error:'opencode 凭据环境变量必须是字符串 headers JSON'};
    }
    // Retrying an ambiguous response must use the same host message identity.
    const id = `msg_${createHash('sha256').update(batch.id).digest('hex').slice(0, 26)}`;
    const response = await fetch(`${String(config.url).replace(/\/$/, '')}/api/session/${encodeURIComponent(String(config.session))}/prompt`, {
      method:'POST', headers:{...headers as Record<string,string>,'content-type':'application/json'},
      body:JSON.stringify({id, text:JSON.stringify({endpoint:batch.endpoint,messages:batch.messages}), resume:config.resume ?? true}),
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    return response.ok ? {ok:true} : {ok:false,retryable:response.status >= 500 || response.status === 429,error:`OpenCode HTTP ${response.status}`};
  } catch (err) { return {ok:false,retryable:true,error:String(err)}; }
}
