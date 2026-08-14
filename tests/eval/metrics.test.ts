import { describe, expect, it, vi } from 'vitest';
import { EVAL_DATASET } from '../../src/eval/dataset.js';
import { buildMetricPrompts, scoreFromText } from '../../src/eval/metrics.js';
import type { MetricName } from '../../src/eval/types.js';
import type { ChatMessage } from '../../src/generation/types.js';

/** 桩 LLM：返回固定分数文本。 */
function stubProvider(score: string) {
  return {
    generate: vi.fn(async (_messages: ChatMessage[]) => score),
  };
}

describe('eval/dataset — 评测集', () => {
  it('评测集 ≥ 30 条，字段完整', () => {
    expect(EVAL_DATASET.length).toBeGreaterThanOrEqual(30);
    for (const s of EVAL_DATASET) {
      expect(s.id).toBeTruthy();
      expect(s.question).toBeTruthy();
      expect(Array.isArray(s.expectedSources)).toBe(true);
    }
  });

  it('包含库外问题（expectedSources 为空，用于判 relevance/拒答）', () => {
    expect(EVAL_DATASET.some((s) => s.expectedSources.length === 0)).toBe(true);
  });
});

describe('eval/metrics — LLM 判分', () => {
  it('scoreFromText 解析 LLM 返回的 0-1 分数', () => {
    expect(scoreFromText('0.8')).toBe(0.8);
    expect(scoreFromText('答案分数：0.65')).toBe(0.65);
    expect(scoreFromText('1')).toBe(1);
    expect(scoreFromText('无分数')).toBeNull();
  });

  it('buildMetricPrompts 为四个指标生成带约束的 judge prompt', () => {
    const prompts = buildMetricPrompts({
      metric: 'faithfulness',
      question: 'q',
      answer: 'a',
      chunks: [{ sourcePath: 'x.md' } as never],
    });
    expect(prompts.system).toContain('0 到 1');
    expect(prompts.user).toContain('q');
    expect(prompts.user).toContain('x.md');
  });

  it('四个指标都有独立 prompt', () => {
    const metrics: MetricName[] = ['faithfulness', 'answer_relevance', 'context_precision', 'context_recall'];
    for (const metric of metrics) {
      const p = buildMetricPrompts({ metric, question: 'q', answer: 'a', chunks: [] });
      expect(p.user.length).toBeGreaterThan(10);
    }
  });

  it('桩 provider 返回 0-1 分数', async () => {
    const provider = stubProvider('0.9');
    const [score] = await Promise.all([provider.generate([{ role: 'user', content: 'x' }])]);
    expect(score).toBe('0.9');
    expect(provider.generate).toHaveBeenCalled();
  });
});
