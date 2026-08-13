import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config/index.js';

export interface HealthRoutesOptions {
  config: Config;
}

/**
 * GET /health —— 返回 200 与配置栈摘要。
 *
 * 注意：摘要含 baseUrl/model，但绝不含任何 API 密钥。
 */
export const buildHealthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, opts) => {
  const { config } = opts;

  app.get('/health', async () => ({
    status: 'ok',
    stack: {
      framework: 'langchain-js',
      server: 'fastify',
      llm: {
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
      },
      embedding: {
        baseUrl: config.embedding.baseUrl,
        model: config.embedding.model,
        usesDedicatedProvider: config.embedding.usesDedicatedProvider,
      },
      vectorStore: 'lance-db',
      reranker: {
        model: config.reranker.model,
        mode: 'local-cross-encoder',
      },
    },
    timestamp: new Date().toISOString(),
  }));
};
