# 06 — 评估体系（LLM 判分 + 回归对比）

**What to build:** 一套评估工具：在已摄入语料上建立 30+ 条真实 Q&A 评测集（带标准相关块标注）；实现四个 LLM 判分指标——faithfulness（忠实度）、answer relevance（答案相关性）、context precision、context recall——用配置的云 LLM 做 judge prompt 打分；一个配置回归运行器，把同一评测集跑在不同配置变体（chunk 大小、k/N、混合开关、重排开关）下并产出可对比的基线表，某变体指标跌破阈值即判定回归。

**Blocked by:** 04 — 问答/聊天端点

**Status:** ready-for-agent

- [ ] 评测集 30+ 条问题，含标准相关块引用，入库并随仓库管理
- [ ] 四个 LLM 判分指标逐条计算并聚合，结果存 JSON
- [ ] 回归运行器对比两种配置并报告各指标差值
- [ ] CI 测试跑一个快速冒烟子集；完整运行有脚本且产出物可提交对比
