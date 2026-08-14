import type { SearchResult } from '../retrieval/types.js';
import type { ChatMessage } from './types.js';

/** 来源块不足时的短消息（用于拼接上一轮 user 消息的阈值判断）。 */
const SHORT_QUERY_THRESHOLD = 8;

/** 把来源块格式化为带编号的引用文本（[1]、[2]…）。 */
export function formatChunks(chunks: SearchResult[]): string {
  return chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
}

/** 从回答中提取 [n] 引用编号：去重、升序、限制在来源数内。 */
export function parseCitations(answer: string, maxIndex: number): number[] {
  const re = /\[(\d{1,3})\]/g;
  const found = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    const n = Number(match[1]);
    if (n >= 1 && n <= maxIndex) {
      found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** 系统提示：要求模型只依据给定资料作答、带 [n] 引用、未知时明确拒答。 */
export function buildSystemPrompt(): string {
  return [
    '你是 rag-prod 知识库问答助手。请只依据用户消息中给定的资料回答，',
    '并在回答中标注来源，例如 [1]、[2]。',
    '如果资料中没有相关答案，请直接回复「资料中没有相关内容」，不要编造。',
  ].join('');
}

/**
 * 从多轮对话历史推导检索 query：
 * - 单轮：直接用最后一条 user 消息；
 * - 多轮且最后一条 user 消息过短（大概率是省略主语的追问）：拼接上一轮 user 消息，反映对话上下文。
 */
export function rewriteQuery(history: ChatMessage[]): string {
  const userMessages = history.filter((m) => m.role === 'user').map((m) => m.content);
  if (userMessages.length === 0) {
    return '';
  }
  const last = userMessages[userMessages.length - 1] as string;
  if (userMessages.length >= 2 && last.trim().length < SHORT_QUERY_THRESHOLD) {
    return `${userMessages[userMessages.length - 2] as string} ${last}`.trim();
  }
  return last;
}
