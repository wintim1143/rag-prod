import { describe, expect, it } from 'vitest';
import { heuristicScore, LocalReranker } from '../../src/retrieval/reranker.js';
import type { SearchCandidate } from '../../src/retrieval/types.js';

function candidate(chunkId: string, text: string, rrf = 0.01): SearchCandidate {
  return {
    chunkId,
    text,
    docId: 'doc',
    title: 't',
    sourcePath: 's.md',
    sectionPath: '',
    vector: null,
    bm25: null,
    rrf,
    rerank: null,
  };
}

describe('heuristicScore（重排兜底）', () => {
  it('词重叠越多相关分越高', () => {
    const query = '检索增强生成 RAG';
    const related = heuristicScore(query, '关于 RAG 检索增强生成的技术介绍', 0.01);
    const unrelated = heuristicScore(query, '今天天气很好适合散步', 0.01);
    expect(related).toBeGreaterThan(unrelated);
  });

  it('query 无可用词时回落到 RRF 分数', () => {
    expect(heuristicScore('!!!!', '任何文本', 0.42)).toBe(0.42);
  });
});

describe('LocalReranker — 失败降级', () => {
  it('模型加载失败时降级到启发式兜底，且后续请求持续带 reason', async () => {
    // 本地不存在的模型路径 → from_pretrained 快速失败（无网络依赖）
    const reranker = new LocalReranker('./__missing__/model');
    const candidates = [
      candidate('a', '关于 RAG 检索增强生成的技术介绍'),
      candidate('b', '今天天气很好适合散步'),
    ];

    const first = await reranker.rerank('检索增强', candidates);
    expect(first.status).toBe('fallback');
    expect(first.reason).toBeDefined();
    // 启发式按词重叠精排：包含 query 词的块排前
    expect(first.candidates[0]?.chunkId).toBe('a');

    // 第二次调用（state 已 failed）仍带 reason，而非丢失
    const again = await reranker.rerank('检索', candidates);
    expect(again.status).toBe('fallback');
    expect(again.reason).toBeDefined();
  });
});
