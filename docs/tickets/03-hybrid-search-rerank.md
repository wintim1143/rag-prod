# 03 — 混合检索 + 本地 cross-encoder 重排

**What to build:** 一条「召回宽、精排准」的检索管线：先做混合检索粗筛（稠密向量 + BM25 关键词经 RRF 融合，取 N=50 候选），再用本地 cross-encoder 重排器（bge-reranker 家族，Transformers.js 本地跑，保留启发式兜底）精排到 top-k。`/search` 返回排序后的块，携带各环节分数（向量/BM25/RRF/重排）与来源引用，把「粗筛→精排」的取舍透明可见。k 与 N 可配置。

**Blocked by:** 02 — 摄入管线

**Status:** ready-for-agent

- [ ] 混合检索能同时召回语义改写与精确术语两类匹配
- [ ] 重排会改变粗筛顺序：在演示 query 上，重排后 top-k 与原始混合排序有实质差异
- [ ] `/search` 响应暴露每阶段分数（向量/BM25/RRF/重排）
- [ ] k/N 通过环境变量可调；在评测集上重排能提升 top-k 精度（可先用关键词探针快速验证）
- [ ] 本地 cross-encoder 加载失败时有清晰报错并可降级到启发式兜底
