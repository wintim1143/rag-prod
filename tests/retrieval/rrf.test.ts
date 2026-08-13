import { describe, expect, it } from 'vitest';
import type { FtsHit, VectorHit } from '../../src/ingestion/store/lancedb.js';
import { rrfMerge } from '../../src/retrieval/rrf.js';

function vectorHit(id: string, overrides: Partial<VectorHit> = {}): VectorHit {
  return {
    id,
    text: `text-${id}`,
    docId: 'doc',
    title: 't',
    sourcePath: 's.md',
    sectionPath: '',
    distance: 0.5,
    ...overrides,
  };
}

function ftsHit(id: string, overrides: Partial<FtsHit> = {}): FtsHit {
  return { ...vectorHit(id), score: 5, ...overrides };
}

describe('rrfMerge — RRF 融合', () => {
  it('只有向量命中时，bm25 为 null，按向量排名输出', () => {
    const v = [vectorHit('a', { distance: 0.1 }), vectorHit('b', { distance: 0.9 })];
    const merged = rrfMerge(v, []);
    expect(merged.map((c) => c.chunkId)).toEqual(['a', 'b']);
    expect(merged[0]?.vector).toBeCloseTo(0.9);
    expect(merged[0]?.bm25).toBeNull();
  });

  it('双路命中时 rrf 更高且保留两路分数', () => {
    const v = [vectorHit('a'), vectorHit('b')];
    const f = [ftsHit('a', { score: 5 }), ftsHit('c', { score: 3 })];
    const merged = rrfMerge(v, f);

    const a = merged.find((c) => c.chunkId === 'a');
    expect(a?.vector).toBe(0.5);
    expect(a?.bm25).toBe(5);

    const b = merged.find((c) => c.chunkId === 'b');
    expect(b?.bm25).toBeNull();

    // a 双路命中 → RRF 最高，排第一
    expect(merged[0]?.chunkId).toBe('a');
    expect(merged[0]?.rrf).toBeGreaterThan(merged.find((c) => c.chunkId === 'b')?.rrf ?? 0);
  });

  it('只在一路出现的块也能召回（混合覆盖语义改写与精确术语）', () => {
    const v = [vectorHit('semantic')]; // 仅向量命中（语义改写）
    const f = [ftsHit('keyword')]; // 仅 BM25 命中（精确术语）
    const merged = rrfMerge(v, f);
    expect(merged.map((c) => c.chunkId).sort()).toEqual(['keyword', 'semantic']);
  });
});
