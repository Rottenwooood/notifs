import type { RenderedMessage, StoredEvent } from '@notify-hub/contracts';

/** 按点路径取值：getPath({data:{a:1}}, "data.a") -> 1 */
export function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** 极简模板：{{path}} 取值，缺失渲染为空串。 */
export function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = getPath(vars, path);
    return v == null ? '' : String(v);
  });
}

/** 内置默认模板：标题优先用 title，正文用 text。 */
export function defaultRender(event: StoredEvent): RenderedMessage {
  const title = event.title?.trim() || event.type;
  const url = event.url ?? undefined;
  const bodyWithUrl = url && !event.text.includes(url) ? `${event.text}\n${url}` : event.text;
  return {
    title,
    body: bodyWithUrl,
    markdown: event.text,
    url,
    severity: event.severity,
    event_id: event.event_id,
  };
}

export interface TemplateSpec {
  name: string;
  format: 'text' | 'markdown';
  titleTpl: string | null;
  bodyTpl: string;
}

/**
 * 用自定义模板渲染；未提供模板时退回默认模板。
 * 模板变量：{{type}} {{text}} {{title}} {{url}} {{severity}} {{source}} {{at}} {{data.xxx}}
 */
export function renderMessage(event: StoredEvent, tpl?: TemplateSpec): RenderedMessage {
  if (!tpl) return defaultRender(event);
  const vars = event as unknown as Record<string, unknown>;
  const title = tpl.titleTpl ? renderTemplate(tpl.titleTpl, vars) : event.title?.trim() || event.type;
  const body = renderTemplate(tpl.bodyTpl, vars);
  return {
    title,
    body,
    markdown: tpl.format === 'markdown' ? body : undefined,
    url: event.url ?? undefined,
    severity: event.severity,
    event_id: event.event_id,
  };
}
