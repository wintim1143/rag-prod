import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { Config } from '../config/index.js';
import type { ChatMessage, ChatProvider } from './types.js';

/** provider 需要的最底层 LLM 接口（生产用 ChatOpenAI 适配，测试注入假实现）。 */
export interface ChatLlm {
  invoke(messages: ChatMessage[], signal?: AbortSignal): Promise<{ content: string }>;
  stream?(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<unknown>;
}

/** OpenAI 兼容 chat provider：把角色化消息交给底层 LLM，返回文本 content。 */
export class OpenAICompatibleChatProvider implements ChatProvider {
  constructor(private readonly llm: ChatLlm) {}

  async generate(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    const result = signal === undefined
      ? await this.llm.invoke(messages)
      : await this.llm.invoke(messages, signal);
    return result.content;
  }

  async chooseToolQuery(messages: ChatMessage[], signal?: AbortSignal): Promise<import('./types.js').ToolDecision> {
    const result = await this.llm.invoke([
      { role: 'system', content: '你是检索规划器。只输出 JSON：需要资料时 {"type":"search","query":"..."}，不需要时 {"type":"no_search"}。不要回答问题。' },
      ...messages,
    ], signal);
    const raw = result.content.trim().replace(/^```json\s*|```$/g, '').trim();
    try {
      const parsed = JSON.parse(raw) as { type?: string; query?: unknown };
      if (parsed.type === 'no_search') return { type: 'no_search' };
      if (parsed.type === 'search' && typeof parsed.query === 'string' && parsed.query.trim()) {
        return { type: 'search', query: parsed.query.trim().slice(0, 500) };
      }
    } catch {
      // 兼容旧的纯文本 planner 输出。
    }
    if (raw.toUpperCase() === 'NO_SEARCH' || !raw) return { type: 'no_search' };
    return { type: 'search', query: raw.slice(0, 500) };
  }

  stream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<string> {
    if (!this.llm.stream) {
      throw new Error('当前 ChatProvider 不支持流式输出');
    }
    return mapTextStream(this.llm.stream(messages, signal));
  }
}

export async function* mapTextStream(source: AsyncIterable<unknown>): AsyncIterable<string> {
  for await (const chunk of source) {
    const text = typeof chunk === 'string' ? chunk : contentToString(chunk);
    if (text) yield text;
  }
}

/** 把 LangChain 消息 content（string 或多段数组）规约为纯文本。 */
export function contentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && 'text' in part) {
          return String((part as { text: unknown }).text);
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** 把 ChatMessage[] 转成 LangChain BaseMessage[]（System/Human/AI）。 */
function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
        return new SystemMessage(m.content);
      case 'assistant':
        return new AIMessage(m.content);
      default:
        return new HumanMessage(m.content);
    }
  });
}

/** 从 config.llm 组装生产级 provider（baseUrl/apiKey/model 全部来自配置中心）。 */
export function createChatProvider(config: Config): ChatProvider {
  const llm = new ChatOpenAI({
    model: config.llm.model,
    apiKey: config.llm.apiKey,
    configuration: { baseURL: config.llm.baseUrl },
    maxRetries: 2,
  });
  const adapter: ChatLlm = {
    async invoke(messages: ChatMessage[], signal?: AbortSignal) {
      const result = await llm.invoke(toLangChainMessages(messages), { signal });
      return { content: contentToString(result.content) };
    },
    async *stream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<unknown> {
      const stream = await llm.stream(toLangChainMessages(messages), { signal });
      yield* stream;
    },
  };
  return new OpenAICompatibleChatProvider(adapter);
}
