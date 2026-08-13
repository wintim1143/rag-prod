import { describe, expect, it } from 'vitest';
import { UnsupportedFormatError } from '../../src/ingestion/loaders/errors.js';
import { loadDocx } from '../../src/ingestion/loaders/docx-loader.js';
import { loadHtml } from '../../src/ingestion/loaders/html-loader.js';
import { loadDocument, SUPPORTED_EXTENSIONS } from '../../src/ingestion/loaders/index.js';
import { loadMarkdown } from '../../src/ingestion/loaders/markdown-loader.js';
import { loadPdf } from '../../src/ingestion/loaders/pdf-loader.js';
import { loadText } from '../../src/ingestion/loaders/text-loader.js';
import { docxBuffer, pdfBuffer } from './fixtures.js';

describe('loaders — TXT', () => {
  it('抽取纯文本，标题取文件名', async () => {
    const doc = await loadText({ buffer: Buffer.from('hello world'), sourcePath: '/docs/readme.txt' });
    expect(doc.text).toBe('hello world');
    expect(doc.metadata).toMatchObject({
      title: 'readme',
      sourceType: 'text',
      sourcePath: '/docs/readme.txt',
    });
  });
});

describe('loaders — Markdown', () => {
  it('标题取首个一级标题，正文全文保留', async () => {
    const doc = await loadMarkdown({ buffer: Buffer.from('# 我的文档\n\n这是正文内容。'), sourcePath: '/docs/guide.md' });
    expect(doc.metadata.title).toBe('我的文档');
    expect(doc.text).toContain('这是正文内容');
  });

  it('无标题时标题取文件名', async () => {
    const doc = await loadMarkdown({ buffer: Buffer.from('没有标题的内容'), sourcePath: '/docs/notes.md' });
    expect(doc.metadata.title).toBe('notes');
  });
});

describe('loaders — HTML', () => {
  it('剥离导航/脚本，提取正文；标题取 <title>', async () => {
    const html =
      '<html><head><title>页面标题</title></head><body>' +
      '<nav>导航</nav><h1>H1 标题</h1><p>正文内容</p><script>evil()</script>' +
      '</body></html>';
    const doc = await loadHtml({ buffer: Buffer.from(html), sourcePath: '/s/page.html' });
    expect(doc.metadata.title).toBe('页面标题');
    expect(doc.text).toContain('正文内容');
    expect(doc.text).toContain('H1 标题');
    expect(doc.text).not.toContain('导航');
    expect(doc.text).not.toContain('evil');
  });
});

describe('loaders — PDF', () => {
  it('抽取文本层（pdf-lib 生成 → unpdf 提取）', async () => {
    const buffer = await pdfBuffer('Hello PDF Text');
    const doc = await loadPdf({ buffer, sourcePath: '/s/report.pdf' });
    expect(doc.text).toContain('Hello PDF Text');
    expect(doc.metadata.sourceType).toBe('pdf');
    expect(doc.metadata.title).toBe('report');
  });
});

describe('loaders — DOCX', () => {
  it('抽取段落文本（docx 生成 → mammoth 提取）', async () => {
    const buffer = await docxBuffer(['Hello DOCX', 'Second paragraph']);
    const doc = await loadDocx({ buffer, sourcePath: '/s/letter.docx' });
    expect(doc.text).toContain('Hello DOCX');
    expect(doc.text).toContain('Second paragraph');
    expect(doc.metadata.sourceType).toBe('docx');
  });
});

describe('loadDocument — 分派', () => {
  it('按扩展名分派，忽略大小写', async () => {
    const doc = await loadDocument({ buffer: Buffer.from('hi'), sourcePath: '/x/FILE.TXT' });
    expect(doc.metadata.sourceType).toBe('text');
  });

  it('不支持扩展名抛 UnsupportedFormatError', async () => {
    await expect(
      loadDocument({ buffer: Buffer.from('x'), sourcePath: '/x/archive.zip' }),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('SUPPORTED_EXTENSIONS 覆盖五类格式', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(
      expect.arrayContaining(['.txt', '.md', '.html', '.pdf', '.docx']),
    );
  });
});
