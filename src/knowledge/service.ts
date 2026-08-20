import type { Config } from '../config/index.js';
import type { IngestService } from '../ingestion/pipeline.js';
import type { ChunkFilter, DocumentMeta, LanceDBStore } from '../ingestion/store/lancedb.js';

export interface KnowledgeDeps {
  store: LanceDBStore;
  ingest: IngestService;
}

export interface DeleteResult {
  docId: string;
  deleted: number;
}

export interface ReindexResult {
  docId: string;
  chunkCount: number;
}

/** 知识库管理服务抽象（路由注入；测试用 stub）。 */
export interface KnowledgeService {
  /** 列出全部文档（+块数+元数据）。 */
  listDocuments(filter?: ChunkFilter): Promise<DocumentMeta[]>;
  /** 删除某文档全部块（限制在租户内）。 */
  deleteDocument(docId: string, filter: ChunkFilter): Promise<DeleteResult>;
  /** 重索引：按 sourcePath 重新摄入（旧块被新块替换）。 */
  reindexDocument(docId: string, filter: ChunkFilter): Promise<ReindexResult>;
}

/**
 * 知识库管理服务实现：文档列表 / 删除 / 重索引。
 * 重索引通过 sourcePath 重新摄入（docId 由路径稳定生成 → 原地更新旧块）。
 */
export class KnowledgeServiceImpl implements KnowledgeService {
  constructor(
    private readonly config: Config,
    private readonly deps: KnowledgeDeps,
  ) {}

  /** 列出全部文档（+块数+元数据）；支持按租户过滤。 */
  async listDocuments(filter?: ChunkFilter): Promise<DocumentMeta[]> {
    return this.deps.store.listDocuments(filter);
  }

  /** 删除某文档全部块。 */
  async deleteDocument(docId: string, filter: ChunkFilter): Promise<DeleteResult> {
    const deleted = await this.deps.store.deleteDocument(docId, filter);
    return { docId, deleted };
  }

  /** 重索引：按 sourcePath 重新摄入（旧块被新块替换）。 */
  async reindexDocument(docId: string, filter: ChunkFilter): Promise<ReindexResult> {
    const docs = await this.deps.store.listDocuments({ ...filter, docId });
    const meta = docs[0];
    if (!meta) {
      throw new Error(`文档不存在: ${docId}`);
    }
    const outcome = await this.deps.ingest.ingestPath(meta.sourcePath);
    const ingested = outcome.ingested.find((i) => i.docId === docId);
    if (!ingested) {
      const failed = outcome.failed[0];
      throw new Error(failed ? `重索引失败: ${failed.error}` : `重索引未命中 docId: ${docId}`);
    }
    return { docId: ingested.docId, chunkCount: ingested.chunkCount };
  }
}
