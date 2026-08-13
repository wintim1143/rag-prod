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

interface HeaderSection {
  content: string;
  path: string[];
}

/**
 * 按 1-4 级 markdown 标题把文本切成带章节路径的分节。
 * 标题行保留在 content 首行；path 记录标题链（`[h1, h2, ...]`）。
 */
function splitMarkdownByHeaders(text: string): HeaderSection[] {
  const sections: HeaderSection[] = [];
  let path: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length > 0) {
      sections.push({ content: lines.join('\n'), path: [...path] });
      lines = [];
    }
  };

  for (const line of text.split('\n')) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (match) {
      flush();
      const level = (match[1] as string).length;
      path = path.slice(0, level - 1);
      path[level - 1] = (match[2] as string).trim();
      path = path.slice(0, level);
    }
    lines.push(line);
  }
  flush();
  return sections;
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
 * - markdown：先按标题链分节，每节再按 chunkSize 子切，并把标题链前缀拼进块文本，
 *   使章节上下文可被检索/生成感知。
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
  const sections = splitMarkdownByHeaders(doc.text);
  const recursive = makeRecursiveSplitter(config);
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const subTexts = await recursive.splitText(section.content);
    for (const text of subTexts) {
      const prefixed = section.path.length > 0 ? `[${section.path.join(' > ')}]\n${text}` : text;
      chunks.push({
        text: prefixed,
        metadata: {
          chunkIndex: chunkIndex++,
          sectionPath: section.path,
          title: doc.metadata.title,
          sourcePath: doc.metadata.sourcePath,
        },
      });
    }
  }
  return chunks;
}
