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
}

/** 用一个配置变体跑整个评测集：检索 → 生成 → 四指标判分 → 聚合。 */
export async function runVariant(options: RunVariantOptions): Promise<VariantEval> {
  const samples: SampleEval[] = [];
  for (const sample of options.dataset) {
    const answerResult = await options.answer.ask(sample.question, { k: options.k });
    const retrievedSources = answerResult.chunks.map((c) => c.sourcePath);
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

  return { variant: options.name, averages, samples };
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
