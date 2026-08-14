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
  invoke(messages: ChatMessage[]): Promise<{ content: string }>;
}

/** OpenAI 兼容 chat provider：把角色化消息交给底层 LLM，返回文本 content。 */
export class OpenAICompatibleChatProvider implements ChatProvider {
  constructor(private readonly llm: ChatLlm) {}

  async generate(messages: ChatMessage[]): Promise<string> {
    const result = await this.llm.invoke(messages);
    return result.content;
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
    async invoke(messages: ChatMessage[]) {
      const result = await llm.invoke(toLangChainMessages(messages));
      return { content: contentToString(result.content) };
    },
  };
  return new OpenAICompatibleChatProvider(adapter);
}
