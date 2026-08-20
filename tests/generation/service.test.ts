import { describe, expect, it, vi } from 'vitest';
import { AnswerPipeline } from '../../src/generation/service.js';
import type { ChatMessage } from '../../src/generation/types.js';
import type { SearchResponse, SearchResult } from '../../src/retrieval/types.js';

function result(id: string, text: string): SearchResult {
  return {
    chunkId: id,
    text,
    docId: 'doc1',
    title: 't',
    sectionPath: 's',
    sourcePath: 'x.md',
    scores: { vector: 1, bm25: null, rrf: 0.2, rerank: 0.9 },
  };
}

function searchResponse(results: SearchResult[], query = 'q'): SearchResponse {
  return {
    query,
    results,
    stages: { retrievalN: 50, topK: 5, reranker: 'cross-encoder' },
  };
}

/** 桩 search：记录 query，返回固定结果（query 回显传入值，模拟真实 SearchPipeline）。 */
function stubSearch(results: SearchResult[]) {
  return {
    search: vi.fn(async (_query: string, _opts?: unknown) => searchResponse(results, _query)),
  };
}

/** 桩 provider：记录收到的消息，返回固定回答。 */
function stubProvider(answer: string) {
  return {
    generate: vi.fn(async (_messages: ChatMessage[]) => answer),
  };
}

describe('AnswerPipeline — /ask 单轮问答', () => {
  it('检索 → 组装 prompt → LLM 生成 → 返回带引用的回答', async () => {
    const search = stubSearch([result('c1', '端口是 3000。'), result('c2', '健康检查是 /health。')]);
    const provider = stubProvider('端口是 [1]，健康检查在 [2]。');
    const answer = new AnswerPipeline(search, provider);

    const out = await answer.ask('Fastify 端口？', { k: 2 });
    expect(search.search).toHaveBeenCalledWith('Fastify 端口？', { k: 2 });
    expect(out.answer).toContain('[1]');
    expect(out.citations).toEqual([
      expect.objectContaining({ index: 1, chunkId: 'c1' }),
      expect.objectContaining({ index: 2, chunkId: 'c2' }),
    ]);
    // 引用块与结果一致
    expect(out.citations[0]?.text).toBe('端口是 3000。');
    expect(out.chunks.length).toBe(2);
  });

  it('检索无结果 → 拒答，不调用 LLM', async () => {
    const search = stubSearch([]);
    const provider = stubProvider('不应被调用');
    const answer = new AnswerPipeline(search, provider);

    const out = await answer.ask('库里没有的问题');
    expect(out.answer).toContain('资料中没有');
    expect(out.citations).toEqual([]);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('引用编号超出来源数时被丢弃', async () => {
    const search = stubSearch([result('c1', 'a')]);
    const provider = stubProvider('错误引用 [5]。');
    const answer = new AnswerPipeline(search, provider);

    const out = await answer.ask('q');
    expect(out.citations).toEqual([]);
    expect(out.answer).toContain('[5]');
  });
});

describe('AnswerPipeline — /chat 多轮对话', () => {
  it('改写最后一条 user 消息为检索 query，历史透传给 LLM', async () => {
    const search = stubSearch([result('c1', '端口是 3000。')]);
    const provider = stubProvider('3000 [1]');
    const answer = new AnswerPipeline(search, provider);

    const history: ChatMessage[] = [
      { role: 'user', content: '介绍 Fastify' },
      { role: 'assistant', content: 'Fastify 是……' },
      { role: 'user', content: '那端口呢？' },
    ];
    const out = await answer.chat(history);
    // query 被改写：拼接上一轮 user 消息
    expect(search.search.mock.calls[0]?.[0]).toContain('介绍 Fastify');
    expect(out.query).toContain('介绍 Fastify');
    // LLM 收到的消息包含 system + 历史 + 最终 user（含资料）
    const sent = provider.generate.mock.calls[0]?.[0] as ChatMessage[];
    expect(sent[0]?.role).toBe('system');
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(out.answer).toContain('[1]');
    expect(out.citations[0]?.chunkId).toBe('c1');
  });

  it('chat 检索无结果 → 拒答', async () => {
    const search = stubSearch([]);
    const provider = stubProvider('x');
    const answer = new AnswerPipeline(search, provider);

    const out = await answer.chat([{ role: 'user', content: '不存在的问题' }]);
    expect(out.answer).toContain('资料中没有');
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
