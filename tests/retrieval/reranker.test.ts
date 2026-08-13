import { describe, expect, it } from 'vitest';
import { heuristicScore } from '../../src/retrieval/reranker.js';

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
