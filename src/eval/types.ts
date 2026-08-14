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

/** 单条样本在某一配置下的全量判分结果。 */
export interface SampleEval {
  sampleId: string;
  question: string;
  /** 检索到的来源块（供 trace）。 */
  retrievedSources: string[];
  results: MetricResult[];
}

/** 某一配置变体跑完评测集的聚合结果。 */
export interface VariantEval {
  /** 配置变体名（如 "baseline"、"k3"、"chunk400"）。 */
  variant: string;
  /** 各指标平均分（0-1）。 */
  averages: Record<MetricName, number>;
  /** 每条样本的明细。 */
  samples: SampleEval[];
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
