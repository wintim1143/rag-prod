import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import type { Embedder } from '../../src/ingestion/embedder.js';
import { IngestPipeline } from '../../src/ingestion/pipeline.js';
import { LanceDBStore, type DocumentMeta } from '../../src/ingestion/store/lancedb.js';
import type { RerankResult, Reranker } from '../../src/retrieval/reranker.js';
import { SearchPipeline } from '../../src/retrieval/search.js';
import type { SearchCandidate } from '../../src/retrieval/types.js';
import { validEnv } from '../helpers.js';

class FakeEmbedder implements Embedder {
  embedTexts(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => [t.length % 16, 1, 2, 3, 4, 5, 6, 7]));
  }
}

/** 反转候选顺序模拟 cross-encoder 改变粗筛顺序；记录调用。 */
class ReverseReranker implements Reranker {
  calls: string[] = [];

  async rerank(query: string, candidates: SearchCandidate[]): Promise<RerankResult> {
    this.calls.push(query);
    const sorted = [...candidates].reverse();
    sorted.forEach((c, i) => (c.rerank = sorted.length - i));
    return { candidates: sorted, status: 'cross-encoder' };
  }
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-trace-'));

async function seed() {
  const config = loadConfig({ env: validEnv() });
  const store = new LanceDBStore(tmpDir);
  const pipeline = new IngestPipeline(config, { embedder: new FakeEmbedder(), store });
  await fs.writeFile(path.join(tmpDir, 'rag.md'), '# RAG 简介\n\n检索增强生成 RAG 结合检索与生成两个阶段。');
  await fs.writeFile(path.join(tmpDir, 'weather.md'), '# 天气\n\n今天天气很好，适合散步。');
  // 英文文档让 BM25（tantivy 英文分词）有稳定命中，验证全文环节
  await fs.writeFile(path.join(tmpDir, 'api.md'), '# API 服务\n\nFastify 提供 HTTP API 服务，默认端口 8080。');
  await pipeline.ingestPath(tmpDir);
  return { config, store };
}

/** 全空命中的 stub store（无候选场景）。 */
function emptyStore(chunks: { id: string; text: string }[]): LanceDBStore {
  const docs: DocumentMeta[] = chunks.length
    ? [{ docId: 'd1', title: 'd', sourcePath: 'd.md', chunkCount: chunks.length, uploadedAt: 'x' }]
    : [];
  return {
    vectorSearch: vi.fn().mockResolvedValue([]),
    ftsSearch: vi.fn().mockResolvedValue([]),
    scanChunks: vi.fn().mockResolvedValue(chunks),
    listDocuments: vi.fn().mockResolvedValue(docs),
  } as unknown as LanceDBStore;
}

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('SearchPipeline.trace — 逐环节检索诊断', () => {
  it('返回各环节命中数与分数结构 + 知识库统计 + 诊断', async () => {
    const { config, store } = await seed();
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store,
      reranker: new ReverseReranker(),
    });

    const t = await search.trace('Fastify');
    expect(t.query).toBe('Fastify');
    expect(t.queryVectorization.dimensions).toBeGreaterThan(0);
    expect(t.vectorRetrieval.count).toBeGreaterThan(0);
    expect(t.bm25Retrieval.count).toBeGreaterThan(0);
    expect(t.rrfFusion.count).toBeGreaterThan(0);
    expect(t.rerank.count).toBeGreaterThan(0);
    expect(t.rerank.status).toBe('cross-encoder');
    expect(t.knowledgeBase.totalChunks).toBeGreaterThan(0);
    expect(t.knowledgeBase.documents).toBeGreaterThan(0);
    expect(['a', 'b', 'c', 'd']).toContain(t.diagnosis.category);
  });

  it('rerank 候选按分数降序，topK 为前 k 个', async () => {
    const { config, store } = await seed();
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store,
      reranker: new ReverseReranker(),
    });

    const t = await search.trace('检索增强', { k: 2 });
    const scores = t.rerank.candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(t.rerank.topK).toHaveLength(2);
    expect(t.config.k).toBe(2);
    expect(t.config.n).toBeGreaterThan(0);
  });

  it('无候选且 query 词不在库 → 诊断 a', async () => {
    const config = loadConfig({ env: validEnv() });
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store: emptyStore([{ id: 'c1', text: '今天天气很好' }]),
      reranker: new ReverseReranker(),
    });

    const t = await search.trace('量子计算');
    expect(t.vectorRetrieval.count).toBe(0);
    expect(t.bm25Retrieval.count).toBe(0);
    expect(t.diagnosis.category).toBe('a');
  });

  it('无候选但 query 词在库 → 诊断 b（表达不匹配）', async () => {
    const config = loadConfig({ env: validEnv() });
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store: emptyStore([{ id: 'c1', text: '量子计算原理与应用' }]),
      reranker: new ReverseReranker(),
    });

    const t = await search.trace('量子计算');
    expect(t.diagnosis.category).toBe('b');
  });

  it('expected 块排太后 → 诊断 c', async () => {
    const { config, store } = await seed();
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store,
      reranker: new ReverseReranker(),
    });
    const first = await search.trace('检索增强');
    const id = first.vectorRetrieval.hits[0]?.chunkId as string;

    const t = await search.trace('检索增强', { k: 1, expected: [id] });
    expect(t.diagnosis.category).toBe('c');
    expect(t.diagnosis.evidence.some((e) => e.includes('top-1'))).toBe(true);
  });

  it('expected 块在 top-k 内 → 诊断 d（检索正常）', async () => {
    const { config, store } = await seed();
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store,
      reranker: new ReverseReranker(),
    });
    const first = await search.trace('检索增强');
    const topId = first.rerank.candidates[0]?.chunkId as string;

    const t = await search.trace('检索增强', { k: 1, expected: [topId] });
    expect(t.diagnosis.category).toBe('d');
  });

  it('空 query 抛错', async () => {
    const { config, store } = await seed();
    const search = new SearchPipeline(config, {
      embedder: new FakeEmbedder(),
      store,
      reranker: new ReverseReranker(),
    });
    await expect(search.trace('   ')).rejects.toThrow('query 不能为空');
  });
});
