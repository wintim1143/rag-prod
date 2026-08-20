import type { FastifyPluginAsync } from 'fastify';
import type { IngestService } from '../pipeline.js';

export interface IngestRoutesOptions {
  ingest: IngestService;
  config?: import('../../config/index.js').Config;
}

/** 与知识库路由保持一致的租户解析（缺省回落默认租户）。 */
function resolveTenant(header: string | string[] | undefined, fallback: string): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || fallback;
}

/**
 * POST /ingest —— 摄入单文件或目录。
 * body: { path: string }；返回 { ingested: [{docId, sourcePath, chunkCount}], failed: [...] }。
 */
export const buildIngestRoutes: FastifyPluginAsync<IngestRoutesOptions> = async (app, opts) => {
  app.post(
    '/ingest',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { path: inputPath } = request.body as { path: string };
      const tenant = resolveTenant(request.headers['x-tenant'], opts.config?.tenant.default ?? 'default');
      const outcome = await opts.ingest.ingestPath(inputPath, tenant);
      return reply.code(200).send(outcome);
    },
  );
};
