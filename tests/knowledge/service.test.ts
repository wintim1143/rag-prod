import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import type { Embedder } from '../../src/ingestion/embedder.js';
import { IngestPipeline, type IngestService } from '../../src/ingestion/pipeline.js';
import { LanceDBStore } from '../../src/ingestion/store/lancedb.js';
import { KnowledgeServiceImpl, type KnowledgeService } from '../../src/knowledge/service.js';
import { validEnv } from '../helpers.js';

class FakeEmbedder implements Embedder {
  embedTexts(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => [t.length % 16, 1, 2, 3, 4, 5, 6, 7]));
  }
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-knowledge-'));

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

/** 真实摄入一个文件（默认租户），返回 { docId, sourcePath }。 */
async function ingestFile(file: string): Promise<{ docId: string; sourcePath: string }> {
  const config = loadConfig({ env: validEnv() });
  const pipeline = new IngestPipeline(config, {
    embedder: new FakeEmbedder(),
    store: new LanceDBStore(tmpDir),
  });
  const outcome = await pipeline.ingestPath(file);
  const ingested = outcome.ingested[0];
  if (!ingested) throw new Error('摄入失败');
  return { docId: ingested.docId, sourcePath: ingested.sourcePath };
}

function makeService(ingest: IngestService): KnowledgeService {
  const config = loadConfig({ env: validEnv() });
  return new KnowledgeServiceImpl(config, {
    store: new LanceDBStore(tmpDir),
    ingest,
  });
}

describe('KnowledgeService — 文档生命周期', () => {
  it('listDocuments 返回全部文档 + 块数 + sourcePath', async () => {
    const file = path.join(tmpDir, 'kb-a.md');
    await fs.writeFile(file, '# A\n\n' + '内容。'.repeat(50));
    await ingestFile(file);

    const service = makeService({ ingestPath: vi.fn() });
    const docs = await service.listDocuments();
    expect(docs).toHaveLength(1);
    const doc = docs[0] as NonNullable<(typeof docs)[0]>;
    expect(doc.sourcePath).toBe(file);
    expect(doc.chunkCount).toBeGreaterThan(0);
    expect(doc.tenant).toBe('default');
  });

  it('deleteDocument 删除后列表不含该文档', async () => {
    const file = path.join(tmpDir, 'kb-b.md');
    await fs.writeFile(file, '# B\n\n' + '内容。'.repeat(50));
    const { docId } = await ingestFile(file);

    const service = makeService({ ingestPath: vi.fn() });
    const result = await service.deleteDocument(docId, { tenant: 'default' });
    expect(result.deleted).toBeGreaterThan(0);
    const docs = await service.listDocuments();
    expect(docs.find((d) => d.docId === docId)).toBeUndefined();
  });

  it('reindexDocument 从 store 查出 sourcePath 并重新摄入', async () => {
    const file = path.join(tmpDir, 'kb-c.md');
    await fs.writeFile(file, '# C\n\n' + '内容。'.repeat(30));
    const { docId } = await ingestFile(file);

    // 桩 ingest：重索引后返回新块数，验证 service 用源路径调用摄入
    const ingest = {
      ingestPath: vi.fn().mockResolvedValue({
        ingested: [{ docId, sourcePath: file, chunkCount: 7 }],
        failed: [],
      }),
    };
    const service = makeService(ingest);

    const result = await service.reindexDocument(docId, { tenant: 'default' });
    expect(result).toEqual({ docId, chunkCount: 7 });
    // reindex 必须把定位时用的租户透传给摄入，避免跨租户漂移（C1）
    expect(ingest.ingestPath).toHaveBeenCalledWith(file, 'default');
  });

  it('reindexDocument 对不存在的 docId 抛错', async () => {
    const service = makeService({ ingestPath: vi.fn() });
    await expect(service.reindexDocument('no-such-doc', { tenant: 'default' })).rejects.toThrow('不存在');
  });
});
