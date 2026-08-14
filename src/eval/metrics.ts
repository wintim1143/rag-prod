import type { ChatMessage, ChatProvider } from '../generation/types.js';
import type { MetricName, MetricResult } from './types.js';

/** 单条判分的输入（retrieved 块 + 答案 + 标准）。 */
export interface MetricInput {
  metric: MetricName;
  question: string;
  answer: string;
  /** 检索到的来源块（用于 context precision/recall）。 */
  chunks: { sourcePath: string; text?: string }[];
  /** 标准相关源（context recall 判定用）。 */
  expectedSources?: string[];
  /** 参考答案要点（可选，供 faithfulness/relevance 参考）。 */
  gold?: string;
}

const METRIC_DEFS: Record<MetricName, string> = {
  faithfulness:
    '忠实度：回答中的每个断言是否都能由给定的检索上下文支撑，是否出现上下文里没有的信息（幻觉）。完全支撑给 1，有编造给低分。',
  answer_relevance:
    '答案相关性：回答是否直接、完整地回答了用户问题，而不是答非所问。高度相关给 1，偏题给低分。',
  context_precision:
    '上下文精度：检索到的上下文中，有多少块是真正与问题相关且有帮助的（相关块占比越高越好）。全相关给 1。',
  context_recall:
    '上下文召回：标准相关源中有多少被检索到了（命中越多越好）。全部命中给 1。',
};

/** 为指定指标构造 judge prompt。 */
export function buildMetricPrompts(input: MetricInput): { system: string; user: string } {
  const chunksText = input.chunks.length
    ? input.chunks.map((c, i) => `[${i + 1}] ${c.sourcePath}: ${c.text ?? '(无文本)'}`).join('\n')
    : '（无检索结果）';
  const expected = input.expectedSources?.length ? input.expectedSources.join('、') : '（无）';
  return {
    system:
      '你是 RAG 系统评估员。只输出一个 0 到 1 之间的小数作为分数（例如 0.85），不要输出任何其他内容。',
    user: [
      `指标：${METRIC_DEFS[input.metric]}`,
      `问题：${input.question}`,
      `回答：${input.answer || '（无回答）'}`,
      `检索上下文：\n${chunksText}`,
      `标准相关源：${expected}`,
      input.gold ? `参考答案要点：${input.gold}` : '',
      '请给出该指标的分数：',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/** 从 LLM 输出中解析 0-1 分数；解析失败返回 null（调用方降级处理）。 */
export function scoreFromText(text: string): number | null {
  const match = text.trim().match(/(0(?:\.\d+)?|1(?:\.0+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

/** 用 LLM judge 给单个指标打分。 */
export async function scoreMetric(input: MetricInput, provider: ChatProvider): Promise<MetricResult> {
  const { system, user } = buildMetricPrompts(input);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const text = await provider.generate(messages);
  const score = scoreFromText(text);
  return {
    metric: input.metric,
    score: score ?? 0, // 解析失败视为 0 分（保守）
    explanation: text.trim().slice(0, 300),
  };
}

/** 对单条样本跑全部四个指标。 */
export async function evaluateSample(
  input: Omit<MetricInput, 'metric'>,
  provider: ChatProvider,
): Promise<MetricResult[]> {
  const metrics: MetricName[] = ['faithfulness', 'answer_relevance', 'context_precision', 'context_recall'];
  const results = await Promise.all(
    metrics.map((metric) => scoreMetric({ ...input, metric }, provider)),
  );
  return results;
}
