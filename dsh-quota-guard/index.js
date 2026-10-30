import { LlmError } from '@deepseek-ai/dsh-llm'
import { normalizeConfig } from './lib/config.js'
import { costOf } from './lib/pricing.js'
import { PoolAdapter } from './lib/adapter.js'
import { dayKey } from './lib/util.js'
import * as store from './lib/store.js'

export const name = 'llm-guard'
export const inject = ['llm']

const SAVE_DEBOUNCE_MS = 2000

/** 工具入参：dsh-tools 的 schema 子集不支持 minimum/maximum，范围在 execute 里再夹一次。 */
export const REPORT_PARAMETERS = {
  type: 'object',
  properties: {
    days: { type: 'integer', description: '趋势天数，1–32，默认 7。' },
  },
  additionalProperties: false,
}

const countableKeys = ['requests', 'errors', 'blocked', 'switches', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'costCny']

/** dsh-tools 只接受 JSON Schema 子集：单 type、oneOf、properties/required/items，没有 $ref / 数组 type。 */
const statsSchema = () => ({
  type: 'object',
  properties: {
    ...Object.fromEntries(countableKeys.map((key) => [key, { type: 'number' }])),
    avgLatencyMs: { type: 'number', description: '平均首字延迟（毫秒）；没有样本时为 0' },
  },
  required: [...countableKeys, 'avgLatencyMs'],
  additionalProperties: false,
})

