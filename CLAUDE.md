# CLAUDE.md — rag-prod 会话上下文

> 面向在新项目目录里开工的 agent 的交接文档。新会话先读这份 + `docs/tickets/`，从 frontier（01）开始。

## 项目使命

把学习版 RAG demo（`D:\code\rag-roadmap\app`，手写、内存向量库、规则式生成）升级为**正式可用**的 RAG 知识库服务：成熟框架、持久化、真实 LLM、可评估可诊断。demo 代码不复用，仅作概念参考。

## 不可谈判的选型（2026-08-13 已确认）

- **LangChain.js + TypeScript**（Node ≥ 20）做编排
- **LanceDB 嵌入式**向量库（文件落盘、重启不丢、无独立服务进程）
- **云 OpenAI 兼容 API** 做 chat 与 embedding（baseURL 可配，兼容 DeepSeek 等）
- **本地 cross-encoder**（bge-reranker 家族，Transformers.js）做重排，启发式兜底
- **Fastify** 做 HTTP API；**Agentic + 流式**纳入本期（09）

## 架构与数据流

```
摄入:  文件 → 加载器(格式分派) → 标题感知切分 → 云Embedding → 写入 LanceDB(docId 维度)
检索:  query → (可选查询优化) → 混合检索(向量+BM25+RRF, N=50) → cross-encoder 重排 → top-k
生成:  检索块+引用 → LLM → 带 [编号] 引用回答
评估:  评测集 → LLM 判分(忠实度/相关性/上下文精度召回) → 跨配置回归表
```

## 配置契约

环境变量清单与说明见 `README.md`「环境变量」表。`src/config/` 负责读取与校验，启动时给出清晰报错。

## 路线图（9 条垂直切片，blockers 先行）

| # | 切片 | Blocked by | 状态 |
|---|---|---|---|
| 01 | 项目脚手架 + 配置中心（TS + Fastify + env 校验 + /health） | — | done ✅ (2026-08-13) |
| 02 | 摄入管线（加载→切分→Embedding→LanceDB + /ingest） | 01 | done ✅ (2026-08-13) |
| 03 | 混合检索 + 本地 cross-encoder 重排（/search 各环节分数） | 02 | **frontier，可开工** |
| 04 | 问答/聊天端点（真实生成 + 引用，/ask 与 /chat） | 03 | pending |
| 05 | 知识库管理 API（列表/删除/重索引/租户过滤） | 02 | pending |
| 06 | 评估体系（评测集 30+ + LLM 判分 + 回归对比） | 04 | pending |
| 07 | 检索诊断（单 query trace + 失败分类） | 03 | pending |
| 08 | 查询优化（多查询/HyDE/改写，评估证明召回提升） | 03, 06 | pending |
| 09 | Agentic + 流式聊天（检索作工具调用，与 04 可切换） | 04 | pending |

完成一条，把对应 `docs/tickets/NN-*.md` 的 `Status` 更新为 `done ✅ (日期)`，勾掉 acceptance。

## 开放问题（开工时定，不要重复调研）

- **09 号 agentic 层**：用 Vercel AI SDK，还是 LangChain 自身的 agent / langgraph（Node 版）？04 完成后再定，不影响依赖结构。
- **bge-reranker 的 ONNX 模型 id**：实现 03 时到 HF 实际核验（`BAAI/bge-reranker-base` 等，中文/多语可用版本以当时为准）。
- **测试运行器**：已定 vitest（2026-08-13），见 README「测试与类型检查」。
- **LLM 与 Embedding 是否同一 provider**：可由 env 配置（`EMBEDDING_BASE_URL` 缺省回落到 `LLM_BASE_URL`）。

## 约定

- 纯 TypeScript；公开函数/API 加显式类型（规则见 `~/.claude/rules/coding-style.md`）
- 生产代码无 `console.log`，用 logger
- commit 遵循 Conventional Commits；提交前 `npm test` 全绿
- 先读对应 ticket 的 acceptance 再动手；验收标准未满足不算完成

## 常用命令（01 已落地，随切片扩展）

```bash
npm run dev      # 起服务
npm test         # 跑测试
npm run eval     # 跑评估（06 落地后）
npm run ingest   # CLI 摄入（02 落地前可用）
```
