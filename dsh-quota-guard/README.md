# dsh-quota-guard

Usage metering, daily/per-minute budgets, and an OpenAI-compatible account pool with automatic failover — as a DeepSeek Harness bundle.

中文: [README.zh.md](README.zh.md)

## What it does

- **Visibility** — every `llm/stream` is recorded: requests, input/output/cache tokens, time to first token, broken down by model and provider, with a 32-day rolling history.
- **Hard budgets** — daily tokens, daily requests, per-minute requests. A breached budget blocks the **next** request before it leaves the process.
- **Survivability** — several OpenAI-compatible accounts/models behind one route; 429, 401, arrears, and 5xx rotate to the next candidate. Failover only happens before the first chunk is emitted, so output is never duplicated.

## Install

```sh
# after publishing
dsh plugin --profile desktop add dsh-quota-guard

# local checkout
dsh plugin --profile desktop add ./dsh-quota-guard
dsh --profile desktop --dump-config   # expect a "# == dsh-quota-guard" layer
```

The bundle inserts `id: llm-guard`. Defaults are meter-only: every limit is `0` (disabled), so installing it cannot block anything.

## Configure

```yaml
- insert:
    - id: llm-guard
      name: dsh-quota-guard
      config:
        limits:
          dailyTokens: 2000000      # 0 = unlimited
          dailyRequests: 1500
          perMinuteRequests: 30
          warnAt: 0.8
          onExceed: block           # block | warn
        prices:                     # CNY per 1M tokens; omit to count tokens only
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

| Key | Default | Notes |
|---|---|---|
| `enabled` | `true` | `false` disables both metering and limits |
| `stateFile` | `$DSH_HOME/llm-guard/usage.json` | ledger path |
| `limits.*` | `0` | `0` disables that limit |
| `prices` | `{}` | keys are exact model ids or `prefix*`; CNY / 1M tokens |
| `pool.accounts[].apiKeyEnv` | — | **preferred**: read the key from the environment |
| `pool.accounts[].apiKey` | — | inline key, for local trials only |
| `pool.fallback` | `{}` | explicit downgrade chain; no implicit model substitution |
| `pool.maxAttempts` | `6` | candidate attempts per request |
| `pool.cooldownMs` | `60000` | cooldown for rate limits / 5xx / transport (rate limits respect `Retry-After`); auth, arrears and missing models cool for 10 minutes |
| `pool.timeoutMs` | `300000` | total upstream request budget |
| `pool.contextWindow` | `0` | advertised context capacity; `0` = unknown |
| `pool.allowAnyModel` | `false` | allow any pool model when the requested one is absent |

### Route the agent through the pool

The pool is registered as the provider `guard-pool`. Point the default model at it (overrides the existing `agent-default-model` row):

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: guard-pool
    model: qwen3.8-flash
```

Without a pool, the plugin only meters and enforces limits on existing providers.

## Report tool

`llm_guard_report` (`days`, 1–32, default 7) returns a read-only snapshot: today/total counters, remaining budget, per-model and per-provider splits, recent history, pool cooldowns, and `avgLatencyMs` (time to first token) for today, all time, and per model. It reads the local ledger and never calls a model.

## Boundaries

- Token counts come from upstream `usage`; absent usage records `0` rather than a character-based guess.
- Limits are checked before dispatch, so one oversized request can still overshoot a daily budget.
- Failover stops at the first emitted chunk; later failures surface as an `error` finish.
- Image input is rejected with `UNSUPPORTED_OPTION` instead of being silently dropped.
- `priced: false` means "price unknown", not "free".
- The ledger is a local estimate for self-control, not a vendor invoice.
- A request is attributed to the day it **started**; latency samples only come from streams that emitted a first token.
- A corrupted or version-mismatched `usage.json` is kept as `usage.json.corrupt` instead of being silently discarded.
- Cooldowns are in-memory; the ledger is persisted.

## Cut from the previous `dsh-free-quota`

Removed: probing every model, the panel UI, rewriting the default model in YAML, third-party ledger parsing, preference scoring. Kept and hardened: metering, budgets, failover.

## Development

```sh
npm test
# optional: check @deepseek-ai/dsh-llm export names against a real host
DSH_HOST_LLM=/path/to/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js node --test test/host-compat.test.js
```

Tests need no network: `test/adapter.test.js` runs a local HTTP server that returns 429s and SSE streams. Runtime code depends only on Node built-ins and the host-provided `@deepseek-ai/dsh-llm` peer.

## Publishing checklist

1. `npm test` green; `npm pack --dry-run` shows only runtime files.
2. Public GitHub repo with the **`dsh-plugin`** topic (what the marketplaces scan).
3. Fill `repository`, `homepage`, `author` in `package.json` before publishing.
4. `npm publish` (public access for a scoped package).
5. Submit the repo to dsh-plugin.org, DSH Plugin Hub, and `awesome-dsh-plugin`.
6. SemVer: behaviour changes bump minor, fixes bump patch, and `CHANGELOG.md` gets a line.

## License

MIT
