import type { SearchService } from '../retrieval/search.js';
import type { Config } from '../config/index.js';
import type { SearchResponse, SearchResult } from '../retrieval/types.js';
import type { ChunkFilter } from '../ingestion/store/lancedb.js';
import { buildSystemPrompt, formatChunks, parseCitations, rewriteQuery } from './prompt.js';
import type { AnswerResult, ChatMessage, ChatProvider, Citation, ChatStreamEvent } from './types.js';

/** 检索无结果时给用户的拒答文案。 */
export const NO_MATERIAL_ANSWER = '资料中没有相关内容。';

export interface AnswerService {
  /** 单轮问答：query → 检索 → 生成带引用回答。 */
  ask(query: string, options?: { k?: number; tenant?: string }): Promise<AnswerResult>;
  chat(messages: ChatMessage[], options?: { k?: number; tenant?: string }): Promise<AnswerResult>;
  streamChat?(
    messages: ChatMessage[],
    options?: { k?: number; tenant?: string; signal?: AbortSignal },
  ): AsyncIterable<ChatStreamEvent>;
}

/** 问答编排：检索 + prompt 组装 + LLM 生成 + 引用解析。 */
export class AnswerPipeline implements AnswerService {
  constructor(
    private readonly search: SearchService,
    private readonly provider: ChatProvider,
    private readonly config?: Config,
  ) {}

