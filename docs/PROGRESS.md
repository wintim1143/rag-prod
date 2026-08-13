# 项目进度（PROGRESS）

> 更新时间：2026-08-13
> 自动化验证基线：`npm run typecheck` + `npm test`（46 用例，覆盖率门槛 ≥80%）
> 本文件记录：**已完成什么 / 可人工验证什么 / 依赖 LLM 什么**。切片明细见 `docs/tickets/`，路线图见 CLAUDE.md。

## 当前状态速览

| 切片 | 状态 | 依赖 LLM / 云 API 的部分 |
|---|---|---|
| 01 脚手架 + 配置中心 | done ✅ | 无 |
| 02 摄入管线 + `/ingest` | done ✅ | 无（向量化 = 本地 all-MiniLM-L6-v2，无需 key） |
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

- **完成**：五格式加载器（txt/md/html/pdf/docx，unpdf/mammoth/cheerio）；markdown 标题感知（章节路径）+ 代码块感知切分 + 递归字符切分（`CHUNK_SIZE`/`CHUNK_OVERLAP` 可配）；**本地 Embedding 向量化**（Transformers.js + all-MiniLM-L6-v2，384 维，默认无需任何 key；可切云 `EMBEDDING_MODE=cloud`）；LanceDB 落盘（`docId` 维度 upsert，重复摄入 = 更新）；`POST /ingest` 接受单文件或目录，返回 `{ingested:[{docId,sourcePath,chunkCount}], failed:[...]}`。
- **可人工验证（无需任何 key）**：
  - `npm test` → 46 用例全绿（测试用 mock 向量，不调云也不下载模型）
  - `curl -X POST .../ingest -d '{"path":"data/sample/intro.md"}'` → 返回 `ingested:[{docId, chunkCount:3}]`，`data/lance/chunks.lance/` 真实落盘；重复摄入同一文件 → 更新而非重复
  - 首次摄入会从 Hugging Face 下载模型（~90MB，一次后本地缓存）；网络受限时设 `HF_ENDPOINT=https://hf-mirror.com`
  - `curl -X POST .../ingest -d '{"path":"<不存在路径>"}'` → 返回 `failed` 而非 500
  - 设置 `INGEST_ROOT` 后摄入目录外路径 → 返回 `failed`
- **可人工验证（cloud 模式，需 key）**：设 `EMBEDDING_MODE=cloud` 并填 `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` → 同一摄入走云 embedding。
- **LLM 依赖**：默认本地推理，**不依赖任何云 API / key**；`EMBEDDING_MODE=cloud` 时才依赖云 Embedding。

## 待办（frontier）

### 03 混合检索 + 本地 cross-encoder 重排（`/search`）

- 内容：向量检索 + BM25 + RRF 混合（N=50）→ 本地 cross-encoder 重排 → top-k；`/search` 返回各环节分数。
- 需要人工确认：bge-reranker 的 HF 模型 id（CLAUDE.md 开放问题，实现时核验；网络受限时经 `HF_ENDPOINT` 镜像下载）。
- LLM 依赖：检索与重排均不依赖云 LLM（重排用本地 Transformers.js 模型）。

## LLM 依赖矩阵

| 功能 | 是否依赖 LLM / 云 API | 说明 |
|---|---|---|
| 配置校验 / `/health` | 否 | 纯本地 |
| 文档加载 / 切分 | 否 | unpdf / mammoth / cheerio，纯本地 |
| 向量化（摄入） | 否（默认） | Transformers.js + all-MiniLM-L6-v2 本地推理；`EMBEDDING_MODE=cloud` 时需云 key |
| 混合检索 / 重排（03，未开工） | 否 | 重排用本地 cross-encoder |
| 问答生成（04，未开工） | **是 — 云 chat LLM** | 需 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` |

## 人工验证清单（从零复现）

```bash
cp .env.example .env            # 无需填任何 key 即可完整验证 02
npm install
npm run typecheck
npm test                        # 46 用例 + 覆盖率门槛（mock 向量）
npm run dev
curl http://127.0.0.1:3000/health
# 本地摄入真实落库（默认模式，无需 key；首次自动下载模型）
curl -X POST http://127.0.0.1:3000/ingest -H 'Content-Type: application/json' \
  -d '{"path":"./data/sample"}'
```

## 备注

- 测试默认用 mock 向量：无网络 / CI 环境全绿；真实验证（摄入落库）现在也无需 key（本地模型）。
- 本地模型首次需联网下载（可用 `HF_ENDPOINT` 指到镜像），之后缓存离线可用。
- `data/`（LanceDB 落盘、上传样例）与 `.env` 不提交。
- 每个已完成切片把 `docs/tickets/NN-*.md` 状态置为 `done ✅`，并在本文件同步。
