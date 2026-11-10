import Fastify from 'fastify';
import type { MessagingService } from '@notify-hub/contracts';
import { messagingRoutes } from './http.ts';
export function buildServer(options: { messaging: MessagingService; logLevel?: string }) {
  const app = Fastify({ logger: options.logLevel ? {level: options.logLevel} : false, bodyLimit: 1_048_576 });
  messagingRoutes(app, options.messaging);
  app.get('/health', async (_, reply) => {
    try { await options.messaging.call('authenticate', '', {}); }
    catch (err) {
      if ((err as {status?: number}).status === 401) return {ok: true};
      return reply.code(503).send({ok: false});
    }
    return {ok: true};
  });
  return app;
}
