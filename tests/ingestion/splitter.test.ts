import { describe, expect, it } from 'vitest';
import type { LoadedDocument } from '../../src/ingestion/loaders/types.js';
import { splitDocument } from '../../src/ingestion/splitter.js';

function doc(
  text: string,
  sourceType: LoadedDocument['metadata']['sourceType'],
  title = 'doc',
): LoadedDocument {
  return {
    text,
    metadata: { title, sourcePath: '/d/doc', sourceType, uploadedAt: 't' },
  };
}

describe('splitter — 纯文本', () => {
  it('短文本切为单块', async () => {
    const chunks = await splitDocument(doc('短文本。', 'text'), { chunkSize: 100, chunkOverlap: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.sectionPath).toEqual([]);
  });

  it('长文本切为多块，chunkIndex 连续，无章节路径', async () => {
    const long = '这是第一句话。这是第二句话。'.repeat(50);
    const chunks = await splitDocument(doc(long, 'text'), { chunkSize: 50, chunkOverlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.metadata.chunkIndex)).toEqual(
      chunks.map((_, i) => i),
    );
    expect(chunks.every((c) => c.metadata.sectionPath.length === 0)).toBe(true);
    expect(chunks.every((c) => c.metadata.sourcePath === '/d/doc')).toBe(true);
  });

  it('chunkOverlap 使相邻块存在共享词', async () => {
    const text = Array.from({ length: 200 }, (_, i) => `word${i} `).join('');
    const chunks = await splitDocument(doc(text, 'text'), { chunkSize: 50, chunkOverlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    const words0 = new Set(chunks[0].text.split(' ').filter(Boolean));
    const words1 = new Set(chunks[1].text.split(' ').filter(Boolean));
    const shared = [...words0].filter((w) => words1.has(w));
    expect(shared.length).toBeGreaterThan(0);
  });
});

describe('splitter — Markdown 标题感知', () => {
  const md =
    '# 第一章\n\n第一章的引言内容。\n\n' +
    '## 小节A\n\n小节A的具体内容描述。\n\n' +
    '## 小节B\n\n小节B的更多内容。\n\n' +
    '# 第二章\n\n第二章的开头。';

  it('按标题链分节，保留章节路径与前缀上下文', async () => {
    const chunks = await splitDocument(doc(md, 'markdown', '文档标题'), {
      chunkSize: 1000,
      chunkOverlap: 0,
    });
    expect(chunks.length).toBe(4);

    const sectionA = chunks.find((c) => c.metadata.sectionPath.join(' > ') === '第一章 > 小节A');
    expect(sectionA).toBeDefined();
    expect(sectionA?.text).toContain('[第一章 > 小节A]');
    expect(sectionA?.text).toContain('小节A的具体内容');

    const chapter2 = chunks.find((c) => c.metadata.sectionPath.join(' > ') === '第二章');
    expect(chapter2).toBeDefined();
    expect(chapter2?.text).toContain('[第二章]');
  });

  it('无标题 markdown 视为单节，章节路径为空', async () => {
    const chunks = await splitDocument(doc('没有标题的内容。', 'markdown'), {
      chunkSize: 100,
      chunkOverlap: 10,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].metadata.sectionPath).toEqual([]);
  });

  it('标题块超 chunkSize 时子切后每块仍带前缀', async () => {
    const longSection = '# 大节\n\n' + '详细内容。'.repeat(200);
    const chunks = await splitDocument(doc(longSection, 'markdown'), {
      chunkSize: 60,
      chunkOverlap: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.metadata.sectionPath.join(' > ') === '大节')).toBe(true);
    expect(chunks.every((c) => c.text.startsWith('[大节]'))).toBe(true);
  });
});
