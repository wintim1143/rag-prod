import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/index.js';
import type { TraceService } from '../../src/retrieval/search.js';
import type { TraceResponse } from '../../src/retrieval/types.js';
import { buildApp } from '../../src/server/app.js';
import { validEnv } from '../helpers.js';

const apps: FastifyInstance[] = [];

function traceStub(overrides: Partial<TraceResponse> = {}): TraceResponse {
  return {
    query: 'x',
    config: { n: 50, k: 5, tenant: 'default' },
    knowledgeBase: { totalChunks: 2, documents: 1 },
    queryVectorization: { dimensions: 8 },
    vectorRetrieval: { hits: [], count: 0 },
    bm25Retrieval: { hits: [], count: 0 },
    rrfFusion: { candidates: [], count: 0 },
    rerank: { status: 'fallback', candidates: [], count: 0, topK: [] },
    diagnosis: { category: 'a', label: '知识库本无此内容', evidence: [] },
    ...overrides,
  };
}

async function makeApp(trace: TraceService): Promise<FastifyInstance> {
  const config = loadConfig({ env: validEnv() });
  const app = buildApp({ config, logger: false, services: { trace } });
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

describe('POST /trace', () => {
  it('返回 trace + 分类，并把 query/n/k/expected/tenant 传给服务', async () => {
    const trace = {
      trace: vi.fn().mockResolvedValue(traceStub({ diagnosis: { category: 'b', label: 'x', evidence: ['e'] } })),
    };
    const app = await makeApp(trace);

    const res = await app.inject({
      method: 'POST',
      url: '/trace',
      payload: { query: 'x', n: 20, k: 3, expected: ['c1'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.diagnosis.category).toBe('b');
    // 未带 X-Tenant 头 → 强制用默认租户过滤
    expect(trace.trace).toHaveBeenCalledWith('x', { n: 20, k: 3, expected: ['c1'], filter: { tenant: 'default' } });
  });

  it('X-Tenant 头覆盖默认租户过滤', async () => {
    const trace = { trace: vi.fn().mockResolvedValue(traceStub()) };
    const app = await makeApp(trace);

    const res = await app.inject({
      method: 'POST',
      url: '/trace',
      headers: { 'x-tenant': 'tenant-42' },
      payload: { query: 'x' },
    });
    expect(res.statusCode).toBe(200);
    expect(trace.trace).toHaveBeenCalledWith('x', { n: undefined, k: undefined, expected: undefined, filter: { tenant: 'tenant-42' } });
  });

  it('缺 query 返回 400', async () => {
    const trace = { trace: vi.fn() };
    const app = await makeApp(trace);

    const res = await app.inject({ method: 'POST', url: '/trace', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(trace.trace).not.toHaveBeenCalled();
  });
});
