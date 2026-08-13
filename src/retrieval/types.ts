/** 检索环节的类型定义。 */

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
  stages: {
    retrievalN: number;
    topK: number;
    /** 重排方式：cross-encoder 正常 / fallback 降级到启发式。 */
    reranker: 'cross-encoder' | 'fallback';
    fallbackReason?: string;
  };
}
