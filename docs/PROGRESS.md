# 项目进度（PROGRESS）

> 更新时间：2026-08-13
> 自动化验证基线：`npm run typecheck` + `npm test`（45 用例，覆盖率门槛 ≥80%）
> 本文件记录：**已完成什么 / 可人工验证什么 / 依赖 LLM 什么**。切片明细见 `docs/tickets/`，路线图见 CLAUDE.md。

## 当前状态速览

| 切片 | 状态 | 依赖 LLM / 云 API 的部分 |
|---|---|---|
| 01 脚手架 + 配置中心 | done ✅ | 无 |
| 02 摄入管线 + `/ingest` | done ✅ | 向量化（需 Embedding API key） |
| 03 混合检索 + 本地重排 | **frontier（未开工）** | 无（重排用本地 cross-encoder） |
| 04+ | pending | 04 问答生成需 chat LLM |

## 已完成工作

### 01 项目脚手架 + 配置中心（done ✅）

- **完成**：Fastify 服务骨架；`src/config/` 从环境变量读取并校验全部 provider 配置（LLM/Embedding/LanceDB/重排器/端口/分块/`INGEST_ROOT`），失败逐字段报错；`GET /health` 返回 200 + 配置栈摘要（不含密钥）。
- **可人工验证**：
  - `npm run dev` → 访问 `http://127.0.0.1:3000/health` 返回 200 与栈摘要
  - `npm test` → 配置校验 + health 用例
  - 故意清空 `LLM_API_KEY` 后 `npm run dev` → 启动即打印清晰报错并退出（而非带错运行）
- **LLM 依赖**：无。

### 02 摄入管线 + `/ingest`（done ✅）

- **完成**：五格式加载器（txt/md/html/pdf/docx，unpdf/mammoth/cheerio）；markdown 标题感知（章节路径）+ 代码块感知切分 + 递归字符切分（`CHUNK_SIZE`/`CHUNK_OVERLAP` 可配）；云 Embedding 向量化（`@langchain/openai`）；LanceDB 落盘（`docId` 维度 upsert，重复摄入 = 更新）；`POST /ingest` 接受单文件或目录，返回 `{ingested:[{docId,sourcePath,chunkCount}], failed:[...]}`。
- **可人工验证（无需 key）**：
  - `npm test` → 45 用例全绿（测试用 mock 向量，不调云 API）
  - `curl -X POST .../ingest -d '{"path":"<不存在路径>"}'` → 返回 `failed` 而非 500
  - `curl -X POST .../ingest -d '{"path":"<某文件>"}'` → 无 key 时返回 `failed`（embedder 认证错误，属预期）
- **可人工验证（需 Embedding key）**：
  - 在 `.env` 填真实 `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` → `POST /ingest` 真实文件 → 返回 `ingested:[{docId, chunkCount}]`，`data/lance/` 生成落盘；重启服务后数据仍在（可用 03 的检索验证）
  - 设置 `INGEST_ROOT` 后摄入目录外路径 → 返回 `failed`（路径越界被拒）
- **LLM 依赖**：**向量化必须调用云 Embedding API**；加载 / 切分 / 落盘不依赖任何 LLM。

## 待办（frontier）

### 03 混合检索 + 本地 cross-encoder 重排（`/search`）

- 内容：向量检索 + BM25 + RRF 混合（N=50）→ 本地 cross-encoder 重排 → top-k；`/search` 返回各环节分数。
- 需要人工确认：bge-reranker 的 HF 模型 id（CLAUDE.md 开放问题，实现时核验）。
- LLM 依赖：检索与重排均不依赖云 LLM（重排用本地 Transformers.js 模型）。

## LLM 依赖矩阵

| 功能 | 是否依赖 LLM / 云 API | 说明 |
|---|---|---|
| 配置校验 / `/health` | 否 | 纯本地 |
| 文档加载 / 切分 | 否 | unpdf / mammoth / cheerio，纯本地 |
| 向量化（摄入） | **是 — 云 Embedding** | 需 `EMBEDDING_BASE_URL/API_KEY/MODEL` |
| 混合检索 / 重排（03，未开工） | 否 | 重排用本地 cross-encoder |
| 问答生成（04，未开工） | **是 — 云 chat LLM** | 需 `LLM_BASE_URL/API_KEY/MODEL` |

## 人工验证清单（从零复现）

```bash
cp .env.example .env            # 无 key 也可跑通除「真实摄入」外的全部
npm install
npm run typecheck               # tsc，覆盖 src + tests
npm test                        # 45 用例 + 覆盖率门槛（mock 向量，不调云）
npm run dev                     # 起服务
curl http://127.0.0.1:3000/health
# 真实摄入（需先填 .env 的 EMBEDDING_*）
curl -X POST http://127.0.0.1:3000/ingest -H 'Content-Type: application/json' \
  -d '{"path":"./data/sample"}'
```

## 备注

- 测试默认用 mock 向量：无 key / CI 环境全绿；只有「真实摄入」这一步才需要云 key。
- `data/`（LanceDB 落盘、上传样例）与 `.env` 不提交。
- 每个已完成切片把 `docs/tickets/NN-*.md` 状态置为 `done ✅`，并在本文件同步。
