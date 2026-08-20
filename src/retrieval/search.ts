import type { Config } from '../config/index.js';
import type { Embedder } from '../ingestion/embedder.js';
import type { ChunkFilter, FtsHit, LanceDBStore, VectorHit } from '../ingestion/store/lancedb.js';
import { classifyDiagnosis, queryTokens } from './classifier.js';
import type { RerankResult, Reranker } from './reranker.js';
import { rrfMerge, rrfMergeMany, type RrfQueryResult } from './rrf.js';
import type { QueryOptimizationOptions, QueryOptimizer } from './query-optimizer.js';
import type { SearchCandidate, SearchResponse, TraceHit, TraceResponse } from './types.js';

export interface SearchService {
  search(
    query: string,
    options?: { n?: number; k?: number; filter?: ChunkFilter; signal?: AbortSignal },
  ): Promise<SearchResponse>;
}

export interface TraceService {
  trace(
    query: string,
    options?: { n?: number; k?: number; filter?: ChunkFilter; expected?: string[]; signal?: AbortSignal },
  ): Promise<TraceResponse>;
}

export interface SearchDeps {
  embedder: Embedder;
  store: LanceDBStore;
  reranker: Reranker;
  optimizer?: QueryOptimizer;
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
  optimization?: Awaited<ReturnType<QueryOptimizer['optimize']>>;
  queryResults?: RrfQueryResult[];
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
    options: { n?: number; k?: number; filter?: ChunkFilter; signal?: AbortSignal } = {},
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
        queryCount: stages.queryResults?.length ?? 0,
        reranker: stages.reranked.status,
        fallbackReason: stages.reranked.reason,
        optimizationLlmCalls: stages.optimization?.llmCalls,
        optimizationLatencyMs: stages.optimization ? Math.round(stages.optimization.latencyMs) : undefined,
      },
      optimization: stages.optimization
        ? {
            originalQuery: stages.optimization.originalQuery,
            queries: stages.optimization.queries,
            strategies: stages.optimization.strategies,
            llmCalls: stages.optimization.llmCalls,
            latencyMs: stages.optimization.latencyMs,
            failures: stages.optimization.failures,
          }
        : undefined,
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
    options: { n?: number; k?: number; filter?: ChunkFilter; signal?: AbortSignal },
  ): Promise<PipelineStages> {
    const n = options.n ?? this.config.retrieval.n;
    const k = options.k ?? this.config.retrieval.k;
    if (!Number.isInteger(n) || !Number.isInteger(k) || n < 1 || k < 1 || k > n || n > 200 || k > 50) {
      throw new Error('检索参数无效：要求 1 ≤ k ≤ n，且 n ≤ 200、k ≤ 50');
    }
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('query 不能为空');
    }

    if (options.signal?.aborted) throw options.signal.reason;
    const optimization = this.deps.optimizer
      ? await this.deps.optimizer.optimize(
          trimmed,
          {
            rewrite: this.config.queryOptimization.rewrite,
            multiQuery: this.config.queryOptimization.multiQuery,
            hyde: this.config.queryOptimization.hyde,
          },
          undefined,
          options.signal,
        )
      : undefined;
    const actualQueries = optimization?.queries.length
      ? optimization.hypothetical && this.config.queryOptimization.hyde
        ? [...optimization.queries, optimization.hypothetical]
        : optimization.queries
      : [trimmed];
    const queryResults: RrfQueryResult[] = [];
    let queryVector: number[] = [];
    for (const [queryIndex, actualQuery] of actualQueries.slice(0, 4).entries()) {
      if (options.signal?.aborted) throw options.signal.reason;
      const vector = (await this.deps.embedder.embedTexts([actualQuery]))[0] as number[];
      if (queryIndex === 0) queryVector = vector;
      const vectors = await this.deps.store.vectorSearch(vector, n, options.filter);
      const fts = optimization?.hypothetical === actualQuery
        ? []
        : await this.deps.store.ftsSearch(actualQuery, n, options.filter);
      queryResults.push({ query: actualQuery, queryIndex, vectorHits: vectors, ftsHits: fts });
    }
    const first = queryResults[0] ?? { query: trimmed, queryIndex: 0, vectorHits: [], ftsHits: [] };
    const merged = rrfMergeMany(queryResults);
    const reranked = await this.deps.reranker.rerank(trimmed, merged.slice(0, n));
    return { query: trimmed, n, k, queryVector, vectorHits: first.vectorHits, ftsHits: first.ftsHits, merged, reranked, optimization, queryResults };
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
