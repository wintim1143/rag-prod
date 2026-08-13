import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import type { Embedder } from '../../src/ingestion/embedder.js';
import { IngestPipeline } from '../../src/ingestion/pipeline.js';
import { LanceDBStore } from '../../src/ingestion/store/lancedb.js';
import type { RerankResult, Reranker } from '../../src/retrieval/reranker.js';
import { SearchPipeline } from '../../src/retrieval/search.js';
import type { SearchCandidate } from '../../src/retrieval/types.js';
import { validEnv } from '../helpers.js';

class FakeEmbedder implements Embedder {
  embedTexts(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => [t.length % 16, 1, 2, 3, 4, 5, 6, 7]));
  }
}

/** 把候选按 RRF 反序，模拟 cross-encoder 改变粗筛顺序；记录调用。 */
class ReverseReranker implements Reranker {
  calls: string[] = [];

  async rerank(query: string, candidates: SearchCandidate[]): Promise<RerankResult> {
    this.calls.push(query);
    const sorted = [...candidates].reverse();
    sorted.forEach((c, i) => (c.rerank = sorted.length - i));
    return { candidates: sorted, status: 'cross-encoder' };
  }
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-search-'));

async function seed() {
  const config = loadConfig({ env: validEnv() });
  const store = new LanceDBStore(tmpDir);
  const pipeline = new IngestPipeline(config, { embedder: new FakeEmbedder(), store });
  await fs.writeFile(path.join(tmpDir, 'rag.md'), '# RAG 简介\n\n检索增强生成 RAG 结合检索与生成两个阶段。');
  await fs.writeFile(path.join(tmpDir, 'weather.md'), '# 天气\n\n今天天气很好，适合散步。');
  await pipeline.ingestPath(tmpDir);
  return { config, store };
}

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('SearchPipeline — 混合检索 + 重排', () => {
  it('返回结果携带各阶段分数，重排被调用', async () => {
    const { config, store } = await seed();
    const reranker = new ReverseReranker();
    const search = new SearchPipeline(config, { embedder: new FakeEmbedder(), store, reranker });

    const resp = await search.search('检索增强');
    expect(resp.results.length).toBeGreaterThan(0);
    const first = resp.results[0] as (typeof resp.results)[number];
    expect(first.scores).toHaveProperty('vector');
    expect(first.scores).toHaveProperty('bm25');
    expect(first.scores).toHaveProperty('rrf');
    expect(first.scores).toHaveProperty('rerank');
    expect(resp.stages.reranker).toBe('cross-encoder');
    expect(reranker.calls).toContain('检索增强');
  });

  it('重排改变粗筛顺序（与原始 rrf 顺序有实质差异）', async () => {
    const { config, store } = await seed();
    const reranker = new ReverseReranker();
    const search = new SearchPipeline(config, { embedder: new FakeEmbedder(), store, reranker });

    const resp = await search.search('检索增强', { k: 5 });
    const rerankOrder = resp.results.map((r) => r.chunkId);
    const rrfOrder = [...resp.results]
      .sort((a, b) => b.scores.rrf - a.scores.rrf)
      .map((r) => r.chunkId);
    expect(rerankOrder).not.toEqual(rrfOrder);
  });

  it('n/k 覆盖配置默认值', async () => {
    const { config, store } = await seed();
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store,
      reranker: new ReverseReranker(),
    });

    const resp = await search.search('RAG', { n: 10, k: 1 });
    expect(resp.stages.retrievalN).toBe(10);
    expect(resp.stages.topK).toBe(1);
    expect(resp.results.length).toBe(1);
  });

  it('空 query 抛错', async () => {
    const { config, store } = await seed();
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store,
      reranker: new ReverseReranker(),
    });
    await expect(search.search('   ')).rejects.toThrow('query 不能为空');
  });
});
