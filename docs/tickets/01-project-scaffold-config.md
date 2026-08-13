# 01 — 项目脚手架 + 配置中心

**What to build:** 一个可启动的 LangChain.js 正式 RAG 项目（TypeScript，Node ≥ 20），位于仓库外独立目录 `D:\code\rag-prod`。包含 Fastify HTTP 服务骨架、集中式环境配置与启动校验（LLM 的 baseURL/apiKey/model、Embedding 模型、LanceDB 存储路径、重排器配置、服务端口），以及一个健康检查端点。运行 `npm run dev` 即可起服务，`/health` 返回 200 与栈摘要。

**Blocked by:** None — 可以立即开始

**Status:** done ✅ (2026-08-13)

- [x] 新项目目录建立在 `D:\code\rag-prod`，`npm install` + `npm run dev` 能启动 HTTP 服务
- [x] 所有 provider 配置（LLM/Embedding/重排器/向量库路径/端口）从环境变量读取，启动时校验并给出清晰报错
- [x] `GET /health` 返回 200 + 配置栈摘要；配置校验有单元测试覆盖
- [x] README 说明如何配置与运行；git 仓库初始化、首条提交完成
