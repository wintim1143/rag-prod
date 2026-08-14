import type { Config } from '../config/index.js';
import type { Embedder } from '../ingestion/embedder.js';
import type { ChunkFilter, LanceDBStore } from '../ingestion/store/lancedb.js';
import { rrfMerge } from './rrf.js';
import type { Reranker } from './reranker.js';
import type { SearchResponse } from './types.js';

export interface SearchService {
  search(
    query: string,
    options?: { n?: number; k?: number; filter?: ChunkFilter },
  ): Promise<SearchResponse>;
}

export interface SearchDeps {
  embedder: Embedder;
  store: LanceDBStore;
  reranker: Reranker;
}

/**
 * 检索管线：query 向量化 → 混合检索（向量 + BM25）→ RRF 融合（N 候选）→ cross-encoder 重排 → top-k。
 * 返回各环节分数（vector / bm25 / rrf / rerank），把「粗筛→精排」的取舍透明可见。
 * filter 下推到向量与 BM25 检索（如租户隔离）。
 */
export class SearchPipeline implements SearchService {
  constructor(
    private readonly config: Config,
    private readonly deps: SearchDeps,
  ) {}

  async search(
    query: string,
    options: { n?: number; k?: number; filter?: ChunkFilter } = {},
  ): Promise<SearchResponse> {
    const n = options.n ?? this.config.retrieval.n;
    const k = options.k ?? this.config.retrieval.k;
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('query 不能为空');
    }

    const queryVector = (await this.deps.embedder.embedTexts([trimmed]))[0] as number[];
    const [vectorHits, ftsHits] = await Promise.all([
      this.deps.store.vectorSearch(queryVector, n, options.filter),
      this.deps.store.ftsSearch(trimmed, n, options.filter),
    ]);

    const merged = rrfMerge(vectorHits, ftsHits);
    const reranked = await this.deps.reranker.rerank(trimmed, merged);
    const results = reranked.candidates.slice(0, k).map((c) => ({
      chunkId: c.chunkId,
      text: c.text,
      docId: c.docId,
      title: c.title,
      sectionPath: c.sectionPath,
      sourcePath: c.sourcePath,
      scores: {
        vector: c.vector,
        bm25: c.bm25,
        rrf: c.rrf,
        rerank: c.rerank,
      },
    }));

    return {
      query: trimmed,
      results,
      stages: {
        retrievalN: n,
        topK: k,
        reranker: reranked.status,
        fallbackReason: reranked.reason,
      },
    };
  }
}
