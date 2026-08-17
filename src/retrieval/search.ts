import type { Config } from '../config/index.js';
import type { Embedder } from '../ingestion/embedder.js';
import type { ChunkFilter, FtsHit, LanceDBStore, VectorHit } from '../ingestion/store/lancedb.js';
import { classifyDiagnosis, queryTokens } from './classifier.js';
import type { RerankResult, Reranker } from './reranker.js';
import { rrfMerge } from './rrf.js';
import type { SearchCandidate, SearchResponse, TraceHit, TraceResponse } from './types.js';

export interface SearchService {
  search(
    query: string,
    options?: { n?: number; k?: number; filter?: ChunkFilter },
  ): Promise<SearchResponse>;
}

export interface TraceService {
  trace(
    query: string,
    options?: { n?: number; k?: number; filter?: ChunkFilter; expected?: string[] },
  ): Promise<TraceResponse>;
}

export interface SearchDeps {
  embedder: Embedder;
  store: LanceDBStore;
  reranker: Reranker;
}

/** 检索管线中间产物（search 与 trace 共享，避免两条实现漂移）。 */
interface PipelineStages {
  query: string;
  n: number;
  k: number;
  queryVector: number[];
  vectorHits: VectorHit[];
  ftsHits: FtsHit[];
  merged: SearchCandidate[];
  reranked: RerankResult;
}

/**
 * 检索管线：query 向量化 → 混合检索（向量 + BM25）→ RRF 融合（N 候选）→ cross-encoder 重排 → top-k。
 * search() 返回 top-k 与各环节分数；trace() 暴露完整中间环节并给出失败分类（07 检索诊断）。
 * filter 下推到向量与 BM25 检索（如租户隔离）。
 */
export class SearchPipeline implements SearchService, TraceService {
  constructor(
    private readonly config: Config,
    private readonly deps: SearchDeps,
  ) {}

  async search(
    query: string,
    options: { n?: number; k?: number; filter?: ChunkFilter } = {},
  ): Promise<SearchResponse> {
    const stages = await this.runStages(query, options);
    const results = stages.reranked.candidates.slice(0, stages.k).map((c) => ({
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
      query: stages.query,
      results,
      stages: {
        retrievalN: stages.n,
        topK: stages.k,
        reranker: stages.reranked.status,
        fallbackReason: stages.reranked.reason,
      },
    };
  }

  /** 单 query 逐环节 trace + 失败分类：输出每阶段全量命中与分数，供诊断定位检索问题。 */
  async trace(
    query: string,
    options: { n?: number; k?: number; filter?: ChunkFilter; expected?: string[] } = {},
  ): Promise<TraceResponse> {
    const stages = await this.runStages(query, options);

    const [docs, chunkTexts] = await Promise.all([
      this.deps.store.listDocuments(options.filter),
      this.deps.store.scanChunks(options.filter),
    ]);
    const totalChunks = docs.reduce((sum, d) => sum + d.chunkCount, 0);
    const tokens = queryTokens(stages.query);
    const queryTokensInCorpus =
      tokens.length > 0 &&
      tokens.some((t) => chunkTexts.some((c) => c.text.toLowerCase().includes(t)));

    const diagnosis = classifyDiagnosis({
      totalChunks,
      vectorHitCount: stages.vectorHits.length,
      bm25HitCount: stages.ftsHits.length,
      candidateCount: stages.merged.length,
      topK: stages.k,
      queryTokensInCorpus,
      expected: options.expected,
      // 排名基于重排后的顺序（top-k = 重排后前 k 个），而非 RRF 序
      candidateIds: stages.reranked.candidates.map((c) => c.chunkId),
      topKMinRerankScore: stages.reranked.candidates[stages.k - 1]?.rerank ?? undefined,
      nextRerankScore: stages.reranked.candidates[stages.k]?.rerank ?? undefined,
    });

    return {
      query: stages.query,
      config: {
        n: stages.n,
        k: stages.k,
        tenant: options.filter?.tenant ?? this.config.tenant.default,
      },
      knowledgeBase: { totalChunks, documents: docs.length },
      queryVectorization: { dimensions: stages.queryVector.length },
      vectorRetrieval: {
        hits: stages.vectorHits.map((h) => ({ ...toTraceHit(h), score: 1 - h.distance })),
        count: stages.vectorHits.length,
      },
      bm25Retrieval: {
        hits: stages.ftsHits.map((h) => ({ ...toTraceHit(h), score: h.score })),
        count: stages.ftsHits.length,
      },
      rrfFusion: {
        candidates: stages.merged.map((c) => ({ ...toTraceHit(c), score: c.rrf })),
        count: stages.merged.length,
      },
      rerank: {
        status: stages.reranked.status,
        reason: stages.reranked.reason,
        candidates: stages.reranked.candidates.map((c) => ({
          ...toTraceHit(c),
          score: c.rerank ?? 0,
        })),
        count: stages.reranked.candidates.length,
        topK: stages.reranked.candidates.slice(0, stages.k).map((c) => ({
          ...toTraceHit(c),
          score: c.rerank ?? 0,
        })),
      },
      diagnosis,
    };
  }

  /** 跑完整检索管线，返回中间产物；query 清洗与 n/k 解析在共享入口保证 search/trace 行为一致。 */
  private async runStages(
    query: string,
    options: { n?: number; k?: number; filter?: ChunkFilter },
  ): Promise<PipelineStages> {
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
    return { query: trimmed, n, k, queryVector, vectorHits, ftsHits, merged, reranked };
  }
}

/** 把候选/命中转成 trace 命中（无分数；分数由各环节按需填写）。VectorHit/FtsHit 用 id，SearchCandidate 用 chunkId。 */
function toTraceHit(hit: {
  id?: string;
  chunkId?: string;
  docId: string;
  title: string;
  sourcePath: string;
  text: string;
}): TraceHit {
  return {
    chunkId: hit.chunkId ?? hit.id ?? '',
    docId: hit.docId,
    title: hit.title,
    sourcePath: hit.sourcePath,
    text: hit.text,
    score: 0,
  };
}
