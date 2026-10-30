import fs from 'node:fs'
import { writeAtomic, dayKey, minuteKey, asInt, asNum, round } from './util.js'

export const STATE_VERSION = 1

/** 保留最近多少天，避免状态文件无限增长（每天几十个模型也只占几十 KB）。 */
export const KEEP_DAYS = 32

function emptyCounters() {
  return {
    requests: 0,
    errors: 0,
    blocked: 0,
    switches: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costCny: 0,
    latencySumMs: 0,
    latencyCount: 0,
  }
}

export function emptyState() {
  return {
    version: STATE_VERSION,
    updatedAt: '',
    days: {},
    minute: { key: '', count: 0 },
    totals: emptyCounters(),
  }
}

/**
 * 账本损坏时不能静默清零：先转存成 *.corrupt 再重新记账，旧数据还能人工找回。
 */
export function load(file, log) {
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') quarantine(file, log)
    return emptyState()
  }
  if (!raw || raw.version !== STATE_VERSION || typeof raw.days !== 'object' || !raw.days) {
    quarantine(file, log)
    return emptyState()
  }
  return {
    version: STATE_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    days: raw.days,
    minute: raw.minute && typeof raw.minute === 'object'
      ? { key: String(raw.minute.key || ''), count: asInt(raw.minute.count) }
      : { key: '', count: 0 },
    totals: { ...emptyCounters(), ...(raw.totals || {}) },
  }
}

function quarantine(file, log) {
  try {
    fs.renameSync(file, `${file}.corrupt`)
    log?.warn?.(`用量账本无法解析或版本不符，已另存为 ${file}.corrupt 并重新记账`)
  } catch (error) {
    log?.warn?.(`用量账本无法解析，备份失败：${error?.message || error}`)
  }
}

export function save(file, state) {
  state.updatedAt = new Date().toISOString()
  prune(state)
  writeAtomic(file, JSON.stringify(state, null, 2))
}

function prune(state) {
  const keys = Object.keys(state.days).sort()
  while (keys.length > KEEP_DAYS) {
    delete state.days[keys.shift()]
  }
}

function bucket(state, key) {
  let day = state.days[key]
  if (!day || typeof day !== 'object') {
    day = state.days[key] = { ...emptyCounters(), byModel: {}, byProvider: {} }
  }
  day.byModel ||= {}
  day.byProvider ||= {}
  return day
}

export function tokenTotal(usage) {
  return (usage.inputTokens || 0) + (usage.outputTokens || 0)
    + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
}

/**
 * 预算检查不改账，只给结论；由调用方决定是拦截还是继续放行。
 * 账本计数用 {@link count}，被拦截的请求用 {@link recordBlocked}。
 */
export function check(state, limits, date = new Date()) {
  const dayK = dayKey(date)
  const minuteK = minuteKey(date)
  if (state.minute.key !== minuteK) state.minute = { key: minuteK, count: 0 }
  const day = bucket(state, dayK)

  const dailyTokens = asInt(limits.dailyTokens)
  const dailyRequests = asInt(limits.dailyRequests)
  const perMinuteRequests = asInt(limits.perMinuteRequests)

  const over = (kind, used, max) => (max > 0 && used >= max ? { kind, used, max } : null)
  const hit = over('perMinuteRequests', state.minute.count, perMinuteRequests)
    || over('dailyRequests', day.requests, dailyRequests)
    || over('dailyTokens', day.totalTokens, dailyTokens)

  const ratios = []
  if (dailyTokens > 0) ratios.push(day.totalTokens / dailyTokens)
  if (dailyRequests > 0) ratios.push(day.requests / dailyRequests)
  if (perMinuteRequests > 0) ratios.push(state.minute.count / perMinuteRequests)
  const ratio = ratios.length ? Math.max(...ratios) : 0
  const warnAt = Number.isFinite(limits.warnAt) ? limits.warnAt : 0.8

  return {
    allowed: !hit,
    kind: hit?.kind,
    used: hit?.used ?? 0,
    max: hit?.max ?? 0,
    day: dayK,
    warn: ratio >= warnAt,
    ratio,
  }
}

/** 放行后立即计数：并发请求同时到期时，已放行的数量立刻可见。 */
export function count(state, date = new Date()) {
  const dayK = dayKey(date)
  const minuteK = minuteKey(date)
  const day = bucket(state, dayK)
  if (state.minute.key !== minuteK) state.minute = { key: minuteK, count: 0 }
  state.minute.count += 1
  day.requests += 1
  state.totals.requests += 1
}

export function recordBlocked(state, date = new Date()) {
  const day = bucket(state, dayKey(date))
  day.blocked += 1
  state.totals.blocked += 1
}

