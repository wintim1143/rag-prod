import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/index.js';
import { LocalEmbedder } from '../ingestion/embedder.js';
import { LanceDBStore } from '../ingestion/store/lancedb.js';
import { LocalReranker } from '../retrieval/reranker.js';
import { SearchPipeline } from '../retrieval/search.js';
import type { TraceHit } from '../retrieval/types.js';
import { formatReport } from './report.js';

/**
 * 检索诊断 CLI：npm run diagnose -- "<query>" [--tenant t] [--n N] [--k K] [--expected id1,id2]
 *
 * 对单条 query 逐环节输出 trace（向量 / BM25 / RRF / 重排）与失败分类，
 * 并把完整报告写入 trace-results/<timestamp>.json 供分享排查。
 */
function parseArgs(argv: string[]) {
  const query = argv[0];
  if (!query) throw new Error('用法: npm run diagnose -- "<query>" [--tenant t] [--n N] [--k K] [--expected id1,id2]');
  const opts: { query: string; tenant?: string; n?: number; k?: number; expected?: string[] } = { query };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--tenant') {
      opts.tenant = value;
      i++;
    } else if (flag === '--n') {
      opts.n = Number(value);
      i++;
    } else if (flag === '--k') {
      opts.k = Number(value);
      i++;
    } else if (flag === '--expected') {
      opts.expected = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
      i++;
    } else {
      throw new Error(`未知参数: ${flag}`);
    }
  }
  return opts;
}

/** 打印单环节命中列表（前 MAX 条，标注分数）。 */
function printHits(label: string, hits: TraceHit[], max = 10): void {
  console.log(`[${label}] ${hits.length} 条`);
  hits.slice(0, max).forEach((h, i) => {
    console.log(`  #${i + 1} ${h.chunkId}  score=${h.score.toFixed(4)}  (${h.sourcePath})`);
  });
  if (hits.length > max) console.log(`  … 其余 ${hits.length - max} 条省略（完整见报告文件）`);
}

/** 把 trace 渲染为可读报告（stdout 与写入文件共用）。 */
async function main() {
  const config = loadConfig();
  const opts = parseArgs(process.argv.slice(2));

  const search = new SearchPipeline(config, {
    embedder: new LocalEmbedder(),
    store: new LanceDBStore(config.lance.dbPath),
    reranker: new LocalReranker(config.reranker.model),
  });

  const trace = await search.trace(opts.query, {
    n: opts.n,
    k: opts.k,
    expected: opts.expected,
    filter: { tenant: opts.tenant ?? config.tenant.default },
  });

  console.log(formatReport(trace));
  printHits('向量检索 top', trace.vectorRetrieval.hits);
  printHits('BM25 top', trace.bm25Retrieval.hits);
  printHits('重排 top', trace.rerank.candidates);

  const outDir = path.join(process.cwd(), 'trace-results');
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `trace-${Date.now()}.json`);
  await fs.writeFile(file, JSON.stringify(trace, null, 2), 'utf-8');
  console.log(`报告写入 ${file}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
