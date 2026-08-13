import type { FastifyPluginAsync } from 'fastify';
import type { SearchService } from '../search.js';

export interface SearchRoutesOptions {
  search: SearchService;
}

/**
 * POST /search —— 混合检索 + 本地重排。
 * body: { query, n?, k? }；n/k 覆盖配置默认值（RETRIEVAL_N / RETRIEVAL_K）。
 */
export const buildSearchRoutes: FastifyPluginAsync<SearchRoutesOptions> = async (app, opts) => {
  app.post(
    '/search',
    {
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1 },
            n: { type: 'integer', minimum: 1 },
            k: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { query, n, k } = request.body as { query: string; n?: number; k?: number };
      const response = await opts.search.search(query, { n, k });
      return reply.code(200).send(response);
    },
  );
};
