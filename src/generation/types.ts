import type { SearchResponse, SearchResult } from '../retrieval/types.js';

/** 对话消息（给 LLM 的角色化消息）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ToolDecision =
  | { type: 'search'; query: string }
  | { type: 'no_search' };

/** LLM 提供者抽象：输入角色化消息，返回回答文本（测试注入桩）。 */
export interface ChatProvider {
  generate(messages: ChatMessage[], signal?: AbortSignal): Promise<string>;
  stream?(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<string>;
  /** Agentic 模式的结构化检索决策。 */
  chooseToolQuery?(messages: ChatMessage[], signal?: AbortSignal): Promise<ToolDecision>;
}

/** 回答中的一条引用（[n] → 来源块）。 */
export interface Citation {
  /** 引用编号（1 起，对应 prompt 里的 [n]）。 */
  index: number;
  chunkId: string;
  docId: string;
  title: string;
  sourcePath: string;
  text: string;
}

/** 问答 / 聊天统一响应：回答 + 引用 + 所用块。 */
export interface AnswerResult {
  /** 实际用于检索的 query（/chat 为改写后的 query）。 */
  query: string;
  answer: string;
  citations: Citation[];
  /** 送入 prompt 的来源块（前端可溯源）。 */
  chunks: SearchResult[];
  stages: SearchResponse['stages'];
}

export type ChatStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; step: number; query: string }
  | { type: 'tool_result'; step: number; query: string; resultCount: number }
  | { type: 'sources'; chunks: SearchResult[] }
  | { type: 'done'; result: AnswerResult }
  | { type: 'error'; code: 'ABORTED' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'TOOL_ERROR'; message: string };
