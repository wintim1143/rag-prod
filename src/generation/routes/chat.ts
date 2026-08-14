import type { FastifyPluginAsync } from 'fastify';
import type { AnswerService } from '../service.js';
import type { ChatMessage } from '../types.js';

export interface ChatRoutesOptions {
  answer: AnswerService;
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
      const result = await opts.answer.chat(messages, { k });
      return reply.code(200).send(result);
    },
  );
};
