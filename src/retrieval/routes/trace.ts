import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config/index.js';
import type { TraceService } from '../search.js';

export interface TraceRoutesOptions {
  trace: TraceService;
  config: Config;
}

/**
 * POST /trace —— 单 query 检索诊断：逐环节 trace + 失败分类（07）。
 * body: { query, n?, k?, expected? }；n/k 覆盖配置默认值（RETRIEVAL_N / RETRIEVAL_K），
 * expected 为诊断者提示的期望命中块 chunkId（让分类器给出精确的召回/排名判定）。
 *
 * 租户隔离强制：从 `X-Tenant` 请求头读取租户（缺省用 DEFAULT_TENANT），
 * 与 /search 一致——诊断结论基于该租户视图。
 */
export const buildTraceRoutes: FastifyPluginAsync<TraceRoutesOptions> = async (app, opts) => {
  app.post(
    '/trace',
    {
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1 },
            n: { type: 'integer', minimum: 1 },
            k: { type: 'integer', minimum: 1 },
            expected: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
      },
    },
    async (request, reply) => {
      const { query, n, k, expected } = request.body as {
        query: string;
        n?: number;
        k?: number;
        expected?: string[];
      };
      const header = request.headers['x-tenant'];
      const tenant = Array.isArray(header) ? (header[0] as string | undefined) : header;
      const response = await opts.trace.trace(query, {
        n,
        k,
        expected,
        filter: { tenant: tenant || opts.config.tenant.default },
      });
      return reply.code(200).send(response);
    },
  );
};