  async ask(query: string, options: { k?: number; tenant?: string } = {}): Promise<AnswerResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('query 不能为空');
    }
    const resp = await this.search.search(trimmed, { k: options.k, filter: options.tenant ? { tenant: options.tenant } : undefined });
    if (resp.results.length === 0) {
      return this.noMaterial(resp);
    }
    return this.generate(resp, [], this.buildUserPrompt(trimmed, resp.results));
  }

  async *streamChat(
    messages: ChatMessage[],
    options: { k?: number; tenant?: string; signal?: AbortSignal } = {},
  ): AsyncIterable<ChatStreamEvent> {
    const query = rewriteQuery(messages);
    if (!query) throw new Error('历史中没有 user 消息');
    const filter = options.tenant ? { tenant: options.tenant } : undefined;
    const agentic = this.config?.chat.mode === 'agentic' && !!this.provider.chooseToolQuery;
    if (!agentic) {
      yield* this.fixedStream(messages, { ...options, filter }, query);
      return;
    }
    yield* this.agenticStream(messages, { ...options, filter }, query);
  }

  /** fixed 模式：改写 query → 检索一次 → 生成（历史透传，保留 04 语义）。 */
  private async *fixedStream(
    messages: ChatMessage[],
    options: { k?: number; signal?: AbortSignal; filter?: ChunkFilter },
    query: string,
  ): AsyncIterable<ChatStreamEvent> {
    const resp = await this.search.search(query, { k: options.k, filter: options.filter, signal: options.signal });
    if (resp.results.length === 0) {
      const result = this.noMaterial(resp);
      yield { type: 'done', result };
      return;
    }
    const promptMessages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...messages.slice(0, -1),
      { role: 'user', content: this.buildUserPrompt(query, resp.results) },
    ];
    if (!this.provider.stream) {
      const result = await this.generate(resp, messages.slice(0, -1), this.buildUserPrompt(query, resp.results), options.signal);
      // 非流式 provider 分支也先发 sources，保持 SSE 契约一致（S5）
      yield { type: 'sources', chunks: resp.results };
      yield { type: 'text_delta', text: result.answer };
      yield { type: 'done', result };
      return;
    }
    let answer = '';
    for await (const text of this.provider.stream(promptMessages, options.signal)) {
      answer += text;
      yield { type: 'text_delta', text };
    }
    const result = this.toResult(resp, answer);
    yield { type: 'sources', chunks: resp.results };
    yield { type: 'done', result };
  }

  /** agentic 模式：planner → 工具 → 结果回填 → 再决策，受 maxSteps/timeout 限制。 */
  private async *agenticStream(
    messages: ChatMessage[],
    options: { k?: number; signal?: AbortSignal; filter?: ChunkFilter },
    query: string,
  ): AsyncIterable<ChatStreamEvent> {
    const maxSteps = this.config?.chat.maxSteps ?? 3;
    const timeoutMs = this.config?.chat.timeoutMs ?? 30000;
    const merged = mergeSignals(options.signal, timeoutMs);
    const history = messages.slice(0, -1);
    const consulted: SearchResult[] = [];
    let lastResp: SearchResponse | null = null;
    try {
      let working = [...messages];
      for (let step = 1; step <= maxSteps; step += 1) {
        throwIfAborted(merged.signal);
        const decision = await this.provider.chooseToolQuery!(working, merged.signal);
        if (decision.type === 'no_search') break;
        yield { type: 'tool_start', step, query: decision.query };
        const resp = await this.search.search(decision.query, { k: options.k, filter: options.filter, signal: merged.signal });
        lastResp = resp;
        consulted.push(...resp.results);
        yield { type: 'tool_result', step, query: decision.query, resultCount: resp.results.length };
        working = [
          ...working,
          { role: 'user', content: `检索工具已返回 ${resp.results.length} 条资料。若已有足够资料请直接回答；若不足请继续检索，或回答「检索完成」。` },
        ];
      }
      const plan = this.collectPlan(lastResp, consulted, query);
      if (plan.results.length === 0) {
        const result = this.noMaterial(plan.resp);
        yield { type: 'done', result };
        return;
      }
      if (!this.provider.stream) {
        // 非流式 provider：仍先发 sources 事件，保持 SSE 契约一致（S5）
        const result = await this.generate(plan.resp, history, this.buildUserPrompt(query, plan.results), merged.signal);
        yield { type: 'sources', chunks: plan.results };
        yield { type: 'text_delta', text: result.answer };
        yield { type: 'done', result };
        return;
      }
      const promptMessages: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt() },
        ...history,
        { role: 'user', content: this.buildUserPrompt(query, plan.results) },
      ];
      let answer = '';
      for await (const text of this.provider.stream(promptMessages, merged.signal)) {
        answer += text;
        yield { type: 'text_delta', text };
      }
      const result = this.toResult(plan.resp, answer);
      yield { type: 'sources', chunks: plan.results };
      yield { type: 'done', result };
    } finally {
      merged.cleanup();
    }
  }

  /**
   * 去重合并 agentic 检索到的块，并构建最终 SearchResponse。
   * 关键：最终问题用用户的（改写后）query，而非 planner 生成的检索子查询（W4）。
   */
  private collectPlan(lastResp: SearchResponse | null, consulted: SearchResult[], query: string): {
    resp: SearchResponse;
    results: SearchResult[];
  } {
    const seen = new Set<string>();
    const results = consulted.filter((r) => (seen.has(r.chunkId) ? false : (seen.add(r.chunkId), true)));
    const resp: SearchResponse = {
      ...(lastResp ?? emptyResponse(query)),
      query,
      results,
    };
    return { resp, results };
  }

  /** 运行 agentic planner（非流式）：循环检索直到 no_search 或达步数上限，返回去重结果与最终响应。供 chat() 复用（S1）。 */
  private async planAgentic(
    messages: ChatMessage[],
    options: { k?: number; signal?: AbortSignal; filter?: ChunkFilter },
    query: string,
  ): Promise<{ resp: SearchResponse; results: SearchResult[] }> {
    const maxSteps = this.config?.chat.maxSteps ?? 3;
    const timeoutMs = this.config?.chat.timeoutMs ?? 30000;
    const merged = mergeSignals(options.signal, timeoutMs);
    const consulted: SearchResult[] = [];
    let lastResp: SearchResponse | null = null;
    try {
      let working = [...messages];
      for (let step = 1; step <= maxSteps; step += 1) {
        throwIfAborted(merged.signal);
        const decision = await this.provider.chooseToolQuery!(working, merged.signal);
        if (decision.type === 'no_search') break;
        const resp = await this.search.search(decision.query, { k: options.k, filter: options.filter, signal: merged.signal });
        lastResp = resp;
        consulted.push(...resp.results);
        working = [
          ...working,
          { role: 'user', content: `检索工具已返回 ${resp.results.length} 条资料。若已有足够资料请直接回答；若不足请继续检索，或回答「检索完成」。` },
        ];
      }
      return this.collectPlan(lastResp, consulted, query);
    } finally {
      merged.cleanup();
    }
  }

  async chat(messages: ChatMessage[], options: { k?: number; tenant?: string } = {}): Promise<AnswerResult> {
    const query = rewriteQuery(messages);
    if (!query) {
      throw new Error('历史中没有 user 消息');
    }
    const filter = options.tenant ? { tenant: options.tenant } : undefined;
    // agentic 模式在非流式 JSON 回退下也走 planner，收集资料后汇聚为单条回答（S1）
    const agentic = this.config?.chat.mode === 'agentic' && !!this.provider.chooseToolQuery;
    if (agentic) {
      const plan = await this.planAgentic(messages, { ...options, filter }, query);
      if (plan.results.length === 0) {
        return this.noMaterial(plan.resp);
      }
      const history = messages.slice(0, -1);
      return this.generate(plan.resp, history, this.buildUserPrompt(query, plan.results));
    }
    const resp = await this.search.search(query, { k: options.k, filter });
    if (resp.results.length === 0) {
      return this.noMaterial(resp);
    }
    // 历史透传给 LLM 保持多轮上下文；最后一条 user 消息由改写 query 代表，不再重复传原始文本
    const history = messages.slice(0, -1);
    return this.generate(resp, history, this.buildUserPrompt(query, resp.results));
  }

  /** 组装最终发给 LLM 的消息序列：system + 历史 + user（含编号资料）。 */
  private generate(
    resp: SearchResponse,
    history: ChatMessage[],
    userPrompt: string,
    signal?: AbortSignal,
  ): Promise<AnswerResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: userPrompt },
    ];
    return this.provider.generate(messages, signal).then((answer) => this.toResult(resp, answer));
  }

  private toResult(resp: SearchResponse, answer: string): AnswerResult {
    return {
      query: resp.query,
      answer,
      citations: this.mapCitations(answer, resp.results),
      chunks: resp.results,
      stages: resp.stages,
    };
  }

  private buildUserPrompt(query: string, results: SearchResult[]): string {
    return `${formatChunks(results)}\n\n问题：${query}`;
  }

  private mapCitations(answer: string, results: SearchResult[]): Citation[] {
    return parseCitations(answer, results.length).map((index) => {
      const chunk = results[index - 1] as SearchResult;
      return {
        index,
        chunkId: chunk.chunkId,
        docId: chunk.docId,
        title: chunk.title,
        sourcePath: chunk.sourcePath,
        text: chunk.text,
      };
    });
  }

  private noMaterial(resp: SearchResponse): AnswerResult {
    return {
      query: resp.query,
      answer: NO_MATERIAL_ANSWER,
      citations: [],
      chunks: [],
      stages: resp.stages,
    };
  }
}

/** 合并外部 AbortSignal 与超时，返回合并信号与清理函数。 */
function mergeSignals(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(external?.reason);
  const timer = setTimeout(() => controller.abort(new DOMException('Agent 超时', 'TimeoutError')), timeoutMs);
  if (external?.aborted) {
    controller.abort(external.reason);
  } else {
    external?.addEventListener('abort', onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
      controller.abort();
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Operation aborted', 'AbortError');
}

function emptyResponse(query: string): SearchResponse {
  return { query, results: [], stages: { retrievalN: 0, topK: 0, queryCount: 0, reranker: 'fallback' } };
}
