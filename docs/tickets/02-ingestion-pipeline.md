# 02 — 摄入管线（加载 → 解析 → 分块 → Embedding → LanceDB）

**What to build:** 用 LangChain.js 文档加载器做一条摄入管线：接受 PDF / DOCX / Markdown / HTML / TXT，统一抽取为「文档正文 + 元数据」结构；用标题感知/代码块感知的切分器切成保留章节上下文的块；用配置的云 Embedding 模型向量化；持久化进嵌入式 LanceDB 向量库。HTTP `/ingest` 端点（单文件或目录）返回每篇文档的块数；数据跨进程重启不丢（重启后仍能检索到）。

**Blocked by:** 01 — 项目脚手架 + 配置中心

**Status:** ready-for-agent

- [ ] 分别摄入 PDF/DOCX/MD/HTML/TXT 各一篇 → 生成带来源元数据（标题、源路径、章节路径）的块
- [ ] 切分保留标题/章节上下文；chunk 大小与 overlap 可配置
- [ ] 块持久化到 LanceDB；新进程重启后仍能检索到
- [ ] `/ingest` 返回 docId + 块数；重复摄入同一 docId 是更新而非重复插入
- [ ] 每个加载器与切分器都有单元测试
