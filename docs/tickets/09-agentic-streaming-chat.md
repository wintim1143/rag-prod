# 09 — Agentic + 流式聊天

**What to build:** 把 `/chat` 升级为流式 + agentic 检索模式：用 AI SDK 让回答逐 token 流式（SSE）下发；agentic 模式下模型自主决定是否检索、用什么 query 检索（检索作为工具调用），并在响应中回传工具调用 trace 与所用来源块。配置可切换「固定流水线（04）」与「agentic（本票）」两种模式。

**Blocked by:** 04 — 问答/聊天端点

**Status:** ready-for-agent

- [ ] `/chat` 通过 SSE 流式输出，客户端收到增量回答
- [ ] agentic 模式：模型调用检索工具、自主生成检索 query；响应附工具调用 trace
- [ ] 配置可在固定流水线 chat 与 agentic chat 间切换
- [ ] 工具调用 trace + 引用溯源在演示对话上端到端可用
