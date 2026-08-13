import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { Config } from '../config/index.js';

/** 文本向量化抽象（便于测试注入 mock）。 */
export interface Embedder {
  /** 批量把文本转成向量（每文本一个定长数组）。 */
  embedTexts(texts: string[]): Promise<number[][]>;
}

const DEFAULT_LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';

/**
 * 本地 embedding：用 Transformers.js 加载 all-MiniLM-L6-v2（384 维）。
 * 首次运行从 Hugging Face 下载模型权重，之后使用本地缓存；推理全程本地，不依赖云 API。
 */
export class LocalEmbedder implements Embedder {
  private readonly modelId: string;
  private extractorPromise?: Promise<FeatureExtractionPipeline>;

  constructor(modelId: string = DEFAULT_LOCAL_MODEL) {
    this.modelId = modelId;
    // 支持通过 HF_ENDPOINT 切换模型下载源（默认 huggingface.co；网络受限时可用
    // hf-mirror.com 等镜像，如 HF_ENDPOINT=https://hf-mirror.com）。
    const remoteHost = process.env.HF_ENDPOINT;
    if (remoteHost) {
      env.remoteHost = remoteHost;
    }
  }

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    this.extractorPromise ??= pipeline('feature-extraction', this.modelId);
    return this.extractorPromise;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist() as number[][];
  }
}

/** 云 OpenAI 兼容 embedding（EMBEDDING_MODE=cloud 时启用），读 01 配置中心的 embedding 段。 */
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
