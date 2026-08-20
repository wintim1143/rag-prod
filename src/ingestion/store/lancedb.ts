import * as lancedb from '@lancedb/lancedb';

/** 落库的单块记录（LanceDB 表结构）。 */
export interface ChunkRecord extends Record<string, unknown> {
  /** 主键：`${docId}#${chunkIndex}`。 */
  id: string;
  vector: number[];
  text: string;
  docId: string;
  chunkIndex: number;
  title: string;
  sourcePath: string;
  sectionPath: string;
  uploadedAt: string;
  /** 租户/命名空间标记（检索层过滤维度；API 强制带 tenant）。 */
  tenant?: string;
}

/** 检索/管理接口的过滤条件（下推到 LanceDB where 子句）。 */
export interface ChunkFilter {
  tenant?: string;
  docId?: string;
}

/** 文档级元数据（知识库管理 API 的返回形状）。 */
export interface DocumentMeta {
  docId: string;
  title: string;
  sourcePath: string;
  chunkCount: number;
  uploadedAt: string;
  tenant?: string;
}

/** 命中的块（不带向量/分数）。 */
export interface ChunkHit {
  id: string;
  text: string;
  docId: string;
  title: string;
  sourcePath: string;
  sectionPath: string;
}

/** 向量检索命中：distance 为余弦距离（越接近 0 越相似）。 */
export interface VectorHit extends ChunkHit {
  distance: number;
}

/** BM25 全文检索命中：score 为 BM25 相关分。 */
export interface FtsHit extends ChunkHit {
  score: number;
}

const DEFAULT_TABLE_NAME = 'chunks';
const FTS_COLUMN = 'text';
const SEARCH_COLUMNS = ['id', 'text', 'docId', 'title', 'sourcePath', 'sectionPath'];

/**
 * LanceDB 嵌入式向量库存储层。
 *
 * 按 docId 维度管理：重复摄入同一 docId = 先删旧块再插入（更新而非重复）。
 * 支持向量检索（cosine）与 BM25 全文检索（FTS，tantivy 后端）。
 */
export class LanceDBStore {
  private readonly dbPath: string;
  private readonly tableName: string;

  constructor(dbPath: string, tableName: string = DEFAULT_TABLE_NAME) {
    this.dbPath = dbPath;
    this.tableName = tableName;
  }

  async upsertChunks(docId: string, records: ChunkRecord[]): Promise<number> {
    const db = await lancedb.connect(this.dbPath);
    const tableNames = await db.tableNames();
    const table = tableNames.includes(this.tableName) ? await db.openTable(this.tableName) : null;

    // 无论是否有新块，先清掉该 docId 的旧块——保证「重复摄入 = 更新」，
    // 包括文档被清空后重摄入（旧块应被删除而非残留）。
    if (table) {
      await table.delete(`docId = '${docId}'`);
    }
    if (records.length === 0) {
      await this.rebuildFtsIndex();
      return 0;
    }
    if (table) {
      await table.add(records);
    } else {
      await db.createTable(this.tableName, records);
    }
    // 数据变更后重建 FTS 索引，保证全文检索与最新数据一致
    await this.rebuildFtsIndex();
    return records.length;
  }

  /** 向量检索：cosine 最近邻。filter 下推为 where 子句。 */
  async vectorSearch(vector: number[], limit: number, filter?: ChunkFilter): Promise<VectorHit[]> {
    const table = await this.openOrNull();
    if (!table) return [];
    let query = table.vectorSearch(vector).distanceType('cosine').limit(limit);
    const where = this.buildWhere(filter);
    if (where) query = query.where(where);
    const rows = await query.select([...SEARCH_COLUMNS, '_distance']).toArray();
    return rows.map((r) => ({ ...this.pick(r), distance: r._distance as number }));
  }

  /** BM25 全文检索。filter 下推为 where 子句。 */
  async ftsSearch(query: string, limit: number, filter?: ChunkFilter): Promise<FtsHit[]> {
    const table = await this.openOrNull();
    if (!table) return [];
    await this.ensureFtsIndex();
    const match = new lancedb.MatchQuery(query, FTS_COLUMN);
    let search = table.search(match).limit(limit);
    const where = this.buildWhere(filter);
    if (where) search = search.where(where);
    const rows = await search.select([...SEARCH_COLUMNS, '_score']).toArray();
    return rows.map((r) => ({ ...this.pick(r), score: r._score as number }));
  }

