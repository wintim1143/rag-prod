/**
 * 检索失败分类器（纯函数）：对一条 query 的 trace 信号，判断检索质量问题归属 a–d：
 * - a) 知识库本无此内容（空库 / query 词在库中不存在）
 * - b) 有内容但没召回（分块 / Embedding / query 表达不匹配）
 * - c) 召回了但排太后（k 截断 / 重排问题）
 * - d) 检索正常，若答案错则属生成 / Prompt 层
 *
 * 输入均为 trace 服务已计算好的聚合信号（保持纯函数、可独立测试）。
 * expected 是诊断者提供的「期望命中块」，可给出最精确的召回 / 排名判定；
 * 无 expected 时退化为启发式（两路命中一致性、rerank 断层）。
 */

export type FailureCategory = 'a' | 'b' | 'c' | 'd';

export interface Diagnosis {
  category: FailureCategory;
  /** 人类可读的一句话结论。 */
  label: string;
  /** 证据链（如「BM25 命中但向量未命中 ⇒ Embedding/query 不匹配」）。 */
  evidence: string[];
}

export interface ClassifierInput {
  /** 当前租户下知识库总块数。 */
  totalChunks: number;
  /** 向量检索命中数。 */
  vectorHitCount: number;
  /** BM25 全文检索命中数。 */
  bm25HitCount: number;
  /** RRF 融合后进入重排的候选数。 */
  candidateCount: number;
  /** 返回的 top-k。 */
  topK: number;
  /** query 的任一 token 是否在库文本中出现（trace 服务扫库得出）。 */
  queryTokensInCorpus: boolean;
  /** 诊断者提示的期望命中块 chunkId。 */
  expected?: string[];
  /** 重排后候选的 chunkId（顺序 = 重排后的排名序）。 */
  candidateIds?: string[];
  /** top-k 内最低 rerank 分。 */
  topKMinRerankScore?: number;
  /** 第 k+1 名候选的 rerank 分（截断处）。 */
  nextRerankScore?: number;
}

/** 分类标签。 */
const LABELS: Record<FailureCategory, string> = {
  a: '知识库本无此内容',
  b: '有内容但没召回',
  c: '召回了但排太后',
  d: '检索正常（若答案错属生成层）',
};

export function classifyDiagnosis(input: ClassifierInput): Diagnosis {
  const { totalChunks, vectorHitCount, bm25HitCount, candidateCount, topK } = input;
  // ---- a: 知识库为空 ----
  if (totalChunks === 0) {
    return {
      category: 'a',
      label: LABELS.a,
      evidence: [`知识库为空（totalChunks=0），query 无任何块可命中`],
    };
  }

  // ---- 无候选 ----
  if (vectorHitCount === 0 && bm25HitCount === 0) {
    if (!input.queryTokensInCorpus) {
      return {
        category: 'a',
        label: LABELS.a,
        evidence: [`向量与 BM25 均无命中，且 query 词在库文本中不存在 ⇒ 知识库本无此内容`],
      };
    }
    return {
      category: 'b',
      label: LABELS.b,
      evidence: [
        `知识库含 query 相关词（queryTokensInCorpus=true）但两路检索均无命中 ⇒ 分块/Embedding/query 表达不匹配`,
      ],
    };
  }

  // ---- 有候选 + 提供 expected：精确判定召回与排名 ----
  if (input.expected && input.expected.length > 0) {
    const ranked = input.candidateIds ?? [];
    const hitExpected = input.expected.filter((id) => ranked.includes(id));
    if (hitExpected.length === 0) {
      return {
        category: 'b',
        label: LABELS.b,
        evidence: [`期望命中 ${input.expected.join('、')} 未出现在 ${candidateCount} 个候选中 ⇒ 没召回`],
      };
    }
    const topRanked = new Set(ranked.slice(0, topK));
    const notInTopK = hitExpected.find((id) => !topRanked.has(id));
    if (notInTopK) {
      const rank = ranked.indexOf(notInTopK) + 1;
      return {
        category: 'c',
        label: LABELS.c,
        evidence: [`期望块 ${notInTopK} 在候选排名第 ${rank}，超过 top-${topK} ⇒ 召回了但排太后（k/重排问题）`],
      };
    }
    return {
      category: 'd',
      label: LABELS.d,
      evidence: [`期望块 ${hitExpected.join('、')} 均在 top-${topK} 内，检索各环节无异常`],
    };
  }

  // ---- 无 expected：启发式 ----
  if (
    input.nextRerankScore !== undefined &&
    input.topKMinRerankScore !== undefined &&
    input.nextRerankScore > input.topKMinRerankScore
  ) {
    return {
      category: 'c',
      label: LABELS.c,
      evidence: [
        `第 ${topK + 1} 名候选 rerank 分 ${input.nextRerankScore} 高于 top-${topK} 内最低分 ${input.topKMinRerankScore} ⇒ k 截断/重排可能漏排`,
      ],
    };
  }

  if (vectorHitCount === 0 || bm25HitCount === 0) {
    return {
      category: 'b',
      label: LABELS.b,
      evidence: [
        `向量命中 ${vectorHitCount}、BM25 命中 ${bm25HitCount} 严重不一致 ⇒ query 与库内表达用词不同，Embedding/表达不匹配`,
      ],
    };
  }

  return {
    category: 'd',
    label: LABELS.d,
    evidence: ['向量与 BM25 均有命中、重排无断层 ⇒ 检索环节健康'],
  };
}

/**
 * 提取 query 的检索相关 token：ASCII 词（≥2 字符）+ CJK 连续串的 bigram。
 * bigram 避免单字虚词（的/了/是）作为覆盖信号；极短单字中文仍保留（如「价」「询」）。
 */
export function queryTokens(query: string): string[] {
  const ascii = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 2);
  const cjkRuns = query.match(/[一-鿿]+/g) ?? [];
  const cjk: string[] = [];
  for (const run of cjkRuns) {
    if (run.length >= 2) {
      for (let i = 0; i < run.length - 1; i++) cjk.push(run.slice(i, i + 2));
    } else {
      cjk.push(run);
    }
  }
  return [...ascii, ...cjk];
}
