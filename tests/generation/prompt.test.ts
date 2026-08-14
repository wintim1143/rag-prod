import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, formatChunks, parseCitations, rewriteQuery } from '../../src/generation/prompt.js';
import type { SearchResult } from '../../src/retrieval/types.js';

function chunk(id: string, text: string): SearchResult {
  return {
    chunkId: id,
    text,
    docId: 'doc1',
    title: 't',
    sectionPath: 's',
    sourcePath: 'x.md',
    scores: { vector: 1, bm25: null, rrf: 0.1, rerank: 0.9 },
  };
}

describe('generation/prompt — 引用标注与格式', () => {
  it('formatChunks 把来源块编号为 [1][2]…', () => {
    const out = formatChunks([chunk('c1', '第一个块'), chunk('c2', '第二个块')]);
    expect(out).toContain('[1] 第一个块');
    expect(out).toContain('[2] 第二个块');
  });

  it('parseCitations 提取 [n] 引用并去重、按序', () => {
    const answer = '答案是 [2] 说的，另见 [1] 与 [2]。';
    expect(parseCitations(answer, 5)).toEqual([1, 2]);
  });

  it('parseCitations 忽略编号超出来源数的引用', () => {
    const answer = '引用 [9] 不存在，[1] 存在。';
    expect(parseCitations(answer, 3)).toEqual([1]);
  });

  it('parseCitations 忽略无引用的回答', () => {
    expect(parseCitations('没有引用', 5)).toEqual([]);
  });

  it('buildSystemPrompt 要求依据给定资料作答并在未知时拒答', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('资料中没有');
  });
});

describe('generation/prompt — 对话 query 改写', () => {
  it('单轮对话直接用最后一条 user 消息', () => {
    const q = rewriteQuery([
      { role: 'user', content: 'Fastify 端口是多少？' },
      { role: 'assistant', content: '3000。' },
      { role: 'user', content: '再问一个：健康检查端点？' },
    ]);
    expect(q).toBe('再问一个：健康检查端点？');
  });

  it('最后一条 user 消息过短时，拼接上一轮 user 消息以反映上下文', () => {
    const q = rewriteQuery([
      { role: 'user', content: '介绍 Fastify' },
      { role: 'assistant', content: 'Fastify 是……' },
      { role: 'user', content: '那端口呢？' },
    ]);
    expect(q).toBe('介绍 Fastify 那端口呢？');
  });
});
