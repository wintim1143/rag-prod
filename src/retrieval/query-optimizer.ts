import type { ChatMessage, ChatProvider } from '../generation/types.js';

export interface QueryOptimizationOptions {
  rewrite: boolean;
  multiQuery: boolean;
  hyde: boolean;
}

export interface OptimizationFailure {
  strategy: 'rewrite' | 'multi-query' | 'hyde';
  message: string;
}

export interface QueryOptimizationResult {
  originalQuery: string;
  queries: string[];
  /** HyDE 文本作为向量检索变体；未启用时为空。 */
  hypothetical?: string;
  llmCalls: number;
  latencyMs: number;
  strategies: string[];
  failures: OptimizationFailure[];
}

export interface QueryOptimizer {
  optimize(
    query: string,
    options: QueryOptimizationOptions,
    history?: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<QueryOptimizationResult>;
}

/** 查询优化器：单个策略失败时保留已有 query，继续基础检索。 */
export class LlmQueryOptimizer implements QueryOptimizer {
  constructor(private readonly provider?: ChatProvider) {}

  async optimize(
    query: string,
    options: QueryOptimizationOptions,
    history: ChatMessage[] = [],
    signal?: AbortSignal,
  ): Promise<QueryOptimizationResult> {
    const started = performance.now();
    const queries = [query];
    let hypothetical: string | undefined;
    let llmCalls = 0;
    const strategies: string[] = [];
    const failures: OptimizationFailure[] = [];
    if (!this.provider) {
      return { originalQuery: query, queries, llmCalls, latencyMs: 0, strategies, failures };
    }
    const invoke = async (strategy: OptimizationFailure['strategy'], prompt: string): Promise<string | undefined> => {
      if (signal?.aborted) throw new DOMException('Operation aborted', 'AbortError');
      try {
        llmCalls += 1;
        return clean(await this.provider!.generate([{ role: 'user', content: prompt }], signal));
      } catch (error: unknown) {
        if (signal?.aborted) throw error;
        failures.push({ strategy, message: error instanceof Error ? error.message : '优化调用失败' });
        return undefined;
      }
    };
    if (options.rewrite) {
      const rewritten = await invoke('rewrite', `将下面的问题改写为适合知识库检索的一条完整查询，只输出查询文本：\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}\n问题：${query}`);
      if (rewritten) { queries[0] = rewritten; strategies.push('rewrite'); }
    }
    if (options.multiQuery) {
      const variantsText = await invoke('multi-query', `把下面的问题拆成最多 3 条互补的检索查询，每行一条，只输出查询：\n${queries[0]}`);
      const variants = variantsText?.split(/\r?\n/).map(clean).filter(Boolean).slice(0, 3) ?? [];
      for (const variant of variants) if (!queries.includes(variant)) queries.push(variant);
      if (variants.length) strategies.push('multi-query');
    }
    if (options.hyde) {
      hypothetical = await invoke('hyde', `为下面的问题写一段简短的假想资料，只输出资料正文：\n${queries[0]}`);
      if (hypothetical) strategies.push('hyde');
    }
    return { originalQuery: query, queries, hypothetical, llmCalls, latencyMs: performance.now() - started, strategies, failures };
  }
}

function clean(value: string): string {
  return value.replace(/^[-*\d.)\s]+/, '').trim().slice(0, 500);
}
