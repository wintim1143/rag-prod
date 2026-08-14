import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/index.js';
import type { SearchService } from '../../src/retrieval/search.js';
import { buildApp } from '../../src/server/app.js';
import { validEnv } from '../helpers.js';

const apps: FastifyInstance[] = [];

async function makeApp(search: SearchService): Promise<FastifyInstance> {
  const config = loadConfig({ env: validEnv() });
  const app = buildApp({ config, logger: false, services: { search } });
  await app.ready();
  apps.push(app);
  return app;
}

afterEach(async () => {
  while (apps.length) {
    const app = apps.pop();
    if (app) await app.close();
  }
});

describe('POST /search', () => {
  it('返回结果并把 query/n/k/tenant 传给服务', async () => {
    const search = {
      search: vi.fn().mockResolvedValue({
        query: 'x',
        results: [],
        stages: { retrievalN: 50, topK: 5, reranker: 'fallback' },
      }),
    };
    const app = await makeApp(search);

    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'x', n: 20, k: 3 },
    });
    expect(res.statusCode).toBe(200);
    // 未带 X-Tenant 头 → 强制用默认租户过滤
    expect(search.search).toHaveBeenCalledWith('x', { n: 20, k: 3, filter: { tenant: 'default' } });
  });

  it('X-Tenant 头覆盖默认租户过滤', async () => {
    const search = {
      search: vi.fn().mockResolvedValue({
        query: 'x',
        results: [],
        stages: { retrievalN: 50, topK: 5, reranker: 'fallback' },
      }),
    };
    const app = await makeApp(search);

    const res = await app.inject({
      method: 'POST',
      url: '/search',
      headers: { 'x-tenant': 'tenant-42' },
      payload: { query: 'x' },
    });
    expect(res.statusCode).toBe(200);
    expect(search.search).toHaveBeenCalledWith('x', { n: undefined, k: undefined, filter: { tenant: 'tenant-42' } });
  });

  it('缺 query 返回 400', async () => {
    const search = { search: vi.fn() };
    const app = await makeApp(search);

    const res = await app.inject({ method: 'POST', url: '/search', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(search.search).not.toHaveBeenCalled();
  });
});
