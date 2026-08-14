# 项目进度（PROGRESS）

> 更新时间：2026-08-14
> 自动化验证基线：`npm run typecheck` + `npm test`（78 用例，覆盖率门槛 ≥80%）
> 本文件记录：**已完成什么 / 可人工验证什么 / 依赖 LLM 什么**。切片明细见 `docs/tickets/`，路线图见 CLAUDE.md。

## 当前状态速览

| 切片 | 状态 | 依赖 LLM / 云 API 的部分 |
|---|---|---|
| 01 脚手架 + 配置中心 | done ✅ | 无 |
| 02 摄入管线 + `/ingest` | done ✅ | 无（向量化 = 本地 all-MiniLM-L6-v2，无需 key） |
| 03 混合检索 + 本地重排 | done ✅ | 无（重排 = 本地 cross-encoder ms-marco） |
| 04 问答/聊天（/ask /chat） | done ✅ | **是 — 云 chat LLM**（已配 opencode `deepseek-v4-flash`） |
| 05 知识库管理 API | **frontier（未开工）** | 无 |

## 已完成工作

### 01 项目脚手架 + 配置中心（done ✅）

- **完成**：Fastify 服务骨架；`src/config/` 从环境变量读取并校验全部配置，失败逐字段报错；`GET /health` 返回 200 + 配置栈摘要（不含密钥）。
- **可人工验证**：`npm run dev` → `/health` 200；`npm test`；缺 `LLM_API_KEY` 启动 → 清晰报错。
- **LLM 依赖**：无。

### 02 摄入管线 + `/ingest`（done ✅）

- **完成**：五格式加载器（txt/md/html/pdf/docx）；markdown 标题感知 + 代码块感知切分（`CHUNK_SIZE`/`CHUNK_OVERLAP` 可配）；**本地 Embedding**（Transformers.js + all-MiniLM-L6-v2，384 维，无需 key；`EMBEDDING_MODE=cloud` 可切云）；LanceDB 落盘（docId upsert，重复摄入=更新）；`POST /ingest` 返回 docId+块数。
- **可人工验证（无需 key）**：`npm test`；`POST /ingest {"path":"data/sample/intro.md"}` → 真实落库 `data/lance/`；重复摄入 → 更新；`INGEST_ROOT` 目录外路径 → failed。
- **LLM 依赖**：默认本地推理，无需任何云 key。

### 03 混合检索 + 本地重排（done ✅）

- **完成**：混合检索（向量 cosine + BM25 全文，`@lancedb/lancedb` FTS）→ RRF 融合（N 候选）→ **本地 cross-encoder 重排**（Transformers.js + ms-marco-MiniLM-L-6-v2，失败自动降级到启发式兜底）→ top-k；`POST /search` 返回排序块与**各环节分数**（vector/bm25/rrf/rerank）+ 来源引用；`RETRIEVAL_N`/`RETRIEVAL_K` 可配，请求体 `n/k` 可覆盖。
- **实测演示**（data/sample 3 文档 12 块）：
  - 「Fastify 端口」→ top1 API 服务（BM25 精确术语命中；cross-encoder 把 API 服务从 rrf#2 提到 #1，重排改变顺序）
  - 「把文本转成向量存到本地库做相似度检索」→ top1 摄入管线 > 向量化（向量语义匹配，BM25 无命中）
  - 各结果含 `scores.{vector,bm25,rrf,rerank}` 与 `stages.reranker`（`cross-encoder` / `fallback`）
- **可人工验证**：`POST /search {"query":"Fastify 端口"}` 等；改 `RETRIEVAL_N/K` 或 body `n/k` 观察候选/返回数变化。
- **已知限制**：ms-marco 是英文 cross-encoder，中文 query 区分较弱（分数趋近 0 但排序可用）；启发式兜底对中文词重叠有效。
- **LLM 依赖**：无（向量、FTS、重排全部本地）。

