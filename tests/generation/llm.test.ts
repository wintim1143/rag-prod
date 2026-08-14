import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { contentToString, createChatProvider, OpenAICompatibleChatProvider } from '../../src/generation/llm.js';
import type { ChatMessage } from '../../src/generation/types.js';
import { validEnv } from '../helpers.js';

/** 注入式底层 LLM：仅实现 generate 需要的方法，测试不触网。 */
function fakeLlm(respond: (messages: ChatMessage[]) => string) {
  return {
    invoke: vi.fn().mockImplementation(async (messages: ChatMessage[]) => ({
      content: respond(messages as ChatMessage[]),
    })),
  };
}

describe('generation/llm — OpenAI 兼容 chat provider', () => {
  it('createChatProvider 从 config.llm 构造（不联网）', () => {
    const config = loadConfig({ env: validEnv() });
    const provider = createChatProvider(config);
    expect(provider).toBeInstanceOf(OpenAICompatibleChatProvider);
  });

  it('generate 透传消息并返回文本 content', async () => {
    const llm = fakeLlm((messages) => {
      const last = messages[messages.length - 1] as ChatMessage;
      return `回答:${last.content.slice(0, 4)}`;
    });
    const provider = new OpenAICompatibleChatProvider(llm);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '你好' },
    ];
    const out = await provider.generate(messages);
    expect(out).toBe('回答:你好');
    expect(llm.invoke).toHaveBeenCalledWith(messages);
  });

  it('content 非字符串（多段）时拼接文本', () => {
    expect(contentToString('纯文本')).toBe('纯文本');
    expect(contentToString([{ text: '段一' }, { text: '段二' }])).toBe('段一段二');
    expect(contentToString([{ text: 'a' }, 'b'])).toBe('ab');
    expect(contentToString(null)).toBe('');
  });
});
