import path from 'node:path'
import { dshHome, asInt, asNum, isObject } from './util.js'
import { normalizePrices } from './pricing.js'

export const DEFAULT_LIMITS = Object.freeze({
  dailyTokens: 0,
  dailyRequests: 0,
  perMinuteRequests: 0,
  warnAt: 0.8,
  onExceed: 'block',
})

/**
 * 不使用 schemastery：配置项少，手写规范化能把错误信息写清楚，也避免插件在
 * profile 里额外解析一份 schema。所有默认值集中在这里。
 */
export function normalizeConfig(input) {
  const raw = isObject(input) ? input : {}
  return {
    enabled: raw.enabled !== false,
    stateFile: typeof raw.stateFile === 'string' && raw.stateFile.trim()
      ? raw.stateFile.trim()
      : path.join(dshHome(), 'llm-guard', 'usage.json'),
    limits: normalizeLimits(raw.limits),
    prices: normalizePrices(raw.prices),
    pool: normalizePool(raw.pool),
  }
}

export function normalizeLimits(input) {
  const raw = isObject(input) ? input : {}
  return {
    dailyTokens: asInt(raw.dailyTokens, DEFAULT_LIMITS.dailyTokens),
    dailyRequests: asInt(raw.dailyRequests, DEFAULT_LIMITS.dailyRequests),
    perMinuteRequests: asInt(raw.perMinuteRequests, DEFAULT_LIMITS.perMinuteRequests),
    warnAt: Math.min(0.99, Math.max(0, asNum(raw.warnAt, DEFAULT_LIMITS.warnAt))),
    onExceed: raw.onExceed === 'warn' ? 'warn' : 'block',
  }
}

function normalizePool(input) {
  const raw = isObject(input) ? input : {}
  const accounts = []
  const ids = new Set()
  if (Array.isArray(raw.accounts)) {
    raw.accounts.forEach((account, index) => {
      const normalized = normalizeAccount(account, index)
      if (ids.has(normalized.id)) {
        throw new Error(`llm-guard: pool.accounts 中账号 id 重复：${normalized.id}`)
      }
      ids.add(normalized.id)
      accounts.push(normalized)
    })
  }
  return {
    provider: nonEmpty(raw.provider, 'guard-pool'),
    accounts,
    fallback: normalizeFallback(raw.fallback),
    cooldownMs: asInt(raw.cooldownMs, 60_000),
    maxAttempts: Math.max(1, asInt(raw.maxAttempts, 6)),
    timeoutMs: Math.max(1_000, asInt(raw.timeoutMs, 300_000)),
    contextWindow: asInt(raw.contextWindow, 0),
    allowAnyModel: raw.allowAnyModel === true,
  }
}

function normalizeAccount(account, index) {
  if (!isObject(account)) throw new Error(`llm-guard: pool.accounts[${index}] 必须是对象`)
  const baseURL = typeof account.baseURL === 'string' ? account.baseURL.trim() : ''
  if (!baseURL) throw new Error(`llm-guard: pool.accounts[${index}] 缺少 baseURL`)
  if (!/^https?:\/\//i.test(baseURL)) {
    throw new Error(`llm-guard: pool.accounts[${index}] 的 baseURL 必须以 http:// 或 https:// 开头`)
  }
  const apiKeyEnv = typeof account.apiKeyEnv === 'string' ? account.apiKeyEnv.trim() : ''
  const apiKey = typeof account.apiKey === 'string' ? account.apiKey.trim() : ''
  if (!apiKeyEnv && !apiKey) {
    throw new Error(`llm-guard: pool.accounts[${index}] 需要 apiKeyEnv（推荐，密钥放环境变量）或 apiKey`)
  }
  return {
    id: nonEmpty(account.id, `account-${index + 1}`),
    baseURL: baseURL.replace(/\/+$/, ''),
    apiKeyEnv,
    apiKey,
    models: Array.isArray(account.models) ? account.models.map(String).filter(Boolean) : [],
    headers: isObject(account.headers) ? { ...account.headers } : {},
  }
}

function normalizeFallback(input) {
  const out = {}
  if (!isObject(input)) return out
  for (const [model, chain] of Object.entries(input)) {
    if (!Array.isArray(chain)) continue
    const list = chain.map(String).filter(Boolean)
    if (list.length) out[String(model)] = list
  }
  return out
}

function nonEmpty(value, fallback) {
  const s = typeof value === 'string' ? value.trim() : ''
  return s || fallback
}

/** 账号密钥只在请求时读取，绝不写日志、状态文件或错误消息。 */
export function apiKeyOf(account) {
  if (account.apiKey) return account.apiKey
  if (!account.apiKeyEnv) return ''
  return String(process.env[account.apiKeyEnv] || '').trim()
}
