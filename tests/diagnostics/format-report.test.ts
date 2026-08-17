import { describe, expect, it } from 'vitest';
import { formatReport } from '../../src/diagnostics/report.js';
import type { TraceResponse } from '../../src/retrieval/types.js';

function sample(): TraceResponse {
  return {
    query: 'Fastify 端口',
    config: { n: 50, k: 5, tenant: 'default' },
    knowledgeBase: { totalChunks: 12, documents: 3 },
    queryVectorization: { dimensions: 384 },
    vectorRetrieval: { hits: [], count: 8 },
    bm25Retrieval: { hits: [], count: 3 },
    rrfFusion: { candidates: [], count: 8 },
    rerank: { status: 'cross-encoder', candidates: [], count: 8, topK: [] },
    diagnosis: {
      category: 'c',
      label: '召回了但排太后',
      evidence: ['证据一', '证据二'],
    },
  };
}

describe('formatReport — trace 报告渲染', () => {
  it('包含 query、配置、知识库统计与各环节命中数', () => {
    const report = formatReport(sample());
    expect(report).toContain('query: Fastify 端口');
    expect(report).toContain('n=50 k=5 tenant=default');
    expect(report).toContain('12 块 / 3 文档');
    expect(report).toContain('384 维');
    expect(report).toContain('向量检索: 8 条命中');
    expect(report).toContain('BM25 检索: 3 条命中');
    expect(report).toContain('RRF 融合: 8 个候选');
    expect(report).toContain('cross-encoder');
  });

  it('渲染诊断分类与证据链', () => {
    const report = formatReport(sample());
    expect(report).toContain('[c] 召回了但排太后');
    expect(report).toContain('- 证据一');
    expect(report).toContain('- 证据二');
  });
});
