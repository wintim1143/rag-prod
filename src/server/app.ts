import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '../config/index.js';
import { createChatProvider } from '../generation/llm.js';
import { buildAskRoutes } from '../generation/routes/ask.js';
import { buildChatRoutes } from '../generation/routes/chat.js';
import { AnswerPipeline, type AnswerService } from '../generation/service.js';
import { LocalEmbedder, OpenAIEmbedder, type Embedder } from '../ingestion/embedder.js';
import { IngestPipeline, type IngestService } from '../ingestion/pipeline.js';
import { buildIngestRoutes } from '../ingestion/routes/ingest.js';
import { LanceDBStore } from '../ingestion/store/lancedb.js';
import { KnowledgeServiceImpl, type KnowledgeService } from '../knowledge/service.js';
import { buildKnowledgeRoutes } from '../knowledge/routes/documents.js';
import { LocalReranker } from '../retrieval/reranker.js';
import { buildSearchRoutes } from '../retrieval/routes/search.js';
import { SearchPipeline, type SearchService } from '../retrieval/search.js';
import { buildHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config: Config;
  /** 是否开启 Fastify 内置 logger（pino）。测试传 false 保持输出干净。 */
  logger?: boolean;
  /** 服务依赖覆盖（测试注入 stub）；缺省构建生产实现。 */
  services?: {
    ingest?: IngestService;
    search?: SearchService;
    answer?: AnswerService;
    knowledge?: KnowledgeService;
  };
}

/** 组装 Fastify 应用（注册路由）。不 listen —— 由入口或测试决定。 */
export function buildApp({
  config,
  logger = true,
  services = {},
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.register(buildHealthRoutes, { config });
  app.register(buildIngestRoutes, {
    ingest: services.ingest ?? new IngestPipeline(config, createIngestDeps(config)),
  });

  // search 与 answer 共享同一 search 实例（answer 复用检索管线）
  const search =
    services.search ??
    new SearchPipeline(config, {
      embedder: createEmbedder(config),
      store: new LanceDBStore(config.lance.dbPath),
      reranker: new LocalReranker(config.reranker.model),
    });
  app.register(buildSearchRoutes, { search, config });
  const answer = services.answer ?? new AnswerPipeline(search, createChatProvider(config));
  app.register(buildAskRoutes, { answer });
  app.register(buildChatRoutes, { answer });
  app.register(buildKnowledgeRoutes, {
    knowledge:
      services.knowledge ??
      new KnowledgeServiceImpl(config, {
        store: new LanceDBStore(config.lance.dbPath),
        ingest: services.ingest ?? new IngestPipeline(config, createIngestDeps(config)),
      }),
  });
  return app;
}

/** 按 EMBEDDING_MODE 选择 embedder：默认本地 Transformers.js，cloud 走云 API。 */
function createEmbedder(config: Config): Embedder {
  return config.embedding.mode === 'cloud'
    ? new OpenAIEmbedder(config)
    : new LocalEmbedder();
}

function createIngestDeps(config: Config) {
  return {
    embedder: createEmbedder(config),
    store: new LanceDBStore(config.lance.dbPath),
  };
}