const nullableNumber = () => ({ oneOf: [{ type: 'number' }, { type: 'null' }] })

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    at: { type: 'string', description: '生成时间（ISO 8601）' },
    day: { type: 'string', description: '账本日期（本地时区）' },
    today: statsSchema(),
    totals: statsSchema(),
    limits: {
      type: 'object',
      properties: {
        dailyTokens: { type: 'number' },
        dailyRequests: { type: 'number' },
        perMinuteRequests: { type: 'number' },
        warnAt: { type: 'number' },
        onExceed: { type: 'string', enum: ['block', 'warn'] },
      },
      required: ['dailyTokens', 'dailyRequests', 'perMinuteRequests', 'warnAt', 'onExceed'],
      additionalProperties: false,
    },
    remaining: {
      type: 'object',
      properties: {
        dailyTokens: nullableNumber(),
        dailyRequests: nullableNumber(),
        perMinuteRequests: nullableNumber(),
      },
      required: ['dailyTokens', 'dailyRequests', 'perMinuteRequests'],
      additionalProperties: false,
    },
    perMinute: {
      type: 'object',
      properties: { used: { type: 'number' }, limit: { type: 'number' } },
      required: ['used', 'limit'],
      additionalProperties: false,
    },
    models: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          requests: { type: 'number' },
          errors: { type: 'number' },
          totalTokens: { type: 'number' },
          outputTokens: { type: 'number' },
          costCny: { type: 'number' },
          priced: { type: 'boolean', description: '是否配置了单价；false 表示花的钱未知，不是免费' },
          avgLatencyMs: { type: 'number', description: '平均首字延迟（毫秒）；没有样本时为 0' },
        },
        required: ['provider', 'model', 'requests', 'errors', 'totalTokens', 'outputTokens', 'costCny', 'priced', 'avgLatencyMs'],
        additionalProperties: false,
      },
    },
    providers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          requests: { type: 'number' },
          errors: { type: 'number' },
          totalTokens: { type: 'number' },
        },
        required: ['provider', 'requests', 'errors', 'totalTokens'],
        additionalProperties: false,
      },
    },
    history: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string' },
          requests: { type: 'number' },
          errors: { type: 'number' },
          blocked: { type: 'number' },
          switches: { type: 'number' },
          totalTokens: { type: 'number' },
          costCny: { type: 'number' },
          avgLatencyMs: { type: 'number', description: '平均首字延迟（毫秒）；没有样本时为 0' },
        },
        required: ['day', 'requests', 'errors', 'blocked', 'switches', 'totalTokens', 'costCny', 'avgLatencyMs'],
        additionalProperties: false,
      },
    },
    pool: {
      type: 'array',
      description: '账号池健康度；未配置账号池时省略',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          models: { type: 'array', items: { type: 'string' } },
          coolingUntil: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['id', 'models', 'coolingUntil'],
        additionalProperties: false,
      },
    },
  },
  required: ['at', 'day', 'today', 'totals', 'limits', 'remaining', 'perMinute', 'models', 'providers', 'history'],
  additionalProperties: false,
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  const log = ctx.logger ? ctx.logger('llm-guard') : console

  const state = store.load(cfg.stateFile, log)
  let timer = null

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    try {
      store.save(cfg.stateFile, state)
    } catch (error) {
      log.warn?.(`写入用量状态失败：${error?.message || error}`)
    }
  }

  const touch = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      try {
        store.save(cfg.stateFile, state)
      } catch (error) {
        log.warn?.(`写入用量状态失败：${error?.message || error}`)
      }
    }, SAVE_DEBOUNCE_MS)
    timer.unref?.()
  }

  ctx.effect(() => () => flush())

  const prices = cfg.prices

  // ── 全局计量 + 限额 ──────────────────────────────────────────────────────
  ctx.on('llm/stream', (options, next) => {
    if (!cfg.enabled) return next()

    const now = new Date()
    const verdict = store.check(state, cfg.limits, now)
    if (!verdict.allowed) {
      const message = limitMessage(verdict)
      if (cfg.limits.onExceed === 'block') {
        store.recordBlocked(state, now)
        flush()
        log.warn?.(message)
        return blockedStream(message, verdict)
      }
      log.warn?.(`${message}（onExceed=warn，本次继续放行）`)
    } else if (verdict.warn) {
      log.warn?.(`用量接近上限：${Math.round(verdict.ratio * 100)}%`)
    }
    store.count(state, now)

    return meter(next(), {
      provider: options.provider,
      model: options.model,
      startedAt: now,
    })
  })

  function meter(iterable, info) {
    return (async function* metered() {
      const startedAt = info.startedAt instanceof Date ? info.startedAt : new Date()
      let firstTokenAt = 0
      let usage = null
      let status = 'ok'
      try {
        for await (const chunk of iterable) {
          if (!firstTokenAt && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta')) {
            firstTokenAt = Date.now()
          }
          if (chunk.type === 'usage') usage = mergeUsage(usage, chunk.usage)
          if (chunk.type === 'finish') {
            if (chunk.reason?.kind === 'error') status = 'error'
            else if (chunk.reason?.kind === 'aborted') status = 'aborted'
          }
          yield chunk
        }
      } catch (error) {
        status = error?.code === 'ABORTED' ? 'aborted' : 'error'
        throw error
      } finally {
        const cost = costOf(info.model, usage || {}, prices)
        store.settle(state, {
          // 按请求开始的那一天落账：跨零点的长流不会把 token 记到第二天。
          day: dayKey(startedAt),
          provider: info.provider,
          model: info.model,
          usage: usage || {},
          costCny: cost.costCny,
          priced: cost.priced,
          status,
          latencyMs: firstTokenAt ? firstTokenAt - startedAt.getTime() : null,
        })
        touch()
      }
    })()
  }

  // ── 账号池（自动切换）──────────────────────────────────────────────────
  let adapter = null
  if (cfg.pool.accounts.length) {
    adapter = new PoolAdapter({
      ...cfg.pool,
      log,
      onSwitch: (from, to) => {
        store.recordSwitch(state, new Date())
        touch()
        log.warn?.(`账号池切换：${from} → ${to}`)
      },
    })
    const disposeAdapter = ctx.llm.registerAdapter([cfg.pool.provider], adapter)
    ctx.effect(() => disposeAdapter)
    log.info?.(`账号池已注册为提供方 ${cfg.pool.provider}（${cfg.pool.accounts.length} 个账号）`)
  }

  // ── 用量报告工具 ───────────────────────────────────────────────────────
  const tools = ctx.get('tools')
  if (tools?.register) {
    const disposeTool = tools.register({
      name: 'llm_guard_report',
      description: '读取 LLM Guard 的本地用量账本：今日/累计 token 与请求数、限额剩余、按模型与按提供方的消耗、最近若干天趋势。只读本地状态文件，不发起任何模型请求。',
      parameters: REPORT_PARAMETERS,
      output: {
        schema: REPORT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const days = Math.max(1, Math.min(32, Number(args?.days) || 7))
        const report = store.snapshot(state, cfg.limits, new Date(), days)
        if (adapter) report.pool = adapter.health()
        return report
      },
    })
    ctx.effect(() => disposeTool)
  }
}

function blockedStream(message, decision) {
  return (async function* blocked() {
    throw new LlmError(message, 'GUARD_LIMIT', { cause: decision })
  })()
}

function limitMessage(decision) {
  const pct = decision.max > 0 ? `（${decision.used} / ${decision.max}）` : ''
  if (decision.kind === 'perMinuteRequests') {
    return `LLM Guard 已拦截请求：每分钟请求数达到上限${pct}，下一分钟自动恢复`
  }
  if (decision.kind === 'dailyRequests') {
    return `LLM Guard 已拦截请求：今日请求数达到上限${pct}，明日自动恢复`
  }
  return `LLM Guard 已拦截请求：今日 token 用量达到上限${pct}，明日自动恢复`
}

function mergeUsage(current, next) {
  if (!next) return current
  if (!current) return { ...next }
  const out = { ...current }
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    if (next[key] != null) out[key] = (out[key] || 0) + next[key]
  }
  return out
}
