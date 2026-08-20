import type { FastifyPluginAsync } from 'fastify';
import type { KnowledgeService } from '../service.js';

import type { Config } from '../../config/index.js';

export interface KnowledgeRoutesOptions {
  knowledge: KnowledgeService;
  config: Config;
}

/** 知识库管理 API：GET /documents、DELETE /documents/:docId、POST /documents/:docId/reindex。 */
export const buildKnowledgeRoutes: FastifyPluginAsync<KnowledgeRoutesOptions> = async (app, opts) => {
  app.get('/documents', async (request, reply) => {
    const tenant = resolveTenant(request.headers['x-tenant'], opts.config.tenant.default);
    const docs = await opts.knowledge.listDocuments({ tenant });
    return reply.code(200).send(docs);
  });

  app.delete(
    '/documents/:docId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['docId'],
          properties: { docId: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { docId } = request.params as { docId: string };
      const tenant = resolveTenant(request.headers['x-tenant'], opts.config.tenant.default);
      const result = await opts.knowledge.deleteDocument(docId, { tenant });
      return reply.code(200).send(result);
    },
  );

  app.post(
    '/documents/:docId/reindex',
    {
      schema: {
        params: {
          type: 'object',
          required: ['docId'],
          properties: { docId: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { docId } = request.params as { docId: string };
      try {
        const tenant = resolveTenant(request.headers['x-tenant'], opts.config.tenant.default);
        const result = await opts.knowledge.reindexDocument(docId, { tenant });
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof Error && err.message.includes('不存在')) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};

function resolveTenant(header: string | string[] | undefined, fallback: string): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || fallback;
}
