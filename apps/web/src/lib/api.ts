/** 与中心通信的最小客户端：同源、带会话 cookie、错误统一成 ApiError。 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const put = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

// ------------------------------------------------------------- 形状

export interface Overview {
  deliveries: Record<string, number>;
  counts: {
    sources: number;
    channels: number;
    rules: number;
    producers: number;
    enabledProducers: number;
  };
  producers: { slug: string; kind: string; status: string | null; enabled: boolean; restarts: number }[];
  llmConfigured: boolean;
}

export interface Producer {
  id: string;
  slug: string;
  kind: 'managed' | 'poller';
  enabled: boolean;
  status: string | null;
  pid: number | null;
  restarts: number;
  lastError: string | null;
  lastHeartbeatAt: string | null;
}

export interface EventRow {
  event_id: string;
  source: string;
  type: string;
  text: string;
  severity: string;
  received_at: string;
}

export interface DeliveryRow {
  id: string;
  channel: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface Channel {
  id: string;
  name: string;
  kind: string;
  config: unknown;
  enabled: boolean;
}

export interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  when: unknown;
  actions: unknown;
}

export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  dedupTtlSec: number;
}

export interface DraftMeta {
  slug: string;
  requirement: string;
  createdAt: string;
  status: 'draft' | 'approved' | 'rejected';
  provider: string;
  files: string[];
}

export interface CheckReport {
  ok: boolean;
  issues: { level: 'error' | 'warn'; message: string }[];
}

export interface TrialResult {
  events: unknown[];
  heartbeatCount: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
}
