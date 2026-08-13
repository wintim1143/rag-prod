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

  /** 向量检索：cosine 最近邻。 */
  async vectorSearch(vector: number[], limit: number): Promise<VectorHit[]> {
    const table = await this.openOrNull();
    if (!table) return [];
    const rows = await table
      .vectorSearch(vector)
      .distanceType('cosine')
      .limit(limit)
      .select([...SEARCH_COLUMNS, '_distance'])
      .toArray();
    return rows.map((r) => ({ ...this.pick(r), distance: r._distance as number }));
  }

  /** BM25 全文检索。 */
  async ftsSearch(query: string, limit: number): Promise<FtsHit[]> {
    const table = await this.openOrNull();
    if (!table) return [];
    await this.ensureFtsIndex();
    const match = new lancedb.MatchQuery(query, FTS_COLUMN);
    const rows = await table
      .search(match)
      .limit(limit)
      .select([...SEARCH_COLUMNS, '_score'])
      .toArray();
    return rows.map((r) => ({ ...this.pick(r), score: r._score as number }));
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
