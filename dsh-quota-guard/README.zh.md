# dsh-quota-guard

用量计量、每日/每分钟限额、OpenAI 兼容账号池自动切换——一个可以直接装进 DeepSeek Harness 的组合包（bundle）。

English: [README.md](README.md)

## 它解决什么

- **看得见**：每一次 `llm/stream` 都记账——请求数、输入/输出/缓存 token、首字延迟、按模型与提供方拆分、最近 32 天趋势。
- **花不超**：今日 token 上限、今日请求上限、每分钟请求上限；到顶后在**下一次请求发出前**拦住，不会先发出去再后悔。
- **不断线**：把多个 OpenAI 兼容账号/模型配成一条路由，遇到 429、401、欠费、5xx 自动换下一个；已经开始输出后不重放，避免重复内容。

## 安装

```sh
# 发布到 npm / GitHub 之后
dsh plugin --profile desktop add dsh-quota-guard

# 本地 checkout
dsh plugin --profile desktop add ./dsh-quota-guard
dsh --profile desktop --dump-config   # 应能看到 "# == dsh-quota-guard" 这一层
```

`cordis.patch.yml` 会插入一行 `id: llm-guard`，默认配置下**只计量、不拦截**（所有上限为 0），装上是安全的。

## 配置

写在 profile 的 `cordis.patch.yml` 里，或作为 profile 自己的 patch 层叠加：

```yaml
- insert:
    - id: llm-guard
      name: dsh-quota-guard
      config:
        limits:
          dailyTokens: 2000000      # 每天 token 上限，0 = 不限
          dailyRequests: 1500       # 每天请求数上限，0 = 不限
          perMinuteRequests: 30     # 每分钟请求数上限，0 = 不限
          warnAt: 0.8               # 用到 80% 开始告警
          onExceed: block           # block = 拦截；warn = 只告警照常放行
        prices:                     # 元 / 百万 token，可选；不配则只计 token 不算钱
          deepseek-chat: { in: 2, out: 8 }
          'qwen-*': { in: 1.2, out: 6 }
        pool:
          provider: guard-pool
          accounts:
            - id: bailian-main
              baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
              apiKeyEnv: DASHSCOPE_API_KEY
              models: [qwen3.8-flash, qwen3.6-flash, qwen-plus]
            - id: glm-backup
              baseURL: https://open.bigmodel.cn/api/paas/v4
              apiKeyEnv: ZHIPU_API_KEY
              models: [glm-4-flash]
          fallback:
            qwen3.8-flash: [qwen3.6-flash, glm-4-flash]
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关掉后完全放行、不记账 |
| `stateFile` | `$DSH_HOME/llm-guard/usage.json` | 账本路径 |
| `limits.*` | 全部 `0`（不限） | 上限为 0 表示不启用该项 |
| `prices` | 空 | 键支持 `模型名` 或 `前缀*`；单位：元 / 百万 token |
| `pool.accounts[].apiKeyEnv` | — | **推荐**：密钥放环境变量，插件只读 `process.env` |
| `pool.accounts[].apiKey` | — | 直接写密钥，仅方便本地试；会被状态/日志排除，但仍不建议提交到仓库 |
| `pool.fallback` | 空 | 显式模型降级链；不配就不会偷偷换模型 |
| `pool.maxAttempts` | `6` | 单次请求最多试几个候选 |
| `pool.cooldownMs` | `60000` | 限流/5xx/传输错误的冷却基准（限流至少等 `Retry-After`）；鉴权、欠费、模型不存在冷却 10 分钟 |
| `pool.timeoutMs` | `300000` | 单次上游请求总时长上限 |
| `pool.contextWindow` | `0` | 声明给 UI 的上下文窗口；0 = 不声明 |
| `pool.allowAnyModel` | `false` | 请求的模型池里没有时，是否允许用池内其它模型顶上 |

### 让 agent 走账号池

账号池注册成提供方 `guard-pool` 之后，把默认模型指过去即可（覆盖 profile 里已有的 `agent-default-model` 行）：

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: guard-pool
    model: qwen3.8-flash
```

不配账号池时，本插件只做全局计量与限额，对现有提供方零侵入。

## 报告工具

`llm_guard_report`（参数 `days`，1–32，默认 7）返回只读快照：今日与累计计数、限额剩余、按模型/提供方拆分、最近 N 天趋势、账号池冷却状态，以及今天/累计/分模型的平均首字延迟 `avgLatencyMs`。它只读本地账本，不发起任何模型请求。

## 行为边界（请先读）

- **token 来自上游 `usage`**。上游不返回 usage 时 token 记 0，不会拿字符数瞎估。
- **限额在请求发出前判定**。单次超大请求可能把当日额度顶穿——这是拦截式限额的固有极限，不是 bug。
- **自动切换只在吐出第一个分片前**。一旦向调用方输出过内容就不再重试，否则会重复内容；此时的错误按协议以 `error` finish 结束。
- **不支持图片输入**：图片块会以 `UNSUPPORTED_OPTION` 明确报错，不会静默丢图。
- **未定价 ≠ 免费**：`prices` 为空时报告的 `costCny` 是 0、`priced: false`；请自己按厂商当前报价填写。
- **账本是本地估算**，用于自我约束，不是厂商账单。
- **按请求开始日归档**：跨零点的长流记在开始那天；延迟样本只来自真正输出过首字的请求。
- **损坏的账本会被保留**：`usage.json` 解析失败或版本不符时另存为 `usage.json.corrupt`，不会静默清空。
- 冷却状态只在内存里，重启后清零；账本持久化在 `stateFile`。

## 与旧版 `dsh-free-quota` 相比砍掉了什么

砍掉：探测全部模型、用量面板 UI、按 YAML 改默认模型、解析第三方账本、模型偏好评分。留下的是可发布、可测试、对宿主零侵入的三件事：计量、限额、切换。

## 开发

```sh
npm test
# 可选：对着真实宿主核对 @deepseek-ai/dsh-llm 的导出名
DSH_HOST_LLM=/path/to/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js node --test test/host-compat.test.js
```

测试不需要网络：`test/adapter.test.js` 起本地 HTTP 服务模拟 429 与 SSE 流。运行时代码只依赖 Node 内置模块与宿主提供的 `@deepseek-ai/dsh-llm`（peer dependency），没有第三方依赖。

## 发布清单

1. `npm test` 全绿；`npm pack --dry-run` 只包含 `index.js`、`lib/`、`test/` 之外的运行文件。
2. 建公开 GitHub 仓库，仓库 **Topics 加上 `dsh-plugin`**（市场抓取依据）。
3. 在 `package.json` 补 `repository`、`homepage`、`author`（发布前留空会被市场页显示成空白）。
4. `npm publish`（若用 `@scope` 需公开访问权限）。
5. 到 [dsh-plugin.org](https://dsh-plugin.org)、DSH Plugin Hub、`awesome-dsh-plugin` 提交仓库地址。
6. 版本遵循 SemVer：行为变更升 minor，修复升 patch，并在 `CHANGELOG.md` 记一笔。

## License

MIT
