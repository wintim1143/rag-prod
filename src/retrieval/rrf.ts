import type { FtsHit, VectorHit } from '../ingestion/store/lancedb.js';
import type { QueryProvenance, SearchCandidate } from './types.js';

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

export interface RrfQueryResult {
  query: string;
  queryIndex: number;
  vectorHits: VectorHit[];
  ftsHits: FtsHit[];
}

/** 对多个查询的各检索 lane 一次性进行 RRF 融合，并保留来源。 */
export function rrfMergeMany(results: RrfQueryResult[]): SearchCandidate[] {
  const byId = new Map<string, SearchCandidate>();
  for (const result of results) {
    const lanes: Array<{ name: QueryProvenance['lane']; hits: Array<VectorHit | FtsHit> }> = [
      { name: 'vector', hits: result.vectorHits },
      { name: 'bm25', hits: result.ftsHits },
    ];
    for (const lane of lanes) {
      lane.hits.forEach((hit, index) => {
        const existing = byId.get(hit.id);
        const provenance: QueryProvenance = {
          query: result.query,
          queryIndex: result.queryIndex,
          lane: lane.name,
          rank: index + 1,
        };
        const candidate = existing ?? {
          chunkId: hit.id,
          text: hit.text,
          docId: hit.docId,
          title: hit.title,
          sectionPath: hit.sectionPath,
          sourcePath: hit.sourcePath,
          vector: null,
          bm25: null,
          rrf: 0,
          rerank: null,
          provenance: [],
        };
        candidate.rrf += 1 / (RRF_K + index + 1);
        candidate.provenance?.push(provenance);
        if (lane.name === 'vector') candidate.vector = Math.max(candidate.vector ?? -Infinity, 1 - (hit as VectorHit).distance);
        else candidate.bm25 = Math.max(candidate.bm25 ?? -Infinity, (hit as FtsHit).score);
        byId.set(hit.id, candidate);
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.rrf - a.rrf || a.chunkId.localeCompare(b.chunkId));
}
