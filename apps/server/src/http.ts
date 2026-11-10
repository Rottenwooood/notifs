import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MessagingError, type MessagingService } from '@notify-hub/contracts';

export function messagingRoutes(app: FastifyInstance, service: MessagingService): void {
  const controllers = new Set<AbortController>();
  app.addHook('preClose', async () => { for (const controller of controllers) controller.abort(); });
  function handler(operation: string, input: (req: FastifyRequest) => unknown = req => req.body ?? {}) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const token = req.headers.authorization?.replace(/^Bearer\s+/, '') ?? '';
      const controller = new AbortController();
      const cancel = () => { if (!reply.raw.writableEnded) controller.abort(); };
      reply.raw.on('close', cancel); controllers.add(controller);
      try {
        const result = await service.call(operation, token, input(req), controller.signal);
        return reply.code(operation === 'publish' ? 202 : 200).send(result);
      } catch (cause) {
        if (controller.signal.aborted) return;
        const err = cause instanceof MessagingError ? cause : new MessagingError('internal_error', '通信服务不可用', 503);
        return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
      } finally { reply.raw.off('close', cancel); controllers.delete(controller); }
    };
  }
  app.post('/api/authenticate', handler('authenticate'));
  app.post('/api/messages', handler('publish', req => {
    const id = req.headers['idempotency-key'];
    const to = req.headers['x-notifs-to'];
    return { message: req.body, options: {
      ...(id === undefined ? {} : { id }),
      ...(to === undefined ? {} : { to: typeof to === 'string' ? to.split(',').map(x => x.trim()) : to }),
    } };
  }));
  app.get('/api/messages/:id', handler('inspect', req => req.params));
  app.post('/api/identities', handler('identities.create'));
  app.get('/api/identities', handler('identities.list', () => ({})));
  app.post('/api/identities/rotate', handler('identities.rotate'));
  app.post('/api/identities/enable', handler('identities.enable'));
  app.put('/api/endpoints', handler('endpoints.put'));
  app.get('/api/endpoints', handler('endpoints.list', () => ({})));
  app.post('/api/endpoints/resume', handler('endpoints.resume'));
  app.put('/api/subscriptions', handler('subscriptions.put'));
  app.get('/api/subscriptions', handler('subscriptions.list', () => ({})));
  app.delete('/api/subscriptions/:name', handler('subscriptions.remove', req => req.params));
  app.get('/api/status', handler('status', () => ({})));
}
