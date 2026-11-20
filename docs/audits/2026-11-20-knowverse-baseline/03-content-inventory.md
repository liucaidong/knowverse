# 03 · 知识内容审计（2026-11-20）

## 规模（注册表为准）

| 资产 | 数量 |
|---|---:|
| 知识专题 | 12 |
| Concept | 35 |
| Competency | 34 |
| Gap | 51 |
| Review Assessment | 115 |
| 作品 works | 17 |
| 来源 sources | 17 |
| Canonical routes | 63 |
| 搜索索引记录 | 134 |

来源：`validate-site-architecture.mjs` 本轮输出与 `docs/audits/2026-11-14/30-final-acceptance.md` 一致。

## 结构与关系质量

- 一个知识对象一个 canonical ID、事实来源唯一（README 产品原则 1）。
- Concept / Competency / Assessment 职责分离；只有显式 `prerequisite_of` 影响门控。
- 12/12 专题已纳入能力图谱（4.1 补齐其余 8 专题的 16 能力点/16 Gap/32 复习变体），但 Promise、Monorepo、React Native、AI Agent 图谱深度最高。
- 内容均可访问：`validate-v2.py` 本轮扫描 9,990 条本地链接、22 个 Mermaid 全景图，通过；生产 5 个核心路由 HTTP 200。

## 孤立/重复/失效检查

- 未发现失效 canonical route；作品通过 `knowledge_ids` 反向关联，不复制知识正文（无重复内容源）。
- 来源 URL 历史审计 13/13 可达（本轮未重跑外网可达性，标记 NOT RUN，沿用 4.1 结论）。
- 索引正文含站点外壳导航文案属提取质量问题（P3），非内容重复。

## 结论

内容结构完整、关系可追溯、覆盖边界公开透明。无 P0/P1 内容缺陷。