/** 一次调用结束后落账。status: 'ok' | 'error' | 'aborted'。 */
export function settle(state, record) {
  const usage = record.usage || {}
  const day = bucket(state, record.day || dayKey())
  const tokens = tokenTotal(usage)
  const latencyMs = record.latencyMs

  for (const target of [day, state.totals]) {
    if (record.status === 'error') target.errors += 1
    target.inputTokens += usage.inputTokens || 0
    target.outputTokens += usage.outputTokens || 0
    target.cacheReadTokens += usage.cacheReadTokens || 0
    target.cacheWriteTokens += usage.cacheWriteTokens || 0
    target.reasoningTokens += usage.reasoningTokens || 0
    target.totalTokens += tokens
    target.costCny += asNum(record.costCny)
    addLatency(target, latencyMs)
  }

  const modelKey = `${record.provider}|${record.model}`
  const modelRow = day.byModel[modelKey] || (day.byModel[modelKey] = {
    provider: record.provider, model: record.model, requests: 0, errors: 0,
    totalTokens: 0, outputTokens: 0, costCny: 0, priced: record.priced === true,
    latencySumMs: 0, latencyCount: 0,
  })
  modelRow.requests += 1
  if (record.status === 'error') modelRow.errors += 1
  modelRow.totalTokens += tokens
  modelRow.outputTokens += usage.outputTokens || 0
  modelRow.costCny += asNum(record.costCny)
  addLatency(modelRow, latencyMs)
  if (record.priced) modelRow.priced = true

  const providerRow = day.byProvider[record.provider] || (day.byProvider[record.provider] = {
    provider: record.provider, requests: 0, errors: 0, totalTokens: 0,
  })
  providerRow.requests += 1
  if (record.status === 'error') providerRow.errors += 1
  providerRow.totalTokens += tokens
}

export function recordSwitch(state, date = new Date()) {
  const day = bucket(state, dayKey(date))
  day.switches += 1
  state.totals.switches += 1
}

export function snapshot(state, limits, date = new Date(), days = 7) {
  const dk = dayKey(date)
  const nowMinute = minuteKey(date)
  const day = state.days[dk] || { ...emptyCounters(), byModel: {}, byProvider: {} }
  const dailyTokens = asInt(limits.dailyTokens)
  const dailyRequests = asInt(limits.dailyRequests)
  const perMinuteRequests = asInt(limits.perMinuteRequests)
  const minuteUsed = state.minute.key === nowMinute ? state.minute.count : 0

  const models = Object.values(day.byModel || {})
    .map((row) => ({
      provider: row.provider,
      model: row.model,
      requests: row.requests || 0,
      errors: row.errors || 0,
      totalTokens: row.totalTokens || 0,
      outputTokens: row.outputTokens || 0,
      costCny: round(row.costCny),
      priced: row.priced === true,
      avgLatencyMs: avgLatencyOf(row),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
  const providers = Object.values(day.byProvider || {})
    .sort((a, b) => b.totalTokens - a.totalTokens)

  return {
    at: date.toISOString(),
    day: dk,
    today: { ...pickCounters(day), costCny: round(day.costCny), avgLatencyMs: avgLatencyOf(day) },
    totals: { ...pickCounters(state.totals), costCny: round(state.totals.costCny), avgLatencyMs: avgLatencyOf(state.totals) },
    limits: {
      dailyTokens,
      dailyRequests,
      perMinuteRequests,
      warnAt: asNum(limits.warnAt, 0.8),
      onExceed: limits.onExceed === 'warn' ? 'warn' : 'block',
    },
    remaining: {
      dailyTokens: dailyTokens > 0 ? Math.max(0, dailyTokens - day.totalTokens) : null,
      dailyRequests: dailyRequests > 0 ? Math.max(0, dailyRequests - day.requests) : null,
      perMinuteRequests: perMinuteRequests > 0 ? Math.max(0, perMinuteRequests - minuteUsed) : null,
    },
    perMinute: { used: minuteUsed, limit: perMinuteRequests },
    models,
    providers,
    history: historyOf(state, days, date),
  }
}

function addLatency(target, latencyMs) {
  if (latencyMs == null) return
  const value = Number(latencyMs)
  if (!Number.isFinite(value) || value < 0) return
  target.latencySumMs = (target.latencySumMs || 0) + value
  target.latencyCount = (target.latencyCount || 0) + 1
}

/** 只有看到过首字分片的请求才有样本；没有样本时给 0，而不是 NaN。 */
function avgLatencyOf(row) {
  const count = asInt(row?.latencyCount)
  return count > 0 ? Math.round(asNum(row?.latencySumMs) / count) : 0
}

function pickCounters(row) {
  return {
    requests: row.requests || 0,
    errors: row.errors || 0,
    blocked: row.blocked || 0,
    switches: row.switches || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheReadTokens: row.cacheReadTokens || 0,
    cacheWriteTokens: row.cacheWriteTokens || 0,
    reasoningTokens: row.reasoningTokens || 0,
    totalTokens: row.totalTokens || 0,
  }
}

function historyOf(state, days, date) {
  const wanted = Math.max(1, Math.min(KEEP_DAYS, asInt(days, 7)))
  const out = []
  for (let i = wanted - 1; i >= 0; i--) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - i)
    const key = dayKey(d)
    const row = state.days[key]
    out.push({
      day: key,
      requests: row?.requests || 0,
      errors: row?.errors || 0,
      blocked: row?.blocked || 0,
      switches: row?.switches || 0,
      totalTokens: row?.totalTokens || 0,
      costCny: round(row?.costCny || 0),
      avgLatencyMs: avgLatencyOf(row),
    })
  }
  return out
}
