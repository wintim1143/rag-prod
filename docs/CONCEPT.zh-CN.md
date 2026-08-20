# rag-prod — 生产级 RAG 知识库服务 · 概念总览

## 目录

1. [什么是 RAG？](#什么是-rag)
2. [项目使命](#项目使命)
3. [技术选型与理由](#技术选型与理由)
4. [四段数据流](#四段数据流)
5. [检索管线详解](#检索管线详解)
6. [生成管线详解](#生成管线详解)
7. [评估体系](#评估体系)
8. [配置契约](#配置契约)
9. [租户隔离](#租户隔离)
10. [查询优化策略](#查询优化策略)
11. [Agentic 聊天](#agentic-聊天)
12. [常见问题](#常见问题)

---

## 什么是 RAG？

**RAG**（Retrieval-Augmented Generation，检索增强生成）是一种在回答问题前先搜索知识库、再把检索到的资料交给 AI 生成答案的技术模式。

### 开卷考试类比

| 闭卷考试（传统 LLM） | 开卷考试（RAG） |
|---|---|
| 只能用背下来的东西 | 可以在课本里查资料 |
| 不知道就猜 | 翻书找答案 |
| 局限于训练数据 | 能访问所有可用信息 |

### RAG 的黄金三步骤

```
用户提问
    ↓
① 检索：在知识库中找到相关资料
    ↓
② 增强：把资料 + 问题组装成 prompt
    ↓
③ 生成：LLM 基于资料给出带引用的答案
```

### 为什么 RAG 重要

**没有 RAG：**
```
你："我们公司的退款政策是什么？"
AI："我不了解你们公司的具体政策，但通常……" ← 编造通用答案
```

**有 RAG：**
```
你："我们公司的退款政策是什么？"
系统：[搜索公司文档]
      [找到《退款政策 V3.2》文档]
AI："根据公司政策，凭收据可在 30 天内退货……" ← 真实、准确、可溯源
```

---

## 项目使命

把学习版 RAG demo（手写、内存向量库、规则式生成）升级为**正式可用**的 RAG 知识库服务：成熟框架、持久化、真实 LLM、可评估可诊断。

### 核心能力一览

```
摄入   →   检索   →   生成   →   评估
文档    混合搜索     LLM 回答     LLM 判分
向量化   重排        引用标注     回归对比
持久化   诊断                   成本追踪
```

### 九条开发切片

项目按 9 条垂直切片推进，每条切片独立可交付：

| # | 切片 | 核心交付 |
|---|------|----------|
| 01 | 项目脚手架 | Fastify 服务 + 配置中心 + /health |
| 02 | 摄入管线 | 文件加载 → 切分 → Embedding → LanceDB |
| 03 | 混合检索 | 向量检索 + BM25 + RRF + cross-encoder 重排 |
| 04 | 问答/聊天 | LLM 生成 + 编号引用 + /ask 与 /chat |
| 05 | 知识库管理 | 文档列表/删除/重索引 + 租户过滤 |
| 06 | 评估体系 | 评测集 33 条 + 四指标 LLM 判分 + 回归对比 |
| 07 | 检索诊断 | 单 query trace + 失败分类 |
| 08 | 查询优化 | 改写 / 多查询 / HyDE + 召回证明 |
| 09 | Agentic + 流式 | SSE 流式输出 + 多步 agent 工具循环 |

---

## 技术选型与理由

### 不可谈判的选型（已确认）

| 层 | 选型 | 为什么 |
|---|---|---|
| 编排框架 | **LangChain.js** | 业界标准，加载器/切分器/LLM 抽象开箱即用 |
| 服务端 | **Fastify** | 高性能 TypeScript HTTP 框架，插件体系成熟 |
| 向量库 | **LanceDB** | 嵌入式（无独立服务），文件落盘，进程重启不丢 |
| LLM | **OpenAI 兼容 API** | baseURL 可配，兼容 DeepSeek 等，不锁定供应商 |
| Embedding | **Transformers.js**（默认本地） | 零云依赖，all-MiniLM-L6-v2 384 维，可切云 |
| 重排器 | **本地 cross-encoder** | Transformers.js 加载，私密快速，启发式兜底 |
| 测试 | **Vitest** | TS 原生，快速，覆盖率门槛 ≥ 80% |

### 为什么不用……

**为什么不用内存向量库？** 进程重启数据丢失，不支持过滤和 BM25 全文检索。

**为什么不用独立向量数据库服务（如 Qdrant、Milvus）？** 增加运维复杂度，中小规模部署 LanceDB 嵌入式即可满足。

**为什么不用 LangChain 的 agent / langgraph？** 当前 agentic 模式通过手工编排 tool loop 实现，保持对底层控制的透明性，未来可升级。

**为什么默认本地 Embedding？** 让开发者无需任何云 key 即可完成 01-03/05 的本地验证，降低上手门槛。

---

## 四段数据流

### 1. 摄入流程（Ingestion）

```
文件 → 加载器(格式分派) → 标题感知切分 → Embedding → LanceDB
```

**支持的格式：** TXT、Markdown、HTML、PDF、DOCX

**加载器分派逻辑：**

```javascript
import { loadDocument } from './ingestion/loaders/index.js';
// 自动按扩展名分派：
// .md → MarkdownLoader
// .pdf → PDFLoader
// .docx → DocxLoader
// .html → HtmlLoader
// 其他 → TextLoader
```

**切分策略：** 标题感知切分，按 Markdown 标题链保留章节路径，chunkSize 默认 800 字符，chunkOverlap 100 字符。

**Embedding：** 默认本地 Transformers.js（all-MiniLM-L6-v2，384 维），可切云（`EMBEDDING_MODE=cloud`）。

**落库：** 按 docId 维度 upsert——重复摄入同一路径 = 更新而非重复。

### 2. 检索流程（Retrieval）

```
用户 query → (可选查询优化) → 混合检索(向量+BM25) → RRF 融合 → cross-encoder 重排 → top-k
```

这是整个系统的核心，后面有单独一节详解。

### 3. 生成流程（Generation）

```
检索结果 → 组装 prompt(system + 历史 + 编号资料) → LLM 生成 → 解析引用 → 返回 AnswerResult
```

### 4. 评估流程（Evaluation）

```
评测集(33条) → 对每个变体执行检索+生成 → LLM 判分(四指标) → 聚合平均分 → 回归对比
```

---

## 检索管线详解

### 为什么需要混合检索？

**单独向量检索**能理解语义，但遇到精确术语（如 SKU 编码、产品名）时效果差。

**单独 BM25 全文检索**能精确匹配关键词，但无法理解同义词和上下文。

**混合检索 = 两者兼顾。**

```
query: "Fastify 的端口是什么？"

向量检索：理解 "Fastify" 是一个框架，"端口" 是 port
BM25 检索：精确匹配 "Fastify" 和 "端口" 这两个词

RRF 融合：把两路结果按排名得分融合，取交集增强、取并集覆盖
```

### 检索管线架构

```
                           ┌─────────────────────┐
                           │   QueryOptimizer     │
                           │   (可选)             │
                           │   - 改写             │
                           │   - 多查询            │
                           │   - HyDE             │
                           └─────────┬───────────┘
                                     │ 优化后的 query(s)
                                     ▼
┌──────────────────────────────────────────────────────────────┐
│                    SearchPipeline.runStages()                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  query → Embedder.embedTexts → 向量                          │
│       ↘                    ↗                                 │
│         LanceDBStore.vectorSearch (cosine)                   │
│         LanceDBStore.ftsSearch (BM25, tantivy)              │
│              ↓                                               │
│          rrfMerge(vectorHits, ftsHits)                       │
│              ↓                                               │
│          Reranker.rerank (cross-encoder / 启发式兜底)         │
│              ↓                                               │
│          slice top-k  →  SearchResponse                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### RRF（Reciprocal Rank Fusion）

RRF 是混合检索中融合两路结果的关键算法，公式很简单：

```
RRF_score = 1 / (k + rank)
```

其中 k 是常数（默认为 60），rank 是文档在该路的排名。

**示例：**

```
doc_A 在向量检索排第 1 → RRF 贡献 = 1/(60+1) ≈ 0.0164
doc_A 在 BM25 检索排第 3 → RRF 贡献 = 1/(60+3) ≈ 0.0159
总 RRF 得分 = 0.0323
```

**跨多查询 RRF 融合：** 当启用了查询优化（多查询、HyDE），每个变体 query 都会产生自己的 vector/BM25 候选，系统会按 `chunkId` 累加所有 query 的所有 lane 的 RRF 贡献，并保留 provenance（来源信息）。

### 重排器（Reranker）

重排器使用 cross-encoder 模型对 RRF 融合后的候选重新打分：

- **正常运行：** 使用本地 cross-encoder（`Xenova/ms-marco-MiniLM-L-6-v2`）对候选逐一评分。
- **降级兜底：** 如果模型加载失败或推理出错，自动降级到启发式分数（基于 query 和候选的词重叠率），并标记 `status: 'fallback'`，后续请求持续保持回退状态。

### 诊断（Trace）

`/trace` 端点暴露检索管线每个环节的完整中间产物：

```
queryVectorization → vectorRetrieval → bm25Retrieval → rrfFusion → rerank → topK
```

每个环节包含命中数、分数和具体内容。诊断还包含失败分类：

| 诊断码 | 含义 |
|--------|------|
| a | 知识库为空或 query 词不在库中 |
| b | 有内容但没召回（表达不匹配） |
| c | 召回了但排太后（超过 top-k） |
| d | 检索正常（答案错属生成层） |

---

## 生成管线详解

### 固定模式（Fixed）

```
用户消息 → rewriteQuery（改写：短追问拼接上下文）
         → search.search（检索）
         → 组装 prompt（system + 历史 + 编号资料）
         → LLM.generate（生成）
         → parseCitations（解析 [编号] 引用）
         → AnswerResult
```

**改写策略：** 如果最后一条 user 消息很短（≤ 3 个词），拼接上一条 user 消息以保持上下文。

**System prompt 核心指令：** 依据给定资料作答，无法回答时坦诚拒答，使用 [编号] 标注来源。

### Agentic 模式

```
用户消息 → chooseToolQuery（planner 决策）
         ├─ NO_SEARCH → 直接生成回答（无需检索）
         └─ SEARCH(query) → 工具调用 → 结果回填 → 再决策
                            └─ 循环，直到 maxSteps 或 no_search
                            └─ 最终生成回答
```

Agentic 模式受 **maxSteps**（默认 3）和 **timeoutMs**（默认 30000）限制，确保资源可控。

### 流式输出（SSE）

当 `CHAT_STREAM=true` 且请求头包含 `Accept: text/event-stream` 时，`/chat` 以 SSE 事件流输出：

```
event: text_delta
data: {"type":"text_delta","text":"根据"}

event: text_delta
data: {"type":"text_delta","text":"文档"}

event: sources
data: {"type":"sources","chunks":[...]}

event: done
data: {"type":"done","result":{...}}
```

Agentic 模式还会输出：

```
event: tool_start
data: {"type":"tool_start","step":1,"query":"Fastify 端口"}

event: tool_result
data: {"type":"tool_result","step":1,"query":"Fastify 端口","resultCount":3}
```

### 引用标注

LLM 生成回答时使用 `[编号]` 引用来源，系统自动解析：

```
回答："Fastify 默认端口是 3000 [1]，健康检查路径是 /health [2]。"

citations: [
  { index: 1, chunkId: "xxx", title: "Fastify 配置", ... },
  { index: 2, chunkId: "yyy", title: "健康检查", ... }
]
```

---

## 评估体系

### 评测集

33 条评测样本，覆盖：

- 库内问题（有标准答案和期望来源）
- 库外问题（expectedSources 为空，验证拒答能力）
- 多文档综合问题
- 不同文档格式的问题

### 四指标判分

每个变体在每个样本上由 LLM judge 逐项评分（0-1）：

| 指标 | 中文 | 测量什么 |
|------|------|----------|
| faithfulness | 忠实度 | 回答是否基于给定资料，不编造 |
| answer_relevance | 答案相关性 | 回答是否直接回应问题 |
| context_precision | 上下文精确度 | 检索到的资料中相关比例 |
| context_recall | 上下文召回率 | 所有相关资料中被检索到的比例 |

### 查询优化指标（08 新增）

每个变体还会记录：

- **recall@k**：命中期望源的比例
- **MRR**（Mean Reciprocal Rank）：首个期望源排名的倒数
- **llmCalls**：查询优化产生的 LLM 调用次数
- **optimizationLatencyMs**：优化耗时
- **emptyRate**：空结果率

### 回归对比

```
baseline（优化关） vs 变体（rewrite / multi-query / hyde）
阈值 0.05，跌破即判定回归
输出 JSON 到 eval-results/<timestamp>.json
```

---

## 配置契约

### 配置中心架构

```
.env / 环境变量
    ↓
zod schema 校验
    ↓
resolveConfig（回落/映射）
    ↓
Config 接口（类型安全）
```

### 配置分组

| 分组 | 变量 | 说明 |
|------|------|------|
| **LLM** | `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` | 生成必需的云 API 配置 |
| **Embedding** | `EMBEDDING_MODE`、`EMBEDDING_*` | 本地或云 embedding，可回落 LLM |
| **向量库** | `LANCE_DB_PATH` | LanceDB 文件目录 |
| **重排器** | `RERANKER_MODEL` | cross-encoder 模型 id |
| **切分** | `CHUNK_SIZE`、`CHUNK_OVERLAP` | 分块参数 |
| **检索** | `RETRIEVAL_N`、`RETRIEVAL_K` | 粗筛候选数 / 精排后 top-k |
| **查询优化** | `QUERY_REWRITE`、`MULTI_QUERY`、`HYDE` | 08 各策略开关 |
| **聊天** | `CHAT_MODE`、`CHAT_STREAM`、`AGENT_*` | 09 流式/agentic 配置 |
| **租户** | `DEFAULT_TENANT` | 摄入默认租户 |
| **安全** | `INGEST_ROOT` | 限制摄入路径（可选） |

### 设计原则

1. **纯函数校验**：`loadConfig()` 只读传入的 env 对象，不碰文件系统。
2. **失败即报错**：校验失败抛出 `ConfigError`，逐条列出字段、原因与当前值。
3. **智能回落**：`EMBEDDING_*` 缺省回落到 `LLM_*`（默认同 provider）；`EMBEDDING_MODE=local` 时不需要云 embedding 配置。

---

## 租户隔离

### 为什么需要租户隔离？

多租户场景下，不同客户的数据必须物理隔离。一个租户的检索不能看到另一个租户的文档。

### 隔离策略

```
X-Tenant 请求头
    ↓
路由解析 → filter: { tenant }
    ↓
LanceDBStore vectorSearch/ftsSearch：where tenant = 'xxx'
```

### 隔离覆盖范围

| 端点 | 隔离状态 | 说明 |
|------|----------|------|
| `POST /search` | ✅ | X-Tenant 强制过滤 |
| `POST /trace` | ✅ | 同上 |
| `POST /ask` | ✅ | 同上 |
| `POST /chat` | ✅ | 同上 |
| `GET /documents` | ✅ | 只列出当前租户文档 |
| `DELETE /documents/:id` | ✅ | docId + tenant 双重约束 |
| `POST /documents/:id/reindex` | ✅ | 同上 |
| `POST /ingest` | ✅ | 请求级 tenant 覆盖默认 |

### 安全设计

- `LanceDBStore.deleteDocument` 使用 `buildWhere({...filter, docId})` 下推条件，防止跨租户删除。
- `computeDocId` 基于源路径稳定生成，同一路径在不同租户不冲突。
- 所有 SQL 风格的 where 子句使用 `escapeSql` 转义，防注入。

---

## 查询优化策略

### 改写（Rewrite）

**做什么：** 用 LLM 把口语化、冗长的查询压缩为适合检索的精确 query。

```
用户："你能告诉我一下那个 Fastify 框架的端口号是啥？"
改写后："Fastify 默认端口"
```

### 多查询（Multi-Query）

**做什么：** 把一个问题拆成多个互补的子问题，分别检索后 RRF 融合。

```
用户："Fastify 的端口和健康检查路径是什么？"
拆解：
  1. "Fastify 默认端口"
  2. "Fastify 健康检查路径"
  3. "Fastify 配置端口"
分别检索 → RRF 融合 → 跨 query 累加分数
```

### HyDE（Hypothetical Document Embedding）

**做什么：** 先生成一篇假想的"理想文档"，再用它的向量去检索，缩小 query 与文档的语义差距。

```
用户："如何配置 Fastify 端口？"
生成假想文档："Fastify 的端口配置在 listen 方法中……"
向量化假想文档 → 用这个向量去检索真实文档
```

### 策略组合流程

```
原始 query
    ↓
① 改写（可选）→ 如果失败，保留原 query
    ↓
② 多查询（可选，基于改写后 query）→ 如果失败，保留已有 query
    ↓
③ HyDE（可选，基于改写后 query）→ 如果失败，丢弃假想文档
    ↓
实际 queries = [改写后主 query, 多查询变体..., HyDE 假想文档]
    ↓
每个 query 分别执行向量 + BM25 检索
    ↓
rrfMergeMany 一次性跨 query 累加 RRF 分数
    ↓
重排 → 返回 top-k
```

---

## Agentic 聊天

### 什么是 Agentic 模式？

Agentic 模式让 LLM 自主决定**是否检索**、**用什么 query 检索**，而不是每次都固定检索一次。

### 状态机

```
START
  ↓
PLANNER（模型决策）
  ├─ 不需要检索 → NO_SEARCH → 直接生成回答
  └─ 需要检索 → SEARCH(query)
                  ↓
            TOOL_RESULT（检索结果回填）
                  ↓
            回 PLANNER（再决策）
                  ↓
            maxSteps 到达 → 强制终止 → 生成回答
            timeout 到达 → 强制终止 → 生成回答
```

### 与固定模式的区别

| 维度 | 固定模式（fixed） | Agentic 模式 |
|------|-------------------|--------------|
| 检索次数 | 固定 1 次 | 最多 maxSteps 次 |
| 检索 query | 改写后的 query | 模型自主决定 |
| 不检索情况 | 不可跳过 | 可输出 NO_SEARCH |
| 工具调用 | 无 | 有 tool_start/tool_result 事件 |
| 资源控制 | 无 | maxSteps + timeoutMs |

### 超时与取消

- `mergeSignals()` 合并外部的 HTTP 请求 AbortSignal 与内部的 deadline 超时。
- 合并后的 signal 贯穿 planner、search、generate 三个阶段。
- 每个阶段开始前检查 `signal.aborted`，客户端断开后不再启动后续工作。

---

## 常见问题

### Q: 这个项目和生产环境还有哪些差距？

**当前状态：** 功能完整，01-09 全部实现，128 项测试全绿通过。

**可进一步改进的方向：**
- 认证和授权机制（当前只有租户隔离）
- 请求速率限制
- 更完善的监控和告警
- 分布式部署方案
- 数据备份和恢复策略

### Q: 本地 Embedding 和云 Embedding 如何选择？

**本地 Embedding（默认）：**
- 优点：零云依赖，私密，快速，无需 API key
- 缺点：模型较小（384 维），中文区分能力有限
- 适合：开发调试、小规模部署、隐私敏感场景

**云 Embedding：**
- 优点：模型更大（如 text-embedding-3-small 1536 维），质量更高
- 缺点：需要 API key，有调用成本
- 适合：对质量要求高的生产环境

### Q: 本地重排器效果如何？

默认的 `ms-marco-MiniLM-L-6-v2` 是英文 cross-encoder，中文区分能力较弱。可在 `RERANKER_MODEL` 中配置其他多语模型。如果模型加载失败，自动降级到启发式词重叠评分，保证服务不中断。

### Q: 如何扩展支持更多文件格式？

在 `src/ingestion/loaders/` 下实现 `Loader` 接口，在 `index.ts` 的 `SUPPORTED_EXTENSIONS` 中注册即可。

### Q: 多轮对话的上下文怎么处理的？

- 历史消息透传给 LLM（保持多轮对话上下文）
- 最后一条 user 消息被改写为检索 query（短追问拼接上一轮上下文）
- 检索结果只基于最后一条改写后的 query，但生成时历史消息全部保留

### Q: SSE 流式和非流式 JSON 怎么选？

- 默认 `CHAT_STREAM=false`，保留 04 的 JSON 兼容契约
- 设置 `CHAT_STREAM=true` 且请求头包含 `Accept: text/event-stream` 时启用 SSE
- SSE 事件：`text_delta`（增量文本）、`tool_start`/`tool_result`（agentic 工具）、`sources`（来源块）、`done`（完成）、`error`（错误）

---

## 总结

**rag-prod** 是一个完整的、生产可用的 RAG 知识库服务，覆盖了从文档摄入到答案生成的全链路。

### 核心能力矩阵

```
摄入 ── 五格式加载器 + 标题感知切分 + 本地/云 Embedding
检索 ── 混合检索(向量+BM25) + RRF + cross-encoder 重排 + 诊断
生成 ── 固定/Agentic 双模式 + 流式 SSE + 编号引用
评估 ── 33 条评测集 + 四指标 LLM 判分 + 查询优化变体回归
管理 ── 文档列表/删除/重索引 + 多租户隔离
配置 ── Zod 校验 + 类型安全 Config + 智能回落
```

### 设计原则

1. **成熟框架优先**：LangChain.js 编排 + Fastify 服务 + LanceDB 持久化，不重新发明轮子。
2. **本地可验证**：默认本地 Embedding 和重排器，无需任何云 key 即可完成核心链路验证。
3. **渐进式复杂度**：从固定流水线到 Agentic 多步循环，从单 query 到多查询优化，按需启用。
4. **可观测性第一**：每个环节的中间产物可通过 trace 诊断，评估系统持续监控质量回归。
5. **安全默认值**：租户隔离贯穿所有 API，存储操作受 filter 约束，配置校验失败即报错。