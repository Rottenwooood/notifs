import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { MessageInput, PublishResult } from '@notify-hub/contracts';
import { parseFeishuEvent } from './feishu-inbound.ts';

interface Publisher {
  send(message: MessageInput, options?: { id?: string }): Promise<PublishResult>;
}

export interface FeishuInboundOptions {
  client: Publisher;
  verificationToken: string;
  host?: string;
  port?: number;
  path?: string;
  onlyRelevant?: boolean;
  log?: (line: string) => void;
}

function readBody(req: IncomingMessage, limit = 1_048_576): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0, body = '';
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** Standalone Feishu event bridge: platform event -> identity-token publish -> subscription routing. */
export async function startFeishuInbound(options: FeishuInboundOptions): Promise<{ close(): Promise<void>; url: string }> {
  const path = options.path ?? '/feishu/events';
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 7720;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || new URL(req.url ?? '/', 'http://localhost').pathname !== path) {
      send(404, { error: 'not found' });
      return;
    }
    try {
      const raw = await readBody(req);
      const event = parseFeishuEvent(JSON.parse(raw || '{}'), options.verificationToken, { onlyRelevant: options.onlyRelevant ?? false });
      if (event.kind === 'challenge') { send(200, { challenge: event.challenge }); return; }
      if (event.kind === 'ignore') { send(200, { ok: true, ignored: true }); return; }
      const result = await options.client.send(event.message, { id: event.idempotencyKey });
      options.log?.(`feishu inbound -> notifs ${result.id} recipients=${result.recipients.join(',')}`);
      send(200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.log?.(`feishu inbound failed: ${message}`);
      send(message.includes('verification token') ? 403 : 400, { error: message });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host}:${actualPort}${path}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
