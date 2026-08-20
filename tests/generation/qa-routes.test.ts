import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/index.js';
import type { AnswerService } from '../../src/generation/service.js';
import { buildApp } from '../../src/server/app.js';
import { validEnv } from '../helpers.js';

const apps: FastifyInstance[] = [];

async function makeApp(answer: AnswerService): Promise<FastifyInstance> {
  const config = loadConfig({ env: validEnv() });
  const app = buildApp({ config, logger: false, services: { answer } });
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

beforeEach(() => {
  vi.clearAllMocks();
});

const answerStub = {
  ask: vi.fn().mockResolvedValue({
    query: 'q',
    answer: '答案是 [1]',
    citations: [{ index: 1, chunkId: 'c1', docId: 'd', title: 't', sourcePath: 'x.md', text: '块' }],
    chunks: [],
    stages: { retrievalN: 50, topK: 5, reranker: 'cross-encoder' },
  }),
  chat: vi.fn().mockResolvedValue({
    query: 'q',
    answer: '答案是 [1]',
    citations: [],
    chunks: [],
    stages: { retrievalN: 50, topK: 5, reranker: 'cross-encoder' },
  }),
};

describe('POST /ask', () => {
  it('返回回答 + 引用，并把 query/k 传给服务', async () => {
    const app = await makeApp(answerStub);
    const res = await app.inject({
      method: 'POST',
      url: '/ask',
      payload: { query: 'Fastify 端口？', k: 3 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.answer).toContain('[1]');
    expect(body.citations[0].chunkId).toBe('c1');
    expect(answerStub.ask).toHaveBeenCalledWith('Fastify 端口？', { k: 3, tenant: 'default' });
  });

  it('缺 query 返回 400', async () => {
    const app = await makeApp(answerStub);
    const res = await app.inject({ method: 'POST', url: '/ask', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(answerStub.ask).not.toHaveBeenCalled();
  });
});

describe('POST /chat', () => {
  it('接收历史消息，把 messages/k 传给服务', async () => {
    const app = await makeApp(answerStub);
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        messages: [
          { role: 'user', content: '介绍 Fastify' },
          { role: 'assistant', content: 'Fastify 是……' },
          { role: 'user', content: '那端口呢？' },
        ],
        k: 2,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.answer).toBeDefined();
    expect(answerStub.chat).toHaveBeenCalledWith(
      [
        { role: 'user', content: '介绍 Fastify' },
        { role: 'assistant', content: 'Fastify 是……' },
        { role: 'user', content: '那端口呢？' },
      ],
      { k: 2, tenant: 'default' },
    );
  });

  it('messages 缺省返回 400', async () => {
    const app = await makeApp(answerStub);
    const res = await app.inject({ method: 'POST', url: '/chat', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(answerStub.chat).not.toHaveBeenCalled();
  });

  it('messages 为空数组返回 400', async () => {
    const app = await makeApp(answerStub);
    const res = await app.inject({ method: 'POST', url: '/chat', payload: { messages: [] } });
    expect(res.statusCode).toBe(400);
  });
});
