import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config/index.js';
import type { Embedder } from './embedder.js';
import { loadDocument, SUPPORTED_EXTENSIONS } from './loaders/index.js';
import type { DocumentChunk } from './splitter.js';
import { splitDocument } from './splitter.js';
import { LanceDBStore, type ChunkRecord } from './store/lancedb.js';

export interface IngestedDoc {
  docId: string;
  sourcePath: string;
  chunkCount: number;
}

export interface FailedDoc {
  sourcePath: string;
  error: string;
}

export interface IngestOutcome {
  ingested: IngestedDoc[];
  failed: FailedDoc[];
}

/** HTTP 层可注入的摄入服务抽象（测试注入 stub）。 */
export interface IngestService {
  ingestPath(inputPath: string): Promise<IngestOutcome>;
}

export interface IngestDeps {
  embedder: Embedder;
  store: LanceDBStore;
}

/** 由源路径稳定生成 docId（hex，无 SQL 特殊字符）。重复摄入同一路径 → 同一 docId → 更新。 */
export function computeDocId(sourcePath: string): string {
  return createHash('sha256').update(sourcePath).digest('hex').slice(0, 16);
}

/** 把输入路径解析为待摄入文件列表：单文件原样返回；目录递归展开并过滤支持的格式。 */
async function resolveInputFiles(inputPath: string): Promise<string[]> {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    return [inputPath];
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(inputPath, { withFileTypes: true, recursive: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(inputPath, entry.name))
      .filter((file) => SUPPORTED_EXTENSIONS.includes(path.extname(file).toLowerCase()))
      .sort();
  }
  throw new Error(`路径既不是文件也不是目录: ${inputPath}`);
}

/** 摄入管线：加载 → 切分 → 向量化 → 落库（按 docId upsert）。 */
export class IngestPipeline implements IngestService {
  constructor(
    private readonly config: Config,
    private readonly deps: IngestDeps,
  ) {}

  async ingestPath(inputPath: string): Promise<IngestOutcome> {
    let files: string[];
    try {
      files = await resolveInputFiles(inputPath);
    } catch (err) {
      // 输入路径本身无效：记为一条失败，而非整个请求 500
      return {
        ingested: [],
        failed: [{ sourcePath: inputPath, error: message(err) }],
      };
    }

    const ingested: IngestedDoc[] = [];
    const failed: FailedDoc[] = [];
    for (const file of files) {
      try {
        const buffer = await fs.readFile(file);
        const doc = await loadDocument({ buffer, sourcePath: file });
        const chunks = await splitDocument(doc, this.config.chunking);
        const vectors = await this.deps.embedder.embedTexts(chunks.map((c) => c.text));
        const records = this.buildRecords(file, doc.metadata.title, doc.metadata.uploadedAt, chunks, vectors);
        const docId = computeDocId(file);
        const chunkCount = await this.deps.store.upsertChunks(docId, records);
        ingested.push({ docId, sourcePath: file, chunkCount });
      } catch (err) {
        failed.push({ sourcePath: file, error: message(err) });
      }
    }
    return { ingested, failed };
  }

  private buildRecords(
    sourcePath: string,
    title: string,
    uploadedAt: string,
    chunks: DocumentChunk[],
    vectors: number[][],
  ): ChunkRecord[] {
    const docId = computeDocId(sourcePath);
    return chunks.map((chunk, i) => ({
      id: `${docId}#${i}`,
      vector: vectors[i] as number[],
      text: chunk.text,
      docId,
      chunkIndex: chunk.metadata.chunkIndex,
      title,
      sourcePath: chunk.metadata.sourcePath,
      sectionPath: chunk.metadata.sectionPath.join(' > '),
      uploadedAt,
    }));
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
