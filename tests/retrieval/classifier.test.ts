import { describe, expect, it } from 'vitest';
import { classifyDiagnosis } from '../../src/retrieval/classifier.js';

/**
 * 失败分类器测试：覆盖 a–d 四类。每个用例都是「已知会错」的检索场景，
 * 期望分类在构造时即确定（ticket 07 acceptance 4）。
 */
describe('classifyDiagnosis — 检索失败分类器', () => {
  it('a: 知识库为空 → 库中本无此内容', () => {
    const d = classifyDiagnosis({
      totalChunks: 0,
      vectorHitCount: 0,
      bm25HitCount: 0,
      candidateCount: 0,
      topK: 5,
      queryTokensInCorpus: false,
    });
    expect(d.category).toBe('a');
    expect(d.evidence.length).toBeGreaterThan(0);
  });

  it('a: 无命中且 query 词在库中不存在 → 库中本无此内容', () => {
    const d = classifyDiagnosis({
      totalChunks: 12,
      vectorHitCount: 0,
      bm25HitCount: 0,
      candidateCount: 0,
      topK: 5,
      queryTokensInCorpus: false,
    });
    expect(d.category).toBe('a');
  });

  it('b: 无命中但 query 词在库中存在 → 有内容但没召回（表达不匹配）', () => {
    const d = classifyDiagnosis({
      totalChunks: 12,
      vectorHitCount: 0,
      bm25HitCount: 0,
      candidateCount: 0,
      topK: 5,
      queryTokensInCorpus: true,
    });
    expect(d.category).toBe('b');
    expect(d.evidence.some((e) => e.includes('不匹配'))).toBe(true);
  });

  it('b: 期望块未出现在任何候选中 → 没召回', () => {
    const d = classifyDiagnosis({
      totalChunks: 12,
      vectorHitCount: 3,
      bm25HitCount: 2,
      candidateCount: 4,
      topK: 3,
      queryTokensInCorpus: true,
      expected: ['chunk-9'],
      candidateIds: ['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4'],
    });
    expect(d.category).toBe('b');
  });

  it('c: 期望块在候选但排名超过 top-k → 召回了但排太后', () => {
    const d = classifyDiagnosis({
      totalChunks: 12,
      vectorHitCount: 5,
      bm25HitCount: 5,
      candidateCount: 5,
      topK: 3,
      queryTokensInCorpus: true,
      expected: ['chunk-4'],
      candidateIds: ['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4', 'chunk-5'],
    });
    expect(d.category).toBe('c');
    expect(d.evidence.some((e) => e.includes('top-3'))).toBe(true);
  });

  it('d: 期望块均在 top-k 内 → 检索正常（答案错属生成层）', () => {
    const d = classifyDiagnosis({
      totalChunks: 12,
      vectorHitCount: 5,
      bm25HitCount: 5,
      candidateCount: 5,
      topK: 3,
      queryTokensInCorpus: true,
      expected: ['chunk-2'],
      candidateIds: ['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4', 'chunk-5'],
    });
    expect(d.category).toBe('d');
  });

  it('c: 无 expected 时，第 k+1 名 rerank 分高于 top-k 内最低分 → 可能漏排', () => {
    const d = classifyDiagnosis({
      totalChunks: 12,
      vectorHitCount: 6,
      bm25HitCount: 6,
      candidateCount: 6,
      topK: 3,
      queryTokensInCorpus: true,
      topKMinRerankScore: 0.21,
      nextRerankScore: 0.55,
    });
    expect(d.category).toBe('c');
  });

  it('b: 无 expected 时两路命中严重不一致（向量 0 / BM25 5）→ 表达不匹配', () => {
    const d = classifyDiagnosis({
      totalChunks: 12,
      vectorHitCount: 0,
      bm25HitCount: 5,
      candidateCount: 5,
      topK: 3,
      queryTokensInCorpus: true,
    });
    expect(d.category).toBe('b');
    expect(d.evidence.some((e) => e.includes('向量') && e.includes('BM25'))).toBe(true);
  });

  it('d: 无 expected 且各环节健康 → 检索正常', () => {
    const d = classifyDiagnosis({
      totalChunks: 12,
      vectorHitCount: 6,
      bm25HitCount: 6,
      candidateCount: 6,
      topK: 3,
      queryTokensInCorpus: true,
      topKMinRerankScore: 0.6,
      nextRerankScore: 0.1,
    });
    expect(d.category).toBe('d');
  });
});
