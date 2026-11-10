import type { AdapterMessage, IncomingMessage, MessageBatch } from '@notify-hub/contracts';

const SEVERITY_ORDER = { info: 0, warn: 1, critical: 2 } as const;
type Severity = keyof typeof SEVERITY_ORDER;

function record(content: unknown): Record<string, unknown> | null {
  return content !== null && typeof content === 'object' && !Array.isArray(content)
    ? content as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Adapter-side rendering: the core never decides title, body or severity. */
export function renderMessage(message: IncomingMessage): AdapterMessage {
  const c = record(message.content);
  const title = text(c?.title)?.trim() || message.type;
  const body = text(c?.body) ?? text(c?.text) ?? (
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)
  );
  const rawSeverity = text(c?.severity);
  const severity: Severity = rawSeverity === 'warn' || rawSeverity === 'critical' ? rawSeverity : 'info';
  return {
    title,
    body,
    ...(text(c?.markdown) ? { markdown: text(c?.markdown) } : {}),
    ...(text(c?.url) ? { url: text(c?.url) } : {}),
    severity,
    message_id: message.id,
  };
}

/** One rate-limit window is one human-facing message, not one message per input. */
export function renderBatch(batch: MessageBatch): AdapterMessage {
  if (batch.messages.length === 1) return renderMessage(batch.messages[0]!);
  const rendered = batch.messages.map(renderMessage);
  const severity = rendered.reduce<Severity>(
    (highest, message) => SEVERITY_ORDER[message.severity] > SEVERITY_ORDER[highest] ? message.severity : highest,
    'info',
  );
  const body = batch.messages.map((message, index) => {
    const one = rendered[index]!;
    return `[${message.source}] ${one.title}\n${one.body}`;
  }).join('\n\n');
  return {
    title: `${batch.messages.length} 条消息`,
    body,
    severity,
    message_id: batch.id,
  };
}
