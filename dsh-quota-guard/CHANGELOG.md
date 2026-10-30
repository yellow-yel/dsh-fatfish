# Changelog

## 0.1.3 — 2026-10-30

- 新增首字延迟（TTFT）统计：流里出现第一个文本/推理/工具分片时记一次耗时，报告给出 `today.avgLatencyMs`、`totals.avgLatencyMs` 和每个模型的 `avgLatencyMs`；没有样本时为 0，不做估算。
- 账本按请求**开始**的那一天落账：跨零点的长流不再把 token 记到第二天。
- 损坏或版本不符的 `usage.json` 会先另存为 `usage.json.corrupt` 再重新记账，不再静默丢掉历史。
- 新增宿主兼容测试：设置 `DSH_HOST_LLM=<宿主 dsh-llm/lib/index.js>` 后，按源码里真实的 import 名单核对宿主导出（可提前发现 0.1.1 那类 `CallId` 问题）。
- 新增 GitHub Actions CI（Node 20 / 22 / 24，`npm test` + `npm pack --dry-run`）。
- 报告工具输出 schema 增加 `avgLatencyMs`；旧账本可直接读取，缺少的延迟字段按 0 处理。

## 0.1.2 — 2026-10-30

宿主兼容性修复。0.1.0 / 0.1.1 在 DSH 0.2.1-rc.5 上加载即失败，装上等于没装。

- 去掉 `@deepseek-ai/dsh-llm` 的 `CallId` 导入：该版本只导出 `ToolCallId` / `MessageId`，导入就是 `SyntaxError: does not provide an export named 'CallId'`。`CallId` 在旧版里是恒等函数，去掉不改变行为。
- 注册 `llm_guard_report` 改用 `ctx.get('tools')`：cordis 4 里访问未写进 `inject` 的服务属性会直接抛错（`cannot get property "tools" without inject`）。
- 测试替身补上 `ctx.get()`——正是这个缺口让上面两个问题躲过了全部用例。

## 0.1.1 — 2026-10-30

功能与 0.1.0 相同。0.1.0 的元数据被 npm 分阶段发布机制登记但制品未放行，改用 `npm stage publish` 重新发布。

## 0.1.0 — 2026-10-30

首个可发布版本。

- 全局 `llm/stream` 计量：请求数、输入/输出/缓存/推理 token、按模型与提供方拆分、32 天滚动账本。
- 限额：每日 token、每日请求、每分钟请求；`block` 与 `warn` 两种超限姿态；接近上限告警。
- OpenAI 兼容账号池（`guard-pool` 路由）：多账号/多模型候选链、显式 `fallback` 降级、按失败类型冷却、首个分片前自动切换。
- 可选单价表（元 / 百万 token），支持 `前缀*` 通配；未定价时明确标记 `priced: false`。
- `llm_guard_report` 只读报告工具。
- 账本原子写入（临时文件 + rename）、2 秒防抖、插件释放时落盘。
- 25 个离线测试（含本地 429/SSE 模拟服务与真实 cordis 生命周期）。
