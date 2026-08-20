/** 评测集与判分的类型定义。 */

/** 一条评测样本：问题 + 标准相关源（供 context precision/recall 判分）。 */
export interface EvalSample {
  id: string;
  question: string;
  /** 标准相关源文件（相对项目根路径），用于判定检索是否命中相关块。 */
  expectedSources: string[];
  /** 参考答案要点（可选，供 faithfulness/relevance 判分参考）。 */
  gold?: string;
}

/** 四个判分指标名称。 */
export type MetricName =
  | 'faithfulness'
  | 'answer_relevance'
  | 'context_precision'
  | 'context_recall';

/** 单个指标判分结果（0-1 分 + 依据）。 */
export interface MetricResult {
  metric: MetricName;
  /** 0-1 分。 */
  score: number;
  /** LLM judge 给出的理由/依据。 */
  explanation: string;
}

/** 单条样本的检索与成本统计（08 查询优化的成本/召回对比）。 */
export interface RetrievalStats {
  /** 命中期望源的数量（对 expectedSources 求交集）。 */
  hits: number;
  /** 期望源总数。 */
  expected: number;
  /** hit/expected（无期望源时为 null）。 */
  recallAtK: number | null;
  /** 首个期望源的最小 rank（1 起；未命中为 null）。 */
  mrr: number | null;
  /** 检索实际执行的 query 数（含多查询/HyDE 变体）。 */
  queryCount: number;
  /** 查询优化产生的 LLM 调用次数。 */
  llmCalls: number;
  /** 查询优化耗时（ms）。 */
  optimizationLatencyMs: number;
  /** 检索总耗时（ms，可空）。 */
  searchLatencyMs: number | null;
}

/** 单条样本在某一配置下的全量判分结果。 */
export interface SampleEval {
  sampleId: string;
  question: string;
  /** 检索到的来源块（供 trace）。 */
  retrievedSources: string[];
  results: MetricResult[];
  /** 检索与成本统计（08 查询优化）。 */
  retrieval?: RetrievalStats;
}

/** 某一配置变体跑完评测集的聚合结果。 */
export interface VariantEval {
  /** 配置变体名（如 "baseline"、"k3"、"chunk400"）。 */
  variant: string;
  /** 各指标平均分（0-1）。 */
  averages: Record<MetricName, number>;
  /** 每条样本的明细。 */
  samples: SampleEval[];
  /** 检索与成本聚合（08 查询优化）。 */
  retrieval?: {
    meanRecallAtK: number;
    meanMrr: number;
    meanLlmCalls: number;
    meanOptimizationLatencyMs: number;
    emptyRate: number;
  };
}

/** 回归判定：变体对基线某个指标跌破阈值。 */
export interface Regression {
  variant: string;
  metric: MetricName;
  baselineScore: number;
  variantScore: number;
  /** 跌破的阈值（score < baseline - threshold 即回归）。 */
  threshold: number;
}

/** 回归运行结果。 */
export interface EvalRunResult {
  baseline: VariantEval;
  variants: VariantEval[];
  regressions: Regression[];
}
