import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '../config/index.js';
import { OpenAIEmbedder } from '../ingestion/embedder.js';
import { IngestPipeline, type IngestService } from '../ingestion/pipeline.js';
import { buildIngestRoutes } from '../ingestion/routes/ingest.js';
import { LanceDBStore } from '../ingestion/store/lancedb.js';
import { buildHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config: Config;
  /** 是否开启 Fastify 内置 logger（pino）。测试传 false 保持输出干净。 */
  logger?: boolean;
  /** 服务依赖覆盖（测试注入 stub）；缺省构建生产实现。 */
  services?: {
    ingest?: IngestService;
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
    ingest:
      services.ingest ??
      new IngestPipeline(config, {
        embedder: new OpenAIEmbedder(config),
        store: new LanceDBStore(config.lance.dbPath),
      }),
  });
  return app;
}
