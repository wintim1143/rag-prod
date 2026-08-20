import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/index.js';
import { createChatProvider } from '../generation/llm.js';
import { AnswerPipeline } from '../generation/service.js';
import { LocalEmbedder } from '../ingestion/embedder.js';
import { LanceDBStore } from '../ingestion/store/lancedb.js';
import { LocalReranker } from '../retrieval/reranker.js';
import { SearchPipeline } from '../retrieval/search.js';
import { LlmQueryOptimizer } from '../retrieval/query-optimizer.js';
import { EVAL_DATASET } from './dataset.js';
import { compareVariants, runVariant } from './runner.js';

/**
 * 完整评估：npm run eval
 * 在同一评测集上跑多个配置变体（baseline 与几个 k 值），产出可提交对比的 JSON。
 * 输出到 eval-results/<timestamp>.json。
 */
async function main() {
  const config = loadConfig();

  const embedder = new LocalEmbedder();
  const store = new LanceDBStore(config.lance.dbPath);
  const reranker = new LocalReranker(config.reranker.model);
  const judge = createChatProvider(config);

  function makeSearch(k: number, opts?: { rewrite?: boolean; multiQuery?: boolean; hyde?: boolean }) {
    const search = new SearchPipeline(config, {
      embedder,
      store,
      reranker,
      optimizer: new LlmQueryOptimizer(judge),
    });
    return {
      search,
      answer: new AnswerPipeline(search, judge),
      k,
      overrides: { rewrite: opts?.rewrite ?? false, multiQuery: opts?.multiQuery ?? false, hyde: opts?.hyde ?? false },
    };
  }

  const variants = [
    { name: `baseline-k${config.retrieval.k}`, k: config.retrieval.k, opts: undefined },
    { name: 'rewrite', k: config.retrieval.k, opts: { rewrite: true } },
    { name: 'multi-query', k: config.retrieval.k, opts: { multiQuery: true } },
    { name: 'hyde', k: config.retrieval.k, opts: { hyde: true } },
  ];

  // 评测集默认全量；用 EVAL_DATASET 子集（如环境变量 EVAL_MAX_SAMPLES 限制冒烟）
  const maxSamples = process.env.EVAL_MAX_SAMPLES
    ? Number(process.env.EVAL_MAX_SAMPLES)
    : EVAL_DATASET.length;
  const dataset = EVAL_DATASET.slice(0, maxSamples);

  const baselineVariant = variants[0];
  if (!baselineVariant) throw new Error('缺少基线变体');
  const baselineStub = makeSearch(baselineVariant.k);
  const baseline = await runVariant({
    name: baselineVariant.name,
    dataset,
    search: baselineStub.search,
    answer: baselineStub.answer,
    judge,
    k: baselineVariant.k,
  });

  const others: Awaited<ReturnType<typeof runVariant>>[] = [];
  for (const v of variants.slice(1)) {
    const stub = makeSearch(v.k);
    others.push(
      await runVariant({
        name: v.name,
        dataset,
        search: stub.search,
        answer: stub.answer,
        judge,
        k: v.k,
      }),
    );
  }

  const regressions = compareVariants(baseline, others, { threshold: 0.05 });

  const result = {
    generatedAt: new Date().toISOString(),
    sampleCount: dataset.length,
    baseline: baseline.averages,
    variants: others.map((v) => ({ variant: v.variant, averages: v.averages })),
    regressions,
  };

  const outDir = path.join(process.cwd(), 'eval-results');
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `eval-${Date.now()}.json`);
  await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf-8');

  // 结构化输出到 stdout（供日志/CI 阅读）
  console.log('=== eval baseline ===');
  console.log(JSON.stringify(baseline.averages, null, 2));
  for (const v of others) {
    console.log(`=== eval variant ${v.variant} ===`);
    console.log(JSON.stringify(v.averages, null, 2));
  }
  console.log('=== regressions ===');
  console.log(regressions.length ? JSON.stringify(regressions, null, 2) : '无');
  console.log(`结果写入 ${file}`);

  // 有回归时非零退出，便于 CI 失败
  if (regressions.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
