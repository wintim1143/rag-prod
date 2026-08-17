# 项目进度（PROGRESS）

> 更新时间：2026-08-17
> 自动化验证基线：`npm run typecheck` + `npm test`（128 用例，覆盖率门槛 ≥80%）
> 本文件记录：**已完成什么 / 可人工验证什么 / 依赖 LLM 什么**。切片明细见 `docs/tickets/`，路线图见 CLAUDE.md。

## 当前状态速览

| 切片 | 状态 | 依赖 LLM / 云 API 的部分 |
|---|---|---|
| 01 脚手架 + 配置中心 | done ✅ | 无 |
| 02 摄入管线 + `/ingest` | done ✅ | 无（向量化 = 本地 all-MiniLM-L6-v2，无需 key） |
| 03 混合检索 + 本地重排 | done ✅ | 无（重排 = 本地 cross-encoder ms-marco） |
| 04 问答/聊天（/ask /chat） | done ✅ | **是 — 云 chat LLM**（已配 opencode `deepseek-v4-flash`） |
| 05 知识库管理 API | done ✅ | 无 |
| 06 评估体系（LLM 判分 + 回归） | done ✅ | **是 — 云 chat LLM 判分**（judge 用同一 chat provider） |
| 07 检索诊断 | done ✅ | 无 |

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

### 05 知识库管理 API（done ✅）

- **完成**：`src/knowledge/`——`GET /documents`（全部文档 + 块数 + title/sourcePath/tenant）、`DELETE /documents/:docId`（删除全部块 + 重建 FTS）、`POST /documents/:docId/reindex`（按 sourcePath 重新摄入 = 原地更新旧块，不存在 404）；LanceDBStore 新增 `listDocuments/deleteDocument`；检索支持 `filter`（tenant/docId）下推到向量 + BM25 的 `.where()`；`ChunkRecord` 增加 `tenant` 列（摄入时写 `DEFAULT_TENANT`，默认 `default`）。
- **租户隔离强制**：`POST /search` 从 `X-Tenant` 请求头读租户（缺省 `DEFAULT_TENANT`），强制作为过滤条件下推——调用方无法发起不带租户范围的跨租户检索。
- **可人工验证**：`GET /documents` 列表；`DELETE /documents/<docId>` 删除后列表与检索均不含该文档；`POST /documents/<docId>/reindex` 重索引；`/search` 带 `X-Tenant: other-tenant` 无结果而默认租户有结果。
- **实测**：摄入 3 文档 → 列表 3 项（含 tenant）；删除 api.md → 4 块消失、列表剩 2；reindex 正常、不存在 docId 返回 404；default 租户检索 5 命中、other-tenant 0 命中。
- **LLM 依赖**：无（全部本地）。注意：表 schema 新增 tenant 列后，旧库需重建（删除 `data/lance` 后重新摄入）。

### 06 评估体系（done ✅）

- **完成**：`src/eval/`——评测集 33 条真实 Q&A（基于 data/sample 三篇文档，`expectedSources` 标注标准相关源，含库外问题）随仓库管理；四指标 LLM 判分（faithfulness / answer relevance / context precision / context recall，judge prompt 约束只输出 0-1，复用 chat provider）；回归运行器 `runVariant`（检索→生成→判分→聚合）+ `compareVariants`（跌破阈值判回归）；`npm run eval` 完整运行基线 + k 变体，输出可提交 JSON，有回归时非零退出。
- **可人工验证**：`npm run eval`（全量 ~396 次 LLM 判分，较慢）；`EVAL_MAX_SAMPLES=3 npm run eval` 冒烟。
- **实测**（3 样本 + 真实 judge）：baseline k3 → faithfulness 1.0 / relevance 1.0 / precision 0.2 / recall 1.0；k1 变体全面下滑，回归运行器正确报 k1 回归（faithfulness/relevance/recall）。context_precision 偏低符合预期（ms-marco 对中文区分弱）。
- **LLM 依赖**：是 —— judge 用同一云 chat LLM（`config.llm`）。离线测试用桩 provider（`tests/eval/*`，含 CI 冒烟子集）。

### 07 检索诊断（done ✅）

