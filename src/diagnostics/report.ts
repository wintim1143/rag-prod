import type { TraceResponse } from '../retrieval/types.js';

/** 把 trace 渲染为可读报告（stdout 与写入文件共用）。 */
export function formatReport(t: TraceResponse): string {
  const lines: string[] = [];
  lines.push('=== 检索诊断 trace ===');
  lines.push(`query: ${t.query}`);
  lines.push(`config: n=${t.config.n} k=${t.config.k} tenant=${t.config.tenant}`);
  lines.push(`知识库: ${t.knowledgeBase.totalChunks} 块 / ${t.knowledgeBase.documents} 文档`);
  lines.push('');
  lines.push(`[1] query 向量化: ${t.queryVectorization.dimensions} 维`);
  lines.push(`[2] 向量检索: ${t.vectorRetrieval.count} 条命中`);
  lines.push(`[3] BM25 检索: ${t.bm25Retrieval.count} 条命中`);
  lines.push(`[4] RRF 融合: ${t.rrfFusion.count} 个候选`);
  lines.push(`[5] 重排 (${t.rerank.status}): top-${t.config.k}`);
  lines.push('');
  lines.push(`诊断: [${t.diagnosis.category}] ${t.diagnosis.label}`);
  for (const e of t.diagnosis.evidence) lines.push(`  - ${e}`);
  return lines.join('\n');
}
