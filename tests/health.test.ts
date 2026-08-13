import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/index.js';
import { buildApp } from '../src/server/app.js';
import { validEnv } from './helpers.js';

async function makeApp() {
  const config = loadConfig({ env: validEnv() });
  const app = buildApp({ config, logger: false });
  await app.ready();
  return app;
}

describe('GET /health', () => {
  it('返回 200 与 ok 状态', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('返回配置栈摘要（LLM / Embedding / 向量库 / 重排器）', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();

    expect(body.stack.framework).toBe('langchain-js');
    expect(body.stack.server).toBe('fastify');
    expect(body.stack.vectorStore).toBe('lance-db');
    expect(body.stack.llm).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
    expect(body.stack.embedding).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      usesDedicatedProvider: false,
    });
    expect(body.stack.reranker.mode).toBe('local-cross-encoder');
  });

  it('响应绝不包含 API 密钥', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.payload).not.toContain('sk-test-key');
    expect(res.json().stack.llm.apiKey).toBeUndefined();
  });

  it('未注册路由返回 404', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
  });
});
