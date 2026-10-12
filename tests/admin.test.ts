import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, SecretBox, verifyPassword } from '@notify-hub/store';
import { buildServer } from '../apps/server/src/app.ts';
import { testStore } from './helpers.ts';

describe('口令散列（§5.11）', () => {
  it('正确口令通过，错误口令拒绝', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword('correct horse', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });
  it('同一口令两次散列不同（有盐）', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
  });
  it('格式非法的散列不会被误判通过', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('加密密钥库（§5.11）', () => {
  const newBox = () => {
    const store = testStore();
    return { store, box: new SecretBox(store, randomBytes(32)) };
  };

  it('存进去的是密文，取出来是明文', () => {
    const { store, box } = newBox();
    box.set('GITHUB_TOKEN', 'ghp_secret_value');
    expect(store.getSecretCiphertext('GITHUB_TOKEN')).not.toContain('ghp_secret_value');
    expect(box.get('GITHUB_TOKEN')).toBe('ghp_secret_value');
    expect(box.names()).toEqual(['GITHUB_TOKEN']);
    box.remove('GITHUB_TOKEN');
    expect(box.get('GITHUB_TOKEN')).toBeUndefined();
  });

  it('解析优先级：密钥库 → 环境变量 → 前缀环境变量', () => {
    const { box } = newBox();
    box.set('A', 'from-box');
    expect(box.resolve('A', {})).toBe('from-box');
    expect(box.resolve('B', { B: 'from-env' })).toBe('from-env');
    expect(box.resolve('C', { NOTIFY_SECRET_C: 'from-prefix' })).toBe('from-prefix');
    expect(box.resolve('D', {})).toBeUndefined();
  });
});

describe('管理鉴权与 API（§5.11 / §5.9）', () => {
  function setup() {
    const store = testStore();
    store.createUser('admin', hashPassword('pw123456'));
    const app = buildServer({ store });
    return { store, app };
  }

  async function loginCookie(app: ReturnType<typeof buildServer>): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'pw123456' },
    });
    expect(res.statusCode).toBe(200);
    return String(res.headers['set-cookie']).split(';')[0]!;
  }

  it('未登录访问管理 API → 401', async () => {
    const { app } = setup();
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/overview' })).statusCode).toBe(401);
    await app.close();
  });

  it('错误口令 → 401；正确口令 → 会话 cookie 可用', async () => {
    const { app } = setup();
    await app.ready();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'nope' },
    });
    expect(bad.statusCode).toBe(401);

    const cookie = await loginCookie(app);
    const overview = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().counts).toBeDefined();
    await app.close();
  });

  it('登出后会话失效', async () => {
    const { app } = setup();
    await app.ready();
    const cookie = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    await app.close();
  });

  it('创建源返回一次性 token；通道/规则做结构校验', async () => {
    const { app } = setup();
    await app.ready();
    const cookie = await loginCookie(app);
    const h = { cookie };

    const src = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/sources',
      headers: h,
      payload: { name: 'cli' },
    });
    expect(src.statusCode).toBe(200);
    expect(src.json().token).toBeTruthy();

    const badCh = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/channels',
      headers: h,
      payload: { name: 'h', kind: 'webhook', config: { url: 'not-a-url' } },
    });
    expect(badCh.statusCode).toBe(400);

    const goodCh = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/channels',
      headers: h,
      payload: { name: 'phone', kind: 'local', config: {} },
    });
    expect(goodCh.statusCode).toBe(200);

    const badRule = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rules',
      headers: h,
      payload: { name: 'r', when: {}, actions: [] },
    });
    expect(badRule.statusCode).toBe(400);

    const goodRule = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rules',
      headers: h,
      payload: { name: 'r', when: {}, actions: [{ channel: 'phone' }] },
    });
    expect(goodRule.statusCode).toBe(200);
    await app.close();
  });

  it('死信可手动重试', async () => {
    const store = testStore();
    store.createUser('admin', hashPassword('pw123456'));
    const src = store.createSource({ name: 's' });
    const ch = store.upsertChannel({ name: 'c', kind: 'local', config: {} });
    const now = new Date().toISOString();
    store.insertEvent(
      src.source.id,
      {
        event_id: 'e1',
        source: 's',
        producer_id: null,
        type: 't',
        text: 'x',
        title: null,
        url: null,
        severity: 'info',
        dedup_key: 'd1',
        at: now,
        received_at: now,
        data: {},
      },
      null,
    );
    const id = store.enqueueDelivery({
      eventId: 'e1',
      ruleId: null,
      channelId: ch.id,
      idempotencyKey: 'k',
      renderedJson: '{}',
    });
    store.markDead(id, 'boom');

    const app = buildServer({ store });
    await app.ready();
    const cookie = await loginCookie(app);
    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/deliveries/${id}/retry`,
      headers: { cookie },
    });
    expect(retry.statusCode).toBe(200);
    expect(store.getDelivery(id)!.status).toBe('pending');
    await app.close();
  });
});
