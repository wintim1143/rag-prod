import type { SearchService } from '../retrieval/search.js';
import type { AnswerService } from '../generation/service.js';
import type { ChatProvider } from '../generation/types.js';
import { evaluateSample } from './metrics.js';
import type { EvalSample, EvalRunResult, MetricName, SampleEval, VariantEval } from './types.js';

export interface RunVariantOptions {
  name: string;
  /** 评测集。 */
  dataset: EvalSample[];
  search: SearchService;
  answer: AnswerService;
  /** LLM judge（判分 provider）。 */
  judge: ChatProvider;
  /** 检索 top-k（传入 answer.ask）。 */
  k?: number;
  /** 评测租户（默认 fallback），传给 answer.ask。 */
  tenant?: string;
}

/** 用一个配置变体跑整个评测集：检索 → 生成 → 四指标判分 → 聚合。 */
export async function runVariant(options: RunVariantOptions): Promise<VariantEval> {
  const samples: SampleEval[] = [];
  for (const sample of options.dataset) {
    const started = performance.now();
    const answerResult = await options.answer.ask(sample.question, {
      k: options.k,
      tenant: options.tenant,
    });
    const searchLatencyMs = performance.now() - started;
    const retrievedSources = answerResult.chunks.map((c) => c.sourcePath);
    const expected = sample.expectedSources;
    const hitSet = new Set<string>();
    let firstRank: number | null = null;
    for (let i = 0; i < retrievedSources.length; i += 1) {
      if (expected.includes(retrievedSources[i] as string)) {
        hitSet.add(retrievedSources[i] as string);
        if (firstRank === null) firstRank = i + 1;
      }
    }
    const optimizationLatencyMs = answerResult.stages.optimizationLatencyMs ?? 0;
    const results = await evaluateSample(
      {
        question: sample.question,
        answer: answerResult.answer,
        chunks: answerResult.chunks.map((c) => ({ sourcePath: c.sourcePath, text: c.text })),
        expectedSources: sample.expectedSources,
        gold: sample.gold,
      },
      options.judge,
    );
    samples.push({
      sampleId: sample.id,
      question: sample.question,
      retrievedSources,
      results,
      retrieval: {
        hits: hitSet.size,
        expected: expected.length,
        recallAtK: expected.length > 0 ? hitSet.size / expected.length : null,
        mrr: firstRank === null ? null : 1 / firstRank,
        queryCount: answerResult.stages.retrievalN > 0 ? 1 : 0,
        llmCalls: answerResult.stages.optimizationLlmCalls ?? 0,
        optimizationLatencyMs,
        searchLatencyMs,
      },
    });
  }

  const averages = {} as Record<MetricName, number>;
  const metricNames: MetricName[] = [
    'faithfulness',
    'answer_relevance',
    'context_precision',
    'context_recall',
  ];
  for (const metric of metricNames) {
    const values = samples.flatMap((s) =>
      s.results.filter((r) => r.metric === metric).map((r) => r.score),
    );
    averages[metric] = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  }

  const recalls = samples
    .map((s) => s.retrieval?.recallAtK)
    .filter((v): v is number => v !== null && v !== undefined);
  const mrr = samples
    .map((s) => s.retrieval?.mrr)
    .filter((v): v is number => v !== null && v !== undefined);
  const llmCalls = samples.map((s) => s.retrieval?.llmCalls ?? 0);
  const latencies = samples.map((s) => s.retrieval?.optimizationLatencyMs ?? 0);

  return {
    variant: options.name,
    averages,
    samples,
    retrieval: {
      meanRecallAtK: recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : 0,
      meanMrr: mrr.length ? mrr.reduce((a, b) => a + b, 0) / mrr.length : 0,
      meanLlmCalls: llmCalls.length ? llmCalls.reduce((a, b) => a + b, 0) / llmCalls.length : 0,
      meanOptimizationLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      emptyRate: samples.length ? samples.filter((s) => s.retrievedSources.length === 0).length / samples.length : 0,
    },
  };
}

export interface CompareOptions {
  /** 跌破阈值判定为回归：variant.score < baseline.score - threshold。 */
  threshold: number;
}

/** 对比配置变体与基线，找出跌破阈值的回归指标。 */
export function compareVariants(
  baseline: VariantEval,
  variants: VariantEval[],
  options: CompareOptions,
): EvalRunResult['regressions'] {
  const regressions: EvalRunResult['regressions'] = [];
  for (const variant of variants) {
    for (const metric of Object.keys(variant.averages) as MetricName[]) {
      const baselineScore = baseline.averages[metric] ?? 0;
      const variantScore = variant.averages[metric] ?? 0;
      if (variantScore < baselineScore - options.threshold) {
        regressions.push({
          variant: variant.variant,
          metric,
          baselineScore,
          variantScore,
          threshold: options.threshold,
        });
      }
    }
  }
  return regressions;
}