### 04 问答/聊天端点（done ✅）

- **完成**：`src/generation/`——OpenAI 兼容 `ChatProvider`（`@langchain/openai` ChatOpenAI，配置来自 `config.llm`）；prompt 组装把检索块编号为 `[1][2]…` 并强约束「只依据资料作答、未知时拒答」；`AnswerPipeline` 编排 检索→生成→引用解析；`POST /ask`（单轮）、`POST /chat`（多轮，短追问自动拼接上一轮 user 消息改写检索 query）。
- **可人工验证（需要 LLM key）**：`POST /ask {"query":"摄入管线把文档写入哪里？"}` → 回答带 `[1]` 引用；`POST /chat` 多轮短追问「写入哪里？」→ query 改写为「摄入管线 写入哪里？」；问库外问题 → 拒答「资料中没有相关内容」。
- **实测**（opencode `deepseek-v4-flash`）：
  - 「摄入管线把文档写入哪里？」→ `摄入管线将文档处理后写入 LanceDB 向量库。[1]`
  - 短追问改写生效：「写入哪里？」→「摄入管线 写入哪里？」→ 正确引用
  - 「健康检查端点是什么？」→ 拒答（检索 top3 未覆盖该句，诚实拒答而非编造）
- **LLM 依赖**：是 —— 云 chat LLM（`LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`）。离线测试用桩 provider（`tests/generation/*`）。

## 待办（frontier）

### 05 知识库管理 API

- 内容：文档级管理（列表/删除/重索引）+ 检索元数据过滤（tenant/docId，API 强制不可绕过）。
- LLM 依赖：无。

## LLM 依赖矩阵

| 功能 | 是否依赖 LLM / 云 API | 说明 |
|---|---|---|
| 配置校验 / `/health` | 否 | 纯本地 |
| 文档加载 / 切分 | 否 | unpdf / mammoth / cheerio，纯本地 |
| 向量化（摄入） | 否（默认） | Transformers.js + all-MiniLM-L6-v2 本地；`EMBEDDING_MODE=cloud` 时需云 key |
| 混合检索 / 重排 | 否 | 向量 + BM25（LanceDB）+ 本地 cross-encoder |
| 问答生成（04，未开工） | **是 — 云 chat LLM** | 需 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` |

## 人工验证清单（从零复现）

```bash
cp .env.example .env            # 无需填任何 key 即可验证 01-03（模型首次自动下载）
npm install
npm run typecheck
npm test                        # 57 用例 + 覆盖率门槛（mock 向量 / stub 重排）
npm run dev
curl http://127.0.0.1:3000/health
# 摄入（默认本地 embedding，无需 key）
curl -X POST http://127.0.0.1:3000/ingest -H 'Content-Type: application/json' \
  -d '{"path":"./data/sample"}'
# 检索（混合 + 重排，各环节分数可见）
curl -X POST http://127.0.0.1:3000/search -H 'Content-Type: application/json' \
  -d '{"query":"Fastify 端口"}'
```

## 备注

- **模型下载**：本地模型（all-MiniLM-L6-v2 ~90MB、ms-marco ~90MB）首次从 HF 下载，之后本地缓存离线可用；网络受限时设 `HF_ENDPOINT=https://hf-mirror.com`（`.env` 里建议加上）。
- **bge-reranker 不可用**：`Xenova/bge-reranker-*` 的 tokenizer 在 Transformers.js 有兼容 bug，故默认重排模型用 `Xenova/ms-marco-MiniLM-L-6-v2`（`RERANKER_MODEL` 可配）。
- 测试用 mock 向量 / stub 重排：无网络 / CI 环境全绿；真实验证（摄入落库 + 检索）也无需 key（本地模型）。
- `data/`（LanceDB 落盘、样例）与 `.env` 不提交。
- 每个已完成切片把 `docs/tickets/NN-*.md` 状态置为 `done ✅`，并在本文件同步。
