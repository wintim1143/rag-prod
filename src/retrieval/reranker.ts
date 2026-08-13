import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
} from '@huggingface/transformers';
import type { SearchCandidate } from './types.js';

export interface RerankResult {
  candidates: SearchCandidate[];
  /** cross-encoder 正常 / 降级到启发式兜底。 */
  status: 'cross-encoder' | 'fallback';
  reason?: string;
}

export interface Reranker {
  rerank(query: string, candidates: SearchCandidate[]): Promise<RerankResult>;
}

/** 可用的本地 cross-encoder 重排模型（bge-reranker 家族的 Transformers.js 版 tokenizer 有兼容 bug，改用 ms-marco）。 */
const DEFAULT_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';
const MAX_PASSAGE_LENGTH = 512;

/**
 * 本地 cross-encoder 重排器（Transformers.js）。
 *
 * 输入 (query, passage) 对 → 分类 logits → sigmoid 得相关性分 → 降序精排。
 * 加载/推理失败时降级到启发式兜底（query 与块文本的词重叠 + RRF 加权），
 * 并如实上报 status='fallback' 供 /search 展示。
 */
export class LocalReranker implements Reranker {
  private readonly modelId: string;
  private state: 'idle' | 'ready' | 'failed' = 'idle';
  private lastError?: string;
  private tokenizerPromise?: ReturnType<typeof AutoTokenizer.from_pretrained>;
  private modelPromise?: ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>;

  constructor(modelId: string = DEFAULT_MODEL) {
    this.modelId = modelId;
    // 支持 HF_ENDPOINT 切换模型下载源（与 LocalEmbedder 一致）
    const remoteHost = process.env.HF_ENDPOINT;
    if (remoteHost) {
      env.remoteHost = remoteHost;
    }
  }

  async rerank(query: string, candidates: SearchCandidate[]): Promise<RerankResult> {
    if (this.state !== 'failed') {
      try {
        const [tokenizer, model] = await this.ensureLoaded();
        const pairs = candidates.map((c) => [query, c.text.slice(0, MAX_PASSAGE_LENGTH)]);
        const inputs = await tokenizer(pairs as never, { padding: true, truncation: true });
        const output = await model(inputs);
        const logits = output.logits.tolist() as number[][];
        candidates.forEach((c, i) => {
          const raw = logits[i]?.[0];
          c.rerank = raw === undefined ? null : sigmoid(raw);
        });
        candidates.sort((a, b) => (b.rerank ?? 0) - (a.rerank ?? 0));
        this.state = 'ready';
        return { candidates, status: 'cross-encoder' };
      } catch (err) {
        this.state = 'failed';
        this.lastError = errorMessage(err);
        return this.fallback(query, candidates, this.lastError);
      }
    }
    // 已失败：持续降级，并保留首次失败原因供 /search 展示
    return this.fallback(query, candidates, this.lastError);
  }

  private async ensureLoaded() {
    // 顺序加载：tokenizer 先就绪，再加载 model（并行加载会因 tokenizer_class 未就绪而失败）
    if (!this.tokenizerPromise) {
      this.tokenizerPromise = AutoTokenizer.from_pretrained(this.modelId);
    }
    const tokenizer = await this.tokenizerPromise;
    if (!this.modelPromise) {
      this.modelPromise = AutoModelForSequenceClassification.from_pretrained(this.modelId);
    }
    const model = await this.modelPromise;
    return [tokenizer, model] as const;
  }

  /** 启发式兜底：query 与块文本的中英文词重叠比例 + RRF 分数加权，保序精排。 */
  private fallback(query: string, candidates: SearchCandidate[], reason?: string): RerankResult {
    for (const c of candidates) {
      c.rerank = heuristicScore(query, c.text, c.rrf);
    }
    candidates.sort((a, b) => (b.rerank ?? 0) - (a.rerank ?? 0));
    return { candidates, status: 'fallback', reason };
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** 中英文词集：ASCII 词 + CJK 单字。 */
function tokenSet(text: string): Set<string> {
  const ascii = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const cjk = text.match(/[一-鿿]/g) ?? [];
  return new Set([...ascii, ...cjk]);
}

/** 启发式相关分：query 与文本的词重叠比例 + RRF 加权（兜底排序用）。 */
export function heuristicScore(query: string, text: string, rrf: number): number {
  const q = tokenSet(query);
  if (q.size === 0) {
    return rrf;
  }
  const t = tokenSet(text);
  let overlap = 0;
  for (const word of q) {
    if (t.has(word)) overlap++;
  }
  return rrf + (overlap / q.size) * 0.5;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
