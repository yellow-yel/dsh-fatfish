import { asNum } from './util.js'

/**
 * 价格单位：人民币 / 百万 token。
 *
 * 默认不内置任何价格：不同厂商、不同地区、不同时间的报价差异很大，写死一张表
 * 只会给出看似精确的错数。未配置价格的模型照常统计 token，`costCny` 记为 0 且
 * `priced: false`，报告里会明确标出这是"未定价"而不是"免费"。
 */
export const EMPTY_PRICES = Object.freeze({})

/** 把配置里的价格表规范化；键既可以是完整模型名，也可以是 `prefix*` 通配。 */
export function normalizePrices(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  for (const [key, value] of Object.entries(input)) {
    if (!value || typeof value !== 'object') continue
    const inPrice = asNum(value.in ?? value.input, NaN)
    const outPrice = asNum(value.out ?? value.output, NaN)
    if (!Number.isFinite(inPrice) && !Number.isFinite(outPrice)) continue
    out[String(key)] = {
      in: Number.isFinite(inPrice) ? inPrice : 0,
      out: Number.isFinite(outPrice) ? outPrice : 0,
    }
  }
  return out
}

/** 精确匹配优先；否则取最长匹配的 `prefix*` 通配。 */
export function priceOf(model, prices) {
  if (!model || !prices) return null
  if (prices[model]) return prices[model]
  let best = null
  for (const [pattern, price] of Object.entries(prices)) {
    if (!pattern.endsWith('*')) continue
    const prefix = pattern.slice(0, -1)
    if (!prefix || !model.startsWith(prefix)) continue
    if (!best || prefix.length > best.prefix.length) best = { prefix, price }
  }
  return best ? best.price : null
}

/**
 * 计费口径与 dsh-llm 的 TokenUsage 一致：input 不含缓存，缓存读写单独计价。
 * reasoningTokens 已经包含在 outputTokens 内，不重复累加。
 */
export function costOf(model, usage, prices) {
  const price = priceOf(model, prices)
  if (!price) return { costCny: 0, priced: false }
  const inputTokens = (usage.inputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
  const outputTokens = usage.outputTokens || 0
  const costCny = (inputTokens * price.in + outputTokens * price.out) / 1e6
  return { costCny, priced: true }
}
