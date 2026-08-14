import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/index.js';
import type { KnowledgeService } from '../../src/knowledge/service.js';
import { buildApp } from '../../src/server/app.js';
import { validEnv } from '../helpers.js';

const apps: FastifyInstance[] = [];

async function makeApp(knowledge: KnowledgeService): Promise<FastifyInstance> {
  const config = loadConfig({ env: validEnv() });
  const app = buildApp({ config, logger: false, services: { knowledge } });
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

const knowledgeStub = {
  listDocuments: vi.fn().mockResolvedValue([
    { docId: 'd1', title: '文档一', sourcePath: 'a.md', chunkCount: 3, uploadedAt: 'x', tenant: 'default' },
  ]),
  deleteDocument: vi.fn().mockResolvedValue({ docId: 'd1', deleted: 3 }),
  reindexDocument: vi.fn().mockResolvedValue({ docId: 'd1', chunkCount: 5 }),
};

describe('知识库管理 API', () => {
  it('GET /documents 返回文档列表', async () => {
    const app = await makeApp(knowledgeStub);
    const res = await app.inject({ method: 'GET', url: '/documents' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].docId).toBe('d1');
    expect(body[0].chunkCount).toBe(3);
    expect(knowledgeStub.listDocuments).toHaveBeenCalled();
  });

  it('DELETE /documents/:docId 删除并返回删除数', async () => {
    const app = await makeApp(knowledgeStub);
    const res = await app.inject({ method: 'DELETE', url: '/documents/d1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ docId: 'd1', deleted: 3 });
    expect(knowledgeStub.deleteDocument).toHaveBeenCalledWith('d1');
  });

  it('POST /documents/:docId/reindex 重索引并返回新块数', async () => {
    const app = await makeApp(knowledgeStub);
    const res = await app.inject({ method: 'POST', url: '/documents/d1/reindex' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ docId: 'd1', chunkCount: 5 });
    expect(knowledgeStub.reindexDocument).toHaveBeenCalledWith('d1');
  });

  it('reindex 不存在的 docId 返回 404', async () => {
    knowledgeStub.reindexDocument.mockRejectedValueOnce(new Error('文档不存在: d9'));
    const app = await makeApp(knowledgeStub);
    const res = await app.inject({ method: 'POST', url: '/documents/d9/reindex' });
    expect(res.statusCode).toBe(404);
  });
});
