import { describe, expect, it, vi } from 'vitest';
import { compareVariants, runVariant } from '../../src/eval/runner.js';
import type { EvalSample } from '../../src/eval/types.js';
import type { AnswerService } from '../../src/generation/service.js';
import type { ChatProvider } from '../../src/generation/types.js';

const sample: EvalSample = { id: 's1', question: '向量库是什么？', expectedSources: ['data/sample/intro.md'] };

function stubSearch() {
  return {
    search: vi.fn().mockResolvedValue({
      query: 'q',
      results: [{ chunkId: 'c0', text: 'LanceDB', docId: 'd0', title: 't', sectionPath: 's', sourcePath: 'data/sample/intro.md', scores: { vector: 1, bm25: null, rrf: 0.2, rerank: 0.9 } }],
      stages: { retrievalN: 50, topK: 5, reranker: 'cross-encoder' },
    }),
  };
}

function stubAnswer(): AnswerService {
  return {
    ask: vi.fn().mockResolvedValue({
      query: 'q', answer: 'LanceDB。', citations: [],
      chunks: [{ chunkId: 'c0', text: 'LanceDB', docId: 'd0', title: 't', sectionPath: 's', sourcePath: 'data/sample/intro.md', scores: { vector: 1, bm25: null, rrf: 0.2, rerank: 0.9 } }],
      stages: { retrievalN: 50, topK: 5, reranker: 'cross-encoder' },
    }),
    chat: vi.fn(),
  };
}

function stubJudge(score = 0.9): ChatProvider {
  return { generate: vi.fn(async () => String(score)) };
}

describe('eval 冒烟子集（CI）', () => {
  it('冒烟子集：单样本 + 桩 LLM 跑完 runVariant 与 compareVariants 不抛错', async () => {
    const baseline = await runVariant({
      name: 'baseline',
      dataset: [sample],
      search: stubSearch(),
      answer: stubAnswer(),
      judge: stubJudge(),
      k: 3,
    });
    const variant = await runVariant({
      name: 'k1',
      dataset: [sample],
      search: stubSearch(),
      answer: stubAnswer(),
      judge: stubJudge(0.5),
      k: 1,
    });
    const regressions = compareVariants(baseline, [variant], { threshold: 0.3 });
    // baseline 全 0.9，variant 全 0.5 → context_recall 跌 0.4 > 0.3
    expect(regressions.some((r) => r.variant === 'k1' && r.metric === 'context_recall')).toBe(true);
    expect(baseline.samples).toHaveLength(1);
    expect(variant.averages.faithfulness).toBeCloseTo(0.5);
  });
});
