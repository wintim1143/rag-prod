import 'dotenv/config';
import { loadConfig } from './config/index.js';
import { buildApp } from './server/app.js';

const config = loadConfig();
const app = buildApp({ config });

try {
  await app.listen({ host: '0.0.0.0', port: config.server.port });
  app.log.info({ port: config.server.port }, 'rag-prod server started');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
