import { describe, expect, it, vi } from 'vitest';
import { compareVariants, runVariant } from '../../src/eval/runner.js';
import type { EvalSample } from '../../src/eval/types.js';
import type { AnswerService } from '../../src/generation/service.js';
import type { ChatProvider } from '../../src/generation/types.js';

/** 桩检索：返回固定块（命中 expectedSources 则标记 sourcePath）。 */
function stubSearch(retrieved: { sourcePath: string; text: string }[]) {
  return {
    search: vi.fn().mockResolvedValue({
      query: 'q',
      results: retrieved.map((r, i) => ({
        chunkId: `c${i}`,
        text: r.text,
        docId: `d${i}`,
        title: 't',
        sectionPath: 's',
        sourcePath: r.sourcePath,
        scores: { vector: 1, bm25: null, rrf: 0.2, rerank: 0.9 },
      })),
      stages: { retrievalN: 50, topK: 5, reranker: 'cross-encoder' },
    }),
  };
}

function stubAnswer(): AnswerService {
  return {
    ask: vi.fn().mockResolvedValue({
      query: 'q',
      answer: '根据资料回答。',
      citations: [],
      chunks: [],
      stages: { retrievalN: 50, topK: 5, reranker: 'cross-encoder' },
    }),
    chat: vi.fn(),
  };
}

/** 桩 judge：按指标返回不同分数，便于断言聚合与回归。 */
function stubJudge(scores: Record<string, number>) {
  const provider: ChatProvider = {
    generate: vi.fn(async (messages: import('../../src/generation/types.js').ChatMessage[]) => {
      const text = messages.map((m) => m.content).join(' ');
      if (text.includes('忠实度')) return String(scores.faithfulness ?? 0.8);
      if (text.includes('相关性：回答')) return String(scores.answer_relevance ?? 0.8);
      if (text.includes('上下文精度')) return String(scores.context_precision ?? 0.8);
      if (text.includes('上下文召回')) return String(scores.context_recall ?? 0.8);
      return '0.5';
    }),
  };
  return provider;
}

const sample: EvalSample = {
  id: 's1',
  question: '向量库是什么？',
  expectedSources: ['data/sample/intro.md'],
};

describe('eval/runner — 配置变体运行', () => {
  it('runVariant 对每条样本判分并聚合各指标平均分', async () => {
    const variant = await runVariant({
      name: 'baseline',
      dataset: [sample],
      search: stubSearch([{ sourcePath: 'data/sample/intro.md', text: 'LanceDB' }]),
      answer: stubAnswer(),
      judge: stubJudge({}),
    });
    expect(variant.averages.faithfulness).toBeCloseTo(0.8);
    expect(variant.averages.answer_relevance).toBeCloseTo(0.8);
    expect(variant.averages.context_precision).toBeCloseTo(0.8);
    expect(variant.averages.context_recall).toBeCloseTo(0.8);
    expect(variant.samples).toHaveLength(1);
    expect(variant.samples[0]?.sampleId).toBe('s1');
  });

  it('compareVariants 找出跌破阈值的回归指标', () => {
    const regressions = compareVariants(
      {
        variant: 'baseline',
        averages: {
          faithfulness: 0.8,
          answer_relevance: 0.8,
          context_precision: 0.8,
          context_recall: 0.8,
        },
        samples: [],
      },
      [
        {
          variant: 'k1',
          averages: {
            faithfulness: 0.8,
            answer_relevance: 0.8,
            context_precision: 0.8,
            context_recall: 0.4, // 跌破 0.2 阈值
          },
          samples: [],
        },
      ],
      { threshold: 0.2 },
    );
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({
      variant: 'k1',
      metric: 'context_recall',
      baselineScore: 0.8,
      variantScore: 0.4,
    });
  });

  it('compareVariants 不报未跌破阈值的变体为回归', () => {
    const regressions = compareVariants(
      {
        variant: 'baseline',
        averages: {
          faithfulness: 0.8,
          answer_relevance: 0.8,
          context_precision: 0.8,
          context_recall: 0.8,
        },
        samples: [],
      },
      [
        {
          variant: 'better',
          averages: {
            faithfulness: 0.85,
            answer_relevance: 0.8,
            context_precision: 0.8,
            context_recall: 0.8,
          },
          samples: [],
        },
      ],
      { threshold: 0.2 },
    );
    expect(regressions).toHaveLength(0);
  });
});
