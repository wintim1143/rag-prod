/** 检索环节的类型定义。 */

import type { Diagnosis } from './classifier.js';

export interface SearchCandidate {
  chunkId: string;
  text: string;
  docId: string;
  title: string;
  sectionPath: string;
  sourcePath: string;
  /** 余弦相似度（0~2 距离转为 1-distance；未命中为 null）。 */
  vector: number | null;
  /** BM25 分数（未命中为 null）。 */
  bm25: number | null;
  /** RRF 融合分。 */
  rrf: number;
  /** cross-encoder 重排分（兜底时为启发式分）。 */
  rerank: number | null;
  /** 该候选在多查询融合中的来源。 */
  provenance?: QueryProvenance[];
}

export interface QueryProvenance {
  query: string;
  queryIndex: number;
  lane: 'vector' | 'bm25';
  rank: number;
}

export interface SearchResult {
  chunkId: string;
  text: string;
  docId: string;
  title: string;
  sectionPath: string;
  sourcePath: string;
  scores: {
    vector: number | null;
    bm25: number | null;
    rrf: number;
    rerank: number | null;
  };
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  optimization?: {
    originalQuery: string;
    queries: string[];
    strategies: string[];
    llmCalls: number;
    latencyMs: number;
    failures?: Array<{ strategy: string; message: string }>;
  };
  stages: {
    retrievalN: number;
    topK: number;
    /** 实际发起的检索查询条数（多查询/HyDE 会 >1，评估用，S3）。 */
    queryCount: number;
    /** 重排方式：cross-encoder 正常 / fallback 降级到启发式。 */
    reranker: 'cross-encoder' | 'fallback';
    fallbackReason?: string;
    /** 查询优化 LLM 调用次数（评估用）。 */
    optimizationLlmCalls?: number;
    /** 查询优化耗时 ms（评估用）。 */
    optimizationLatencyMs?: number;
  };
}

/** 检索诊断：单环节命中（携带该环节分数，如 cosine 相似度 / BM25 / RRF / rerank）。 */
export interface TraceHit {
  chunkId: string;
  docId: string;
  title: string;
  sourcePath: string;
  text: string;
  score: number;
}

/** 检索诊断 trace：逐环节输出 + 知识库统计 + 失败分类。 */
export interface TraceResponse {
  query: string;
  config: {
    /** 混合检索粗筛候选数。 */
    n: number;
    /** 返回的 top-k。 */
    k: number;
    /** 检索的租户范围（诊断结论基于该租户视图）。 */
    tenant: string;
  };
  knowledgeBase: {
    /** 当前租户下总块数。 */
    totalChunks: number;
    /** 当前租户下文档数。 */
    documents: number;
  };
  queryVectorization: {
    /** 向量维度。 */
    dimensions: number;
  };
  vectorRetrieval: {
    hits: TraceHit[];
    count: number;
  };
  bm25Retrieval: {
    hits: TraceHit[];
    count: number;
  };
  rrfFusion: {
    candidates: TraceHit[];
    count: number;
  };
  rerank: {
    /** cross-encoder 正常 / fallback 降级。 */
    status: 'cross-encoder' | 'fallback';
    reason?: string;
    candidates: TraceHit[];
    count: number;
    /** 重排后返回的 top-k。 */
    topK: TraceHit[];
  };
  diagnosis: Diagnosis;
}
