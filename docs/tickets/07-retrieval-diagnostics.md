# 07 — 检索诊断与失败分析工具

**What to build:** 回答「为什么检索不准」的诊断能力：对一条 query，CLI/端点逐环节输出 trace——query 向量化 → 稠密命中（带分数）→ BM25 命中 → RRF 融合 → 重排分数，展示分数落差结构，并给出失败分类：a) 知识库本无此内容；b) 有内容但没召回（分块/Embedding/query 表达不匹配）；c) 召回了但排太后（k/重排问题）；d) 检索正常但答案错（生成/Prompt 问题）。产出可导出的排查报告。

**Blocked by:** 03 — 混合检索 + 本地 cross-encoder 重排

**Status:** ready-for-agent

- [ ] trace 端点/CLI 对单条 query 打印每阶段结果与分数
- [ ] 失败分类器给出 a–d 之一并附证据（如 BM25 命中但向量未命中 ⇒ Embedding/query 不匹配）
- [ ] 报告可写文件分享
- [ ] 用一组「已知会错」的 query 做测试，标注其期望失败类别
