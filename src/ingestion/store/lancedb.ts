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

const DEFAULT_TABLE_NAME = 'chunks';

/**
 * LanceDB 嵌入式向量库存储层。
 *
 * 按 docId 维度管理：重复摄入同一 docId = 先删旧块再插入（更新而非重复），
 * 数据落盘，进程重启后仍可检索（满足验收「重启不丢」）。
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
      return 0;
    }
    if (table) {
      await table.add(records);
    } else {
      await db.createTable(this.tableName, records);
    }
    return records.length;
  }
}
