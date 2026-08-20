# rag-prod — 正式 RAG 知识库服务

基于成熟框架的**生产级 RAG 服务**：文档摄入 → 向量化 → 持久化检索 → 混合检索 + 重排 → LLM 生成，对外暴露 HTTP API。纯本地向量库、云 LLM，支持多文档管理与评估回归。

> 定位：不同于仓库内 `rag-demo`（教学、手写、内存库），本项目在独立目录用框架重搭，走正式工程。

## 技术栈

| 层 | 选型 |
|---|---|
| 编排框架 | LangChain.js（加载器 / 切分器 / retriever / LLM 抽象） |
| 服务端 | Fastify（TypeScript，Node ≥ 20） |
| 向量库 | LanceDB（嵌入式，文件落盘，进程重启不丢） |
| LLM | 云 OpenAI 兼容 API（环境变量可配 baseURL，支持 DeepSeek 等） |
| Embedding | 默认本地 Transformers.js（all-MiniLM-L6-v2），可切云 |
| 重排器 | 本地 cross-encoder（bge-reranker 家族，Transformers.js），启发式兜底 |
| 测试 | vitest（TS 原生，覆盖率门槛 ≥80%） |

## 快速开始

```bash
cp .env.example .env          # 填 LLM_API_KEY / EMBEDDING_API_KEY 等
npm install
npm run dev                   # 起服务，/health 可用
```

摄入一个文件或目录（需要有效的 Embedding API key）：

```bash
curl -X POST http://localhost:3000/ingest \
  -H 'Content-Type: application/json' \
  -d '{"path":"./data/sample"}'
```

## 测试与类型检查

```bash
npm test                      # 跑 vitest 测试
npm run test:coverage         # 覆盖率报告（≥80% 门槛）
npm run typecheck             # tsc --noEmit
```

## 环境变量（配置契约）

| 变量 | 用途 | 示例 |
|---|---|---|
| `LLM_BASE_URL` | chat 模型 API base | `https://api.deepseek.com/v1` |
| `LLM_API_KEY` | chat 模型密钥 | `sk-...` |
| `LLM_MODEL` | chat 模型 | `deepseek-chat` |
| `EMBEDDING_MODE` | 向量化方式：`local`（默认，Transformers.js）/ `cloud` | `local` |
| `HF_ENDPOINT` | 本地 embedding 模型下载源（可选；镜像如 `https://hf-mirror.com`） | `https://huggingface.co` |
| `EMBEDDING_BASE_URL` | cloud 模式 embedding base（可与 LLM 相同） | 同上 |
| `EMBEDDING_API_KEY` | cloud 模式 embedding 密钥 | `sk-...` |
| `EMBEDDING_MODEL` | cloud 模式 embedding 模型 | `text-embedding-3-small` |
| `LANCE_DB_PATH` | LanceDB 目录 | `./data/lance` |
| `INGEST_ROOT` | 限制 `/ingest` 可读的根目录（可选，默认不限制） | `./data` |
| `DEFAULT_TENANT` | 摄入块默认租户；`/search` 强制按此（或 `X-Tenant` 头）过滤（05） | `default` |
| `RERANKER_MODEL` | 本地 cross-encoder 模型 id（Transformers.js 可用版） | `Xenova/ms-marco-MiniLM-L-6-v2` |
| `PORT` | 服务端口 | `3000` |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 分块大小 / 重叠 | `800` / `100` |
| `RETRIEVAL_N` / `RETRIEVAL_K` | 粗筛候选数 / 精排后 top-k | `50` / `5` |
| `HYBRID` | 混合检索（向量 + BM25 + RRF）固定开启 | `true` |
| `QUERY_REWRITE` / `MULTI_QUERY` / `HYDE` | 查询优化开关（08） | `false` |
| `CHAT_MODE` | 聊天模式：`fixed` / `agentic` | `fixed` |
| `CHAT_STREAM` | `/chat` 是否以 SSE 流式返回 | `true` |
| `AGENT_MAX_STEPS` / `AGENT_TIMEOUT_MS` | Agent 资源限制 | `3` / `30000` |
| `EVAL_MAX_SAMPLES` | 评估最多跑多少条样本（`npm run eval`，冒烟用） | 全量 |

## 规划目录结构

```
rag-prod/
├── src/
│   ├── server/          # Fastify 应用与路由
│   ├── config/          # 环境变量加载与校验
│   ├── ingestion/       # 加载器、切分器、embedding、LanceDB 写入
│   ├── retrieval/       # 混合检索、RRF、重排器
│   ├── generation/      # LLM provider、prompt 组装、引用
│   ├── eval/            # 评测集、LLM 判分、回归运行器
│   ├── diagnostics/     # 单 query trace、失败分类
│   └── index.ts         # 入口
├── data/                # LanceDB、上传文件（gitignore）
├── tests/
├── docs/
│   ├── ingestion-flow.md  # 摄入流程说明（为何需要/不需要 LLM）
│   └── tickets/           # 9 条开发切片（依赖序）
├── README.md
├── CLAUDE.md
└── .env.example
```

## 主要 API（目标）

- `GET /health` — 健康检查
- `POST /ingest` — 摄入单文件或目录（**02 已实现**）；body `{ "path": "..." }`，返回 `{ ingested: [{docId, sourcePath, chunkCount}], failed: [...] }`
- `POST /search` — 混合检索 + 本地重排（**03 已实现**）；body `{ query, n?, k? }`，返回排序块与各环节分数（向量/BM25/RRF/重排）
- `POST /search` — 混合检索 + 重排（各环节分数可见）
- `POST /ask` — 单轮问答（**04 已实现**）；body `{ query, k? }`，返回带 `[编号]` 引用的回答与来源块
- `POST /chat` — 多轮对话（**04/09**）；`CHAT_STREAM=true` 时以 SSE 发送 `text_delta`、`sources`、`done` 或 `error` 事件；关闭时保留 JSON 兼容响应
- `GET /documents` — 文档列表（**05 已实现**）：全部文档 + 块数 + 元数据
- `DELETE /documents/:id` — 删除文档全部块（**05 已实现**）
- `POST /documents/:id/reindex` — 按源路径重索引（**05 已实现**）
- 评估：`npm run eval`（**06 已实现**）——评测集 33 条 + 四指标 LLM 判分 + 配置变体回归对比，产出 `eval-results/` JSON
- 诊断：trace 端点 / CLI（见 07）

## 文档索引

- [项目进度](docs/PROGRESS.md) — 已完成工作 / 可人工验证 / LLM 依赖矩阵
- [摄入流程说明](docs/ingestion-flow.md) — 解析支持哪些格式、是否需要 LLM
- [开发切片](docs/tickets/) — 9 条 tickets，按依赖序推进

## 相关

学习版 demo（内存向量库、手写实现）在 `D:\code\rag-roadmap\app`，本项目不复用其代码，仅作为概念参考。
