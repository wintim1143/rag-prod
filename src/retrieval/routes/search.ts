import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config/index.js';
import type { SearchService } from '../search.js';

export interface SearchRoutesOptions {
  search: SearchService;
  config: Config;
}

/**
 * POST /search —— 混合检索 + 本地重排。
 * body: { query, n?, k? }；n/k 覆盖配置默认值（RETRIEVAL_N / RETRIEVAL_K）。
 *
 * 租户隔离强制：从 `X-Tenant` 请求头读取租户（缺省用 DEFAULT_TENANT），
 * 并强制作为检索过滤条件下推——调用方无法发起不带租户范围的跨租户检索。
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
      // 强制 tenant 范围：读 X-Tenant 头（取首个），缺省配置默认租户
      const header = request.headers['x-tenant'];
      const tenant = Array.isArray(header) ? (header[0] as string | undefined) : header;
      const response = await opts.search.search(query, {
        n,
        k,
        filter: { tenant: tenant || opts.config.tenant.default },
      });
      return reply.code(200).send(response);
    },
  );
};
