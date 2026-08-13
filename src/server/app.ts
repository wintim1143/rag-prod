import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '../config/index.js';
import { buildHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config: Config;
  /** 是否开启 Fastify 内置 logger（pino）。测试传 false 保持输出干净。 */
  logger?: boolean;
}

/**
 * 组装 Fastify 应用（注册路由）。不 listen —— 由入口或测试决定。
 */
export function buildApp({ config, logger = true }: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.register(buildHealthRoutes, { config });
  return app;
}
