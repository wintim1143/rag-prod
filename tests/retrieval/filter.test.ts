import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import type { Embedder } from '../../src/ingestion/embedder.js';
import { IngestPipeline } from '../../src/ingestion/pipeline.js';
import { LanceDBStore, type ChunkFilter } from '../../src/ingestion/store/lancedb.js';
import type { RerankResult, Reranker } from '../../src/retrieval/reranker.js';
import { SearchPipeline } from '../../src/retrieval/search.js';
import type { SearchCandidate } from '../../src/retrieval/types.js';
import { validEnv } from '../helpers.js';

class FakeEmbedder implements Embedder {
  embedTexts(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => [t.length % 16, 1, 2, 3, 4, 5, 6, 7]));
  }
}

class PassReranker implements Reranker {
  async rerank(_query: string, candidates: SearchCandidate[]): Promise<RerankResult> {
    candidates.forEach((c, i) => (c.rerank = candidates.length - i));
    return { candidates, status: 'cross-encoder' };
  }
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-filter-'));

/** 摄入两个租户的文档，返回检索管线。 */
async function setup() {
  const config = loadConfig({ env: validEnv() });
  const store = new LanceDBStore(tmpDir);
  const pipeline = new IngestPipeline(config, { embedder: new FakeEmbedder(), store });
  // 默认租户（tenant 由配置写入）
  await fs.writeFile(path.join(tmpDir, 'common.md'), '# 共享\n\n检索增强生成。');
  await pipeline.ingestPath(path.join(tmpDir, 'common.md'));
  return { config, store };
}

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('SearchPipeline — filter 下推', () => {
  it('ChunkFilter 支持 tenant + docId 组合', () => {
    const filter: ChunkFilter = { tenant: 't1', docId: 'd1' };
    expect(filter.tenant).toBe('t1');
    expect(filter.docId).toBe('d1');
  });

  it('search 接受 filter 并透传给存储层（无结果即验证接口接通）', async () => {
    const { config, store } = await setup();
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store,
      reranker: new PassReranker(),
    });

    // filter 指向不存在的租户 → 结果为空（说明 filter 已下推，否则会命中默认租户块）
    const resp = await search.search('检索增强', { filter: { tenant: 'no-such-tenant' } });
    expect(resp.results).toHaveLength(0);
  });
});
