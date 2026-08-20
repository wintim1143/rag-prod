import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config/index.js';
import type { AnswerService } from '../service.js';
import type { ChatMessage, ChatStreamEvent } from '../types.js';

export interface ChatRoutesOptions {
  answer: AnswerService;
  config?: Config;
}

/** POST /chat —— 多轮对话：历史 + query 改写 + 引用回答。 */
export const buildChatRoutes: FastifyPluginAsync<ChatRoutesOptions> = async (app, opts) => {
  app.post(
    '/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['messages'],
          properties: {
            messages: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                  content: { type: 'string' },
                },
              },
            },
            k: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { messages, k } = request.body as { messages: ChatMessage[]; k?: number };
      const tenant = resolveTenant(request.headers['x-tenant'], opts.config?.tenant.default ?? 'default');
      // SSE 仅由 CHAT_STREAM 决定；不再额外要求 accept: text/event-stream（S2）
      if (!opts.answer.streamChat || opts.config?.chat.stream === false) {
        const result = await opts.answer.chat(messages, { k, tenant });
        return reply.code(200).send(result);
      }
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      const controller = new AbortController();
      request.raw.on('close', () => controller.abort());
      const send = (event: ChatStreamEvent) => {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      try {
        for await (const event of opts.answer.streamChat(messages, { k, tenant, signal: controller.signal })) {
          if (controller.signal.aborted) break;
          send(event);
        }
      } catch (error: unknown) {
        send({ type: 'error', code: 'PROVIDER_ERROR', message: '聊天服务暂时不可用' });
      } finally {
        reply.raw.end();
      }
      return reply;

    },
  );
};

function resolveTenant(header: string | string[] | undefined, fallback: string): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || fallback;
}
