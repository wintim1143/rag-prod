import type { EvalSample } from './types.js';

/** 评测集：30+ 条真实 Q&A，基于 data/sample 三篇文档。expectedSources 标注标准相关源文件。 */
const S = {
  intro: 'data/sample/intro.md',
  api: 'data/sample/api.md',
  ingest: 'data/sample/ingestion.md',
} as const;

export const EVAL_DATASET: EvalSample[] = [
  // ---- intro.md：项目定位与技术栈 ----
  {
    id: 'q001',
    question: 'rag-prod 是基于什么框架搭建的 RAG 服务？',
    expectedSources: [S.intro],
    gold: 'LangChain.js',
  },
  {
    id: 'q002',
    question: 'rag-prod 的服务端框架是什么？',
    expectedSources: [S.intro],
    gold: 'Fastify',
  },
  {
    id: 'q003',
    question: 'rag-prod 使用的向量库是什么？',
    expectedSources: [S.intro],
    gold: 'LanceDB',
  },
  {
    id: 'q004',
    question: '与学习版 demo 相比，rag-prod 走的是什么路线？',
    expectedSources: [S.intro],
    gold: '正式工程路线',
  },
  {
    id: 'q005',
    question: 'rag-prod 的定位是什么？',
    expectedSources: [S.intro],
    gold: '正式 RAG 知识库服务',
  },

  // ---- api.md：HTTP 服务与端点 ----
  {
    id: 'q006',
    question: 'rag-prod 默认监听哪个端口？',
    expectedSources: [S.api],
    gold: '3000',
  },
  {
    id: 'q007',
    question: '健康检查的 HTTP 端点是什么？',
    expectedSources: [S.api],
    gold: 'GET /health',
  },
  {
    id: 'q008',
    question: '摄入文档用的 HTTP 端点是什么？',
    expectedSources: [S.api],
    gold: 'POST /ingest',
  },
  {
    id: 'q009',
    question: '执行混合检索的 HTTP 端点是什么？',
    expectedSources: [S.api],
    gold: 'POST /search',
  },
  {
    id: 'q010',
    question: 'GET /health 返回什么？',
    expectedSources: [S.api],
    gold: '服务状态与配置栈摘要',
  },
  {
    id: 'q011',
    question: 'POST /ingest 接收什么并返回什么？',
    expectedSources: [S.api],
    gold: '接收单个文件或目录，返回 docId 与块数',
  },
  {
    id: 'q012',
    question: 'POST /search 执行什么检索？',
    expectedSources: [S.api],
    gold: '混合检索与本地重排',
  },
  {
    id: 'q013',
    question: 'rag-prod 通过什么提供 HTTP API 服务？',
    expectedSources: [S.api],
    gold: 'Fastify',
  },

  // ---- ingestion.md：摄入管线 ----
  {
    id: 'q014',
    question: '摄入管线把文档处理成什么后写入哪里？',
    expectedSources: [S.ingest],
    gold: '加载、切分、向量化后写入 LanceDB 向量库',
  },
  {
    id: 'q015',
    question: '摄入支持哪几种文档格式？',
    expectedSources: [S.ingest],
    gold: 'TXT、Markdown、HTML、PDF、DOCX 五种',
  },
  {
    id: 'q016',
    question: '切分方式有什么特点？',
    expectedSources: [S.ingest],
    gold: '标题感知切分保留章节上下文，代码块不被切碎',
  },
  {
    id: 'q017',
    question: '本地向量化使用什么模型？',
    expectedSources: [S.ingest],
    gold: 'all-MiniLM-L6-v2',
  },
  {
    id: 'q018',
    question: '每个文本块被转成多少维的向量？',
    expectedSources: [S.ingest],
    gold: '384 维',
  },
  {
    id: 'q019',
    question: '向量化使用的模型是什么？',
    expectedSources: [S.ingest],
    gold: 'all-MiniLM-L6-v2',
  },
  {
    id: 'q020',
    question: '重复摄入同一文档会发生什么？',
    expectedSources: [S.ingest],
    gold: '按 docId upsert，是更新而非重复插入',
  },
  {
    id: 'q021',
    question: '按什么维度对块进行 upsert？',
    expectedSources: [S.ingest],
    gold: 'docId',
  },
  {
    id: 'q022',
    question: '摄入管线包含哪些阶段？',
    expectedSources: [S.ingest],
    gold: '加载、切分、向量化、落库',
  },
  {
    id: 'q023',
    question: '文档加载阶段支持哪些格式？',
    expectedSources: [S.ingest],
    gold: 'TXT、Markdown、HTML、PDF、DOCX',
  },
  {
    id: 'q024',
    question: '切分阶段如何保留上下文？',
    expectedSources: [S.ingest],
    gold: '标题感知切分保留章节上下文',
  },

  // ---- 跨文档：组合 / 对比 ----
  {
    id: 'q025',
    question: 'rag-prod 中负责向量化的组件与负责生成回答的组件分别是什么？',
    expectedSources: [S.ingest, S.api],
  },
  {
    id: 'q026',
    question: '项目技术栈包含哪些关键组件？',
    expectedSources: [S.intro],
    gold: 'LangChain.js、Fastify、LanceDB',
  },
  {
    id: 'q027',
    question: '摄入和检索各通过哪个端点暴露？',
    expectedSources: [S.api],
    gold: 'POST /ingest 与 POST /search',
  },

  // ---- 库外问题：应判 relevance 低 / 拒答 ----
  {
    id: 'q028',
    question: 'rag-prod 如何实现用户登录认证？',
    expectedSources: [],
  },
  {
    id: 'q029',
    question: '部署到生产需要多少台服务器？',
    expectedSources: [],
  },
  {
    id: 'q030',
    question: '支持哪些数据库的高可用方案？',
    expectedSources: [],
  },
  {
    id: 'q031',
    question: '如何配置负载均衡？',
    expectedSources: [],
  },
  {
    id: 'q032',
    question: 'rag-prod 的收费标准是什么？',
    expectedSources: [],
  },
  {
    id: 'q033',
    question: '有哪些内置的监控告警功能？',
    expectedSources: [],
  },
];
