import type { FastifyPluginAsync } from 'fastify';
import type { IngestService } from '../pipeline.js';

export interface IngestRoutesOptions {
  ingest: IngestService;
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
      const outcome = await opts.ingest.ingestPath(inputPath);
      return reply.code(200).send(outcome);
    },
  );
};
