import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { LoadedDocument } from './loaders/types.js';

export interface ChunkingConfig {
  chunkSize: number;
  chunkOverlap: number;
}

export interface DocumentChunk {
  text: string;
  metadata: {
    /** 在整篇文档中的块序号（供溯源排序）。 */
    chunkIndex: number;
    /** 章节路径（markdown 标题链）；非 markdown 为空数组。 */
    sectionPath: string[];
    title: string;
    sourcePath: string;
  };
}

/** 中英文通用的递归切分分隔符（中文按句切分，而非退化为按字符）。 */
const SEPARATORS = ['\n\n', '\n', '。', '！', '？', '；', '，', ' ', ''];

interface MarkdownBlock {
  kind: 'text' | 'code';
  content: string;
  path: string[];
}

/**
 * 把 markdown 切成「普通文本块 + 代码块」序列，同时追踪标题链。
 * - 标题层级跳变（如 h1→h2→h4）时过滤掉稀疏空位，sectionPath 恒为干净的标题数组。
 * - 代码围栏（```/~~~）内整体作为一个 code 块，含围栏标记，后续不会被递归切碎。
 */
function splitMarkdownByBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let path: string[] = [];
  let textLines: string[] = [];
  let codeLines: string[] = [];
  let codePath: string[] = [];
  let inCode = false;
  let fence = '';

  const cleanPath = (p: string[]): string[] => p.filter((entry): entry is string => Boolean(entry));
  const flushText = () => {
    if (textLines.length > 0) {
      blocks.push({ kind: 'text', content: textLines.join('\n'), path: cleanPath(path) });
      textLines = [];
    }
  };
  const flushCode = () => {
    if (codeLines.length > 0) {
      blocks.push({ kind: 'code', content: codeLines.join('\n'), path: cleanPath(codePath) });
      codeLines = [];
    }
  };

  for (const line of text.split('\n')) {
    if (!inCode) {
      const fenceMatch = line.match(/^\s*(```|~~~)/);
      if (fenceMatch) {
        flushText();
        inCode = true;
        fence = (fenceMatch[1] as string);
        codePath = [...path];
        codeLines.push(line);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushText();
        const level = (heading[1] as string).length;
        path = path.slice(0, level - 1);
        path[level - 1] = (heading[2] as string).trim();
        path = path.slice(0, level);
      }
      textLines.push(line);
      continue;
    }
    codeLines.push(line);
    if (line.trim().startsWith(fence)) {
      inCode = false;
      flushCode();
    }
  }
  flushText();
  flushCode();
  return blocks;
}

function makeRecursiveSplitter(config: ChunkingConfig): RecursiveCharacterTextSplitter {
  return new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: SEPARATORS,
  });
}

/**
 * 把加载的文档切成保留章节上下文的块。
 * - markdown：标题感知（保留章节路径与前缀）+ 代码块感知（围栏内不被切碎）。
 * - 其他格式：递归字符切分。
 */
export async function splitDocument(
  doc: LoadedDocument,
  config: ChunkingConfig,
): Promise<DocumentChunk[]> {
  return doc.metadata.sourceType === 'markdown'
    ? splitMarkdown(doc, config)
    : splitPlainText(doc, config);
}

async function splitPlainText(
  doc: LoadedDocument,
  config: ChunkingConfig,
): Promise<DocumentChunk[]> {
  const texts = await makeRecursiveSplitter(config).splitText(doc.text);
  return texts.map((text, chunkIndex) => ({
    text,
    metadata: {
      chunkIndex,
      sectionPath: [],
      title: doc.metadata.title,
      sourcePath: doc.metadata.sourcePath,
    },
  }));
}

async function splitMarkdown(
  doc: LoadedDocument,
  config: ChunkingConfig,
): Promise<DocumentChunk[]> {
  const blocks = splitMarkdownByBlocks(doc.text);
  const recursive = makeRecursiveSplitter(config);
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  const pushChunk = (sectionPath: string[], text: string) => {
    const prefixed = sectionPath.length > 0 ? `[${sectionPath.join(' > ')}]\n${text}` : text;
    chunks.push({
      text: prefixed,
      metadata: {
        chunkIndex: chunkIndex++,
        sectionPath,
        title: doc.metadata.title,
        sourcePath: doc.metadata.sourcePath,
      },
    });
  };

  for (const block of blocks) {
    if (block.kind === 'code') {
      // 代码块是语义单元：整体一块（保留围栏标记），不交给递归切分
      pushChunk(block.path, block.content);
      continue;
    }
    const subTexts = await recursive.splitText(block.content);
    for (const text of subTexts) {
      pushChunk(block.path, text);
    }
  }
  return chunks;
}