- **完成**：`SearchPipeline.trace()` 暴露 query 向量化维度、向量命中、BM25 命中、RRF 融合、重排候选及 top-k 的完整分数与来源；新增 `POST /trace`（强制租户过滤）和 `npm run diagnose -- "<query>"` CLI。
- **失败分类**：纯函数分类器输出 a–d 之一并附证据：知识库无内容、内容存在但未召回、召回后排在 top-k 之外、检索正常但问题转移到生成层；支持 `expected` chunkId 做精确召回/排名诊断，并提供无 expected 的启发式判断。
- **报告导出**：CLI 将完整 trace JSON 写入 `trace-results/trace-<timestamp>.json`，stdout 同时输出可读摘要与各环节 top 命中。
- **测试与验证**：覆盖空库、无命中、表达不匹配、召回后排太后、检索正常、租户过滤、端点参数传递和报告渲染；`npm run diagnose -- "Fastify 端口"` 已用真实本地 LanceDB/Embedding/Reranker 冒烟通过。
- **LLM 依赖**：无。

## 待办（frontier）

## LLM 依赖矩阵

| 功能 | 是否依赖 LLM / 云 API | 说明 |
|---|---|---|
| 配置校验 / `/health` | 否 | 纯本地 |
| 文档加载 / 切分 | 否 | unpdf / mammoth / cheerio，纯本地 |
| 向量化（摄入） | 否（默认） | Transformers.js + all-MiniLM-L6-v2 本地；`EMBEDDING_MODE=cloud` 时需云 key |
| 混合检索 / 重排 | 否 | 向量 + BM25（LanceDB）+ 本地 cross-encoder |
| 问答生成（04） | **是 — 云 chat LLM** | 需 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` |
| 知识库管理 / 租户过滤（05） | 否 | 纯本地 |
| 评估判分（06） | **是 — 云 chat LLM judge** | 复用 `config.llm`；离线测试用桩 |
| 检索诊断（07） | 否 | trace、失败分类与报告导出全部本地 |

## 人工验证清单（从零复现）

```bash
cp .env.example .env            # 无需填任何 key 即可验证 01-03/05（模型首次自动下载）
npm install
npm run typecheck
npm test                        # 105 用例 + 覆盖率门槛（mock 向量 / stub 重排 / 桩 judge）
npm run dev
curl http://127.0.0.1:3000/health
# 摄入（默认本地 embedding，无需 key）
curl -X POST http://127.0.0.1:3000/ingest -H 'Content-Type: application/json' \
  -d '{"path":"./data/sample"}'
# 检索（混合 + 重排，各环节分数可见；强制带默认租户过滤）
curl -X POST http://127.0.0.1:3000/search -H 'Content-Type: application/json' \
  -d '{"query":"Fastify 端口"}'
# 问答（04，需 LLM key）
curl -X POST http://127.0.0.1:3000/ask -H 'Content-Type: application/json' \
  -d '{"query":"摄入管线把文档写入哪里？"}'
# 知识库管理（05）
curl http://127.0.0.1:3000/documents
# 评估（06，需 LLM key 判分；EVAL_MAX_SAMPLES=3 冒烟）
EVAL_MAX_SAMPLES=3 npm run eval
```

## 备注

- **模型下载**：本地模型（all-MiniLM-L6-v2 ~90MB、ms-marco ~90MB）首次从 HF 下载，之后本地缓存离线可用；网络受限时设 `HF_ENDPOINT=https://hf-mirror.com`（`.env` 里建议加上）。
- **bge-reranker 不可用**：`Xenova/bge-reranker-*` 的 tokenizer 在 Transformers.js 有兼容 bug，故默认重排模型用 `Xenova/ms-marco-MiniLM-L-6-v2`（`RERANKER_MODEL` 可配）。
- 测试用 mock 向量 / stub 重排：无网络 / CI 环境全绿；真实验证（摄入落库 + 检索）也无需 key（本地模型）。
- `data/`（LanceDB 落盘、样例）与 `.env` 不提交。
- 每个已完成切片把 `docs/tickets/NN-*.md` 状态置为 `done ✅`，并在本文件同步。
