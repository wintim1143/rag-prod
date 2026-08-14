import type { SearchResponse, SearchResult } from '../retrieval/types.js';

/** 对话消息（给 LLM 的角色化消息）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LLM 提供者抽象：输入角色化消息，返回回答文本（测试注入桩）。 */
export interface ChatProvider {
  generate(messages: ChatMessage[]): Promise<string>;
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
