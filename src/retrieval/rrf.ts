import type { FtsHit, VectorHit } from '../ingestion/store/lancedb.js';
import type { SearchCandidate } from './types.js';

/** RRF 常数（Reciprocal Rank Fusion 标准值）。 */
const RRF_K = 60;

/**
 * 把向量检索与 BM25 检索结果按 Reciprocal Rank Fusion 融合。
 * 每路按排名贡献 1/(k+rank)，同名块合并；输出按 rrf 降序的候选列表，
 * 同时保留各阶段原始分数（vector / bm25）供 /search 暴露。
 */
export function rrfMerge(vectorHits: VectorHit[], ftsHits: FtsHit[]): SearchCandidate[] {
  const rrf = new Map<string, number>();
  vectorHits.forEach((hit, i) => {
    rrf.set(hit.id, (rrf.get(hit.id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  ftsHits.forEach((hit, i) => {
    rrf.set(hit.id, (rrf.get(hit.id) ?? 0) + 1 / (RRF_K + i + 1));
  });

  const vecById = new Map(vectorHits.map((h) => [h.id, h]));
  const ftsById = new Map(ftsHits.map((h) => [h.id, h]));
  const seen = new Set<string>();
  const merged: SearchCandidate[] = [];

  for (const hit of [...vectorHits, ...ftsHits]) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    const vec = vecById.get(hit.id);
    const fts = ftsById.get(hit.id);
    merged.push({
      chunkId: hit.id,
      text: hit.text,
      docId: hit.docId,
      title: hit.title,
      sectionPath: hit.sectionPath,
      sourcePath: hit.sourcePath,
      vector: vec ? 1 - vec.distance : null,
      bm25: fts?.score ?? null,
      rrf: rrf.get(hit.id) ?? 0,
      rerank: null,
    });
  }

  merged.sort((a, b) => b.rrf - a.rrf);
  return merged;
}
