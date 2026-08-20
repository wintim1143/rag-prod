import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/index.js';
import type { IngestService } from '../../src/ingestion/pipeline.js';
import { buildApp } from '../../src/server/app.js';
import { validEnv } from '../helpers.js';

const apps: FastifyInstance[] = [];

async function makeApp(ingest: IngestService): Promise<FastifyInstance> {
  const config = loadConfig({ env: validEnv() });
  const app = buildApp({ config, logger: false, services: { ingest } });
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

describe('POST /ingest', () => {
  it('返回 ingested（docId + 块数），把 path 传给服务', async () => {
    const ingest = {
      ingestPath: vi.fn().mockResolvedValue({
        ingested: [{ docId: 'abc', sourcePath: 'x.md', chunkCount: 3 }],
        failed: [],
      }),
    };
    const app = await makeApp(ingest);

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      payload: { path: 'x.md' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ingested[0].chunkCount).toBe(3);
    // 摄入路径透传租户（缺省默认），与多租户写入链路一致（W3）
    expect(ingest.ingestPath).toHaveBeenCalledWith('x.md', 'default');
  });

  it('body 缺 path 返回 400', async () => {
    const ingest = { ingestPath: vi.fn() };
    const app = await makeApp(ingest);

    const res = await app.inject({ method: 'POST', url: '/ingest', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(ingest.ingestPath).not.toHaveBeenCalled();
  });

  it('path 为空串返回 400', async () => {
    const ingest = { ingestPath: vi.fn() };
    const app = await makeApp(ingest);

    const res = await app.inject({ method: 'POST', url: '/ingest', payload: { path: '' } });
    expect(res.statusCode).toBe(400);
  });
});
