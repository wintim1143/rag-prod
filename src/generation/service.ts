import type { SearchService } from '../retrieval/search.js';
import type { SearchResponse, SearchResult } from '../retrieval/types.js';
import { buildSystemPrompt, formatChunks, parseCitations, rewriteQuery } from './prompt.js';
import type { AnswerResult, ChatMessage, ChatProvider, Citation } from './types.js';

/** 检索无结果时给用户的拒答文案。 */
export const NO_MATERIAL_ANSWER = '资料中没有相关内容。';

export interface AnswerService {
  /** 单轮问答：query → 检索 → 生成带引用回答。 */
  ask(query: string, options?: { k?: number }): Promise<AnswerResult>;
  /** 多轮对话：从历史改写检索 query，保留上下文透传给 LLM。 */
  chat(messages: ChatMessage[], options?: { k?: number }): Promise<AnswerResult>;
}

/** 问答编排：检索 + prompt 组装 + LLM 生成 + 引用解析。 */
export class AnswerPipeline implements AnswerService {
  constructor(
    private readonly search: SearchService,
    private readonly provider: ChatProvider,
  ) {}

  async ask(query: string, options: { k?: number } = {}): Promise<AnswerResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('query 不能为空');
    }
    const resp = await this.search.search(trimmed, { k: options.k });
    if (resp.results.length === 0) {
      return this.noMaterial(resp);
    }
    return this.generate(resp, [], this.buildUserPrompt(trimmed, resp.results));
  }

  async chat(messages: ChatMessage[], options: { k?: number } = {}): Promise<AnswerResult> {
    const query = rewriteQuery(messages);
    if (!query) {
      throw new Error('历史中没有 user 消息');
    }
    const resp = await this.search.search(query, { k: options.k });
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
  ): Promise<AnswerResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: userPrompt },
    ];
    return this.provider.generate(messages).then((answer) => ({
      query: resp.query,
      answer,
      citations: this.mapCitations(answer, resp.results),
      chunks: resp.results,
      stages: resp.stages,
    }));
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
