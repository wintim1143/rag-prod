import { OpenAIEmbeddings } from '@langchain/openai';
import type { Config } from '../config/index.js';

/** 文本向量化抽象（便于测试注入 mock）。 */
export interface Embedder {
  /** 批量把文本转成向量（每文本一个定长数组）。 */
  embedTexts(texts: string[]): Promise<number[][]>;
}

/** 基于云 OpenAI 兼容 embedding API 的实现（读 01 配置中心的 embedding 段）。 */
export class OpenAIEmbedder implements Embedder {
  private readonly embeddings: OpenAIEmbeddings;

  constructor(config: Config) {
    this.embeddings = new OpenAIEmbeddings({
      model: config.embedding.model,
      apiKey: config.embedding.apiKey,
      configuration: { baseURL: config.embedding.baseUrl },
      maxRetries: 2,
    });
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}
