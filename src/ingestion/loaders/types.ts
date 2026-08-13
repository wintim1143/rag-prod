/** 加载器统一输出结构。 */
export interface LoadedDocument {
  /** 抽取出的正文文本。 */
  text: string;
  metadata: {
    /** 文档标题：来自文件内标题（md/html）或文件名。 */
    title: string;
    /** 源文件路径（原样保留，供检索溯源）。 */
    sourcePath: string;
    sourceType: SourceType;
    /** ISO 时间戳。 */
    uploadedAt: string;
  };
}

export type SourceType = 'text' | 'markdown' | 'html' | 'pdf' | 'docx';

/** 加载器输入：内存中的文件字节 + 路径（不直接碰磁盘，便于测试）。 */
export interface LoaderInput {
  buffer: Buffer;
  sourcePath: string;
}

export type DocumentLoader = (input: LoaderInput) => Promise<LoadedDocument>;
