import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as lancedb from '@lancedb/lancedb';
import { loadConfig } from '../../src/config/index.js';
import type { Embedder } from '../../src/ingestion/embedder.js';
import { IngestPipeline } from '../../src/ingestion/pipeline.js';
import { LanceDBStore } from '../../src/ingestion/store/lancedb.js';
import { validEnv } from '../helpers.js';

/** 固定 8 维的确定性 mock 向量（不调云 API）。 */
class FakeEmbedder implements Embedder {
  embedTexts(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => [t.length % 16, 1, 2, 3, 4, 5, 6, 7]));
  }
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-pipeline-'));

function makePipeline(dbPath: string): IngestPipeline {
  const config = loadConfig({ env: validEnv() });
  return new IngestPipeline(config, {
    embedder: new FakeEmbedder(),
    store: new LanceDBStore(dbPath),
  });
}

function makePipelineWithRoot(dbPath: string, root: string): IngestPipeline {
  const config = loadConfig({ env: { ...validEnv(), INGEST_ROOT: root } });
  return new IngestPipeline(config, {
    embedder: new FakeEmbedder(),
    store: new LanceDBStore(dbPath),
  });
}

/** 每次重新 connect 查表行数，模拟「新进程读旧库」。 */
async function countChunks(dbPath: string): Promise<number> {
  const db = await lancedb.connect(dbPath);
  const names = await db.tableNames();
  if (!names.includes('chunks')) return 0;
  const table = await db.openTable('chunks');
  return table.countRows();
}

/** 统计特定 docId 的行数（避免与其他测试写入的表数据混算）。 */
async function countChunksForDocId(dbPath: string, docId: string): Promise<number> {
  const db = await lancedb.connect(dbPath);
  const names = await db.tableNames();
  if (!names.includes('chunks')) return 0;
  const table = await db.openTable('chunks');
  return table.countRows(`docId = '${docId}'`);
}

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('摄入管线 — 持久化', () => {
  it('单文件摄入后落库行数等于块数，docId 为 16 位 hex', async () => {
    const file = path.join(tmpDir, 'a.md');
    await fs.writeFile(file, '# 标题\n\n' + '内容。'.repeat(200));
    const pipeline = makePipeline(tmpDir);

    const outcome = await pipeline.ingestPath(file);
    expect(outcome.failed).toHaveLength(0);
    expect(outcome.ingested).toHaveLength(1);

    const { docId, chunkCount } = outcome.ingested[0] as {
      docId: string;
      chunkCount: number;
    };
    expect(docId).toMatch(/^[0-9a-f]{16}$/);
    expect(chunkCount).toBeGreaterThan(0);
    expect(await countChunks(tmpDir)).toBe(chunkCount);
  });
});

describe('摄入管线 — 更新语义', () => {
  it('重复摄入同一 docId 是更新而非重复插入', async () => {
    const file = path.join(tmpDir, 'update.md');
    await fs.writeFile(file, '# 更新\n\n' + '内容。'.repeat(100));
    const pipeline = makePipeline(tmpDir);

    const first = await pipeline.ingestPath(file);
    const before = await countChunks(tmpDir);
    const second = await pipeline.ingestPath(file);

    expect(second.ingested[0]?.docId).toBe(first.ingested[0]?.docId);
    expect(await countChunks(tmpDir)).toBe(before); // 行数不变 → 更新而非追加
  });
});

describe('摄入管线 — 目录摄入', () => {
  it('递归过滤支持的格式，忽略不支持文件', async () => {
    const dir = path.join(tmpDir, 'docs');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'c.md'), 'c');
    await fs.writeFile(path.join(dir, 'd.txt'), 'd');
    await fs.writeFile(path.join(dir, 'skip.zip'), 'x');
    const pipeline = makePipeline(tmpDir);

    const outcome = await pipeline.ingestPath(dir);
    expect(outcome.ingested).toHaveLength(2);
    expect(outcome.ingested.map((i) => path.basename(i.sourcePath)).sort()).toEqual([
      'c.md',
      'd.txt',
    ]);
    expect(outcome.failed).toHaveLength(0);
  });
});

describe('摄入管线 — 失败与边界', () => {
  it('单独摄入不支持格式记为 failed 而非抛错', async () => {
    const bad = path.join(tmpDir, 'e.zip');
    await fs.writeFile(bad, 'x');
    const outcome = await makePipeline(tmpDir).ingestPath(bad);
    expect(outcome.ingested).toHaveLength(0);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.error).toContain('不支持');
  });

  it('路径不存在记为 failed（不 500）', async () => {
    const outcome = await makePipeline(tmpDir).ingestPath(path.join(tmpDir, 'nope', 'x.md'));
    expect(outcome.failed).toHaveLength(1);
  });

  it('空文档 chunkCount 为 0 且不建表', async () => {
    const empty = path.join(tmpDir, 'empty.txt');
    await fs.writeFile(empty, '');
    const outcome = await makePipeline(tmpDir).ingestPath(empty);
    expect(outcome.ingested[0]?.chunkCount).toBe(0);
  });
});

describe('摄入管线 — 更新语义（空文档）', () => {
  it('已摄入文档被清空后重摄入，旧块被删除（更新为无块）', async () => {
    const file = path.join(tmpDir, 'shrink.md');
    await fs.writeFile(file, '# 有内容\n\n' + '内容。'.repeat(50));
    const pipeline = makePipeline(tmpDir);

    const first = await pipeline.ingestPath(file);
    const docId = first.ingested[0]?.docId as string;
    expect(await countChunksForDocId(tmpDir, docId)).toBeGreaterThan(0);

    await fs.writeFile(file, '');
    const second = await pipeline.ingestPath(file);
    expect(second.ingested[0]?.chunkCount).toBe(0);
    expect(await countChunksForDocId(tmpDir, docId)).toBe(0);
  });
});

describe('摄入管线 — INGEST_ROOT 路径安全', () => {
  it('根目录内路径正常摄入，目录外路径记为 failed', async () => {
    const root = path.join(tmpDir, 'allowed');
    await fs.mkdir(root, { recursive: true });
    const inside = path.join(root, 'ok.md');
    const outside = path.join(tmpDir, 'outside.md');
    await fs.writeFile(inside, 'ok');
    await fs.writeFile(outside, 'bad');
    const pipeline = makePipelineWithRoot(root, root);

    const ok = await pipeline.ingestPath(inside);
    expect(ok.ingested).toHaveLength(1);

    const bad = await pipeline.ingestPath(outside);
    expect(bad.ingested).toHaveLength(0);
    expect(bad.failed).toHaveLength(1);
    expect(bad.failed[0]?.error).toContain('摄入根目录');
  });
});