  /** 扫描全部块的 id+text（不带向量/分数），供检索诊断的 query 词覆盖探测。 */
  async scanChunks(filter?: ChunkFilter): Promise<{ id: string; text: string }[]> {
    const table = await this.openOrNull();
    if (!table) return [];
    const where = this.buildWhere(filter);
    const rows = (where
      ? await table.query().where(where).select(['id', 'text']).toArray()
      : await table.query().select(['id', 'text']).toArray()) as Record<string, unknown>[];
    return rows.map((r) => ({ id: r.id as string, text: r.text as string }));
  }

  /** 列出全部文档（按 docId 聚合块数 + 元数据）。 */
  async listDocuments(filter?: ChunkFilter): Promise<DocumentMeta[]> {
    const table = await this.openOrNull();
    if (!table) return [];
    const where = this.buildWhere(filter);
    const rows = (where ? await table.query().where(where).toArray() : await table.query().toArray()) as Record<
      string,
      unknown
    >[];
    const byDoc = new Map<string, DocumentMeta>();
    for (const row of rows) {
      const docId = row.docId as string;
      const entry = byDoc.get(docId) ?? {
        docId,
        title: row.title as string,
        sourcePath: row.sourcePath as string,
        chunkCount: 0,
        uploadedAt: row.uploadedAt as string,
        tenant: (row.tenant as string | undefined) ?? undefined,
      };
      entry.chunkCount += 1;
      byDoc.set(docId, entry);
    }
    return [...byDoc.values()].sort((a, b) => a.docId.localeCompare(b.docId));
  }

  /** 删除某 docId 的全部块；返回删除的块数。 */
  async deleteDocument(docId: string, filter: ChunkFilter = {}): Promise<number> {
    const table = await this.openOrNull();
    if (!table) return 0;
    const where = this.buildWhere({ ...filter, docId });
    if (!where) throw new Error('删除文档必须指定租户过滤条件');
    const result = await table.delete(where);
    const deleted = typeof result === 'number' ? result : result.numDeletedRows ?? 0;
    await this.rebuildFtsIndex();
    return deleted;
  }

  /** 把结构化过滤条件转成 LanceDB where 子句（对值做引号转义）。 */
  private buildWhere(filter?: ChunkFilter): string | undefined {
    const clauses: string[] = [];
    if (filter?.docId) {
      clauses.push(`docId = '${escapeSql(filter.docId)}'`);
    }
    if (filter?.tenant) {
      clauses.push(`tenant = '${escapeSql(filter.tenant)}'`);
    }
    return clauses.length > 0 ? clauses.join(' AND ') : undefined;
  }

  private async openOrNull(): Promise<lancedb.Table | null> {
    const db = await lancedb.connect(this.dbPath);
    const tableNames = await db.tableNames();
    if (!tableNames.includes(this.tableName)) return null;
    return db.openTable(this.tableName);
  }

  private pick(row: Record<string, unknown>): ChunkHit {
    return {
      id: row.id as string,
      text: row.text as string,
      docId: row.docId as string,
      title: row.title as string,
      sourcePath: row.sourcePath as string,
      sectionPath: row.sectionPath as string,
    };
  }

  /** 懒建：仅当 FTS 索引不存在时创建（检索前调用，避免每次重建）。 */
  async ensureFtsIndex(): Promise<void> {
    const table = await this.openOrNull();
    if (!table) return;
    const indices = await table.listIndices();
    if (indices.some((i) => i.indexType === 'FTS')) return;
    await table.createIndex(FTS_COLUMN, {
      config: lancedb.Index.fts(),
      replace: false,
      waitTimeoutSeconds: 60,
    });
  }

  /** 强制重建 FTS 索引（摄入数据变更后调用，保证全文检索与最新数据一致）。 */
  async rebuildFtsIndex(): Promise<void> {
    const table = await this.openOrNull();
    if (!table) return;
    await table.createIndex(FTS_COLUMN, {
      config: lancedb.Index.fts(),
      replace: true,
      waitTimeoutSeconds: 60,
    });
  }
}

/** 把值转义进 where 子句的 SQL 字符串字面量（防单引号注入）。 */
function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}
