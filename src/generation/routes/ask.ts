import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config/index.js';
import type { AnswerService } from '../service.js';

export interface AnswerRoutesOptions {
  answer: AnswerService;
  config: Config;
}

/** POST /ask —— 单轮问答：检索上下文 + 引用回答。 */
export const buildAskRoutes: FastifyPluginAsync<AnswerRoutesOptions> = async (app, opts) => {
  app.post(
    '/ask',
    {
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1 },
            k: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { query, k } = request.body as { query: string; k?: number };
      const tenant = resolveTenant(request.headers['x-tenant'], opts.config.tenant.default);
      const result = await opts.answer.ask(query, { k, tenant });
      return reply.code(200).send(result);
    },
  );
};

function resolveTenant(header: string | string[] | undefined, fallback: string): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || fallback;
}
