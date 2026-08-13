import 'dotenv/config';
import { loadConfig, type Config } from './config/index.js';
import { buildApp } from './server/app.js';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  // 启动前无法使用 app.log，直接向 stderr 输出清晰的配置错误
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const app = buildApp({ config });

try {
  await app.listen({ host: '0.0.0.0', port: config.server.port });
  app.log.info({ port: config.server.port }, 'rag-prod server started');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
