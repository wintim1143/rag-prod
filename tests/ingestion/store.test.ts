import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LanceDBStore, type ChunkRecord } from '../../src/ingestion/store/lancedb.js';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));

function rec(docId: string, index: number, tenant = 'default', text = `块${docId}-${index}`): ChunkRecord {
  return {
    id: `${docId}#${index}`,
    vector: [0.1, 0.2, 0.3],
    text,
    docId,
    chunkIndex: index,
    title: '文档',
    sourcePath: `${docId}.md`,
    sectionPath: 'sec',
    uploadedAt: '2026-08-14T00:00:00.000Z',
    tenant,
  };
}

async function seed(store: LanceDBStore): Promise<void> {
  await store.upsertChunks('doc-a', [rec('doc-a', 0), rec('doc-a', 1)]);
  await store.upsertChunks('doc-b', [rec('doc-b', 0, 'tenant-x')]);
}

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('LanceDBStore — 文档生命周期', () => {
  it('listDocuments 返回全部文档 + 块数 + 元数据', async () => {
    const store = new LanceDBStore(tmpDir);
    await seed(store);

    const docs = await store.listDocuments();
    const a = docs.find((d) => d.docId === 'doc-a');
    const b = docs.find((d) => d.docId === 'doc-b');
    expect(a).toMatchObject({ docId: 'doc-a', chunkCount: 2, sourcePath: 'doc-a.md' });
    expect(b).toMatchObject({ docId: 'doc-b', chunkCount: 1, tenant: 'tenant-x' });
  });

  it('deleteDocument 删除该 docId 全部块，其余文档保留', async () => {
    const store = new LanceDBStore(tmpDir);
    await seed(store);

    const deleted = await store.deleteDocument('doc-a');
    expect(deleted).toBe(2);
    const docs = await store.listDocuments();
    expect(docs.find((d) => d.docId === 'doc-a')).toBeUndefined();
    expect(docs.find((d) => d.docId === 'doc-b')).toBeDefined();
  });

  it('deleteDocument 不存在的 docId 返回 0', async () => {
    const store = new LanceDBStore(tmpDir);
    await seed(store);
    expect(await store.deleteDocument('nope')).toBe(0);
  });

  it('删除后该 docId 不再被检索命中', async () => {
    const store = new LanceDBStore(tmpDir);
    await seed(store);
    await store.deleteDocument('doc-a');

    const vec = await store.vectorSearch([0.1, 0.2, 0.3], 10);
    expect(vec.every((h) => h.docId !== 'doc-a')).toBe(true);
  });
});

describe('LanceDBStore — scanChunks 文本扫描', () => {
  it('返回全部块的 id+text（供 query 词覆盖探测）', async () => {
    const store = new LanceDBStore(tmpDir);
    await seed(store);

    const chunks = await store.scanChunks();
    expect(chunks.length).toBe(3);
    const a = chunks.find((c) => c.id === 'doc-a#0');
    expect(a).toMatchObject({ id: 'doc-a#0', text: '块doc-a-0' });
  });

  it('支持 tenant 过滤', async () => {
    const store = new LanceDBStore(tmpDir);
    await seed(store);

    const chunks = await store.scanChunks({ tenant: 'tenant-x' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.id).toBe('doc-b#0');
  });
});

describe('LanceDBStore — 检索过滤', () => {
  it('vectorSearch 支持 tenant 过滤', async () => {
    const store = new LanceDBStore(tmpDir);
    await seed(store);

    const hits = await store.vectorSearch([0.1, 0.2, 0.3], 10, { tenant: 'tenant-x' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.docId === 'doc-b')).toBe(true);
  });

  it('ftsSearch 支持 docId 过滤（用 ASCII 词确保 BM25 命中）', async () => {
    const store = new LanceDBStore(tmpDir);
    await store.upsertChunks('doc-a', [rec('doc-a', 0, 'default', 'alpha content'), rec('doc-a', 1, 'default', 'beta content')]);
    await store.upsertChunks('doc-b', [rec('doc-b', 0, 'tenant-x', 'alpha only here')]);

    // 无过滤命中两个 doc；过滤后只命中 doc-b
    const all = await store.ftsSearch('alpha', 10);
    expect(all.map((h) => h.docId).sort()).toEqual(['doc-a', 'doc-b']);

    const hits = await store.ftsSearch('alpha', 10, { docId: 'doc-b' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.docId === 'doc-b')).toBe(true);
  });
});
