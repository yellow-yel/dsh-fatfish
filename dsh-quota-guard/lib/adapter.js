import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm'
import { apiKeyOf } from './config.js'
import {
  buildBody, readSSE, readErrorBody, errorFromPayload, mapFinish, mapUsage, StreamAssembler, UpstreamError,
} from './wire.js'

const PROVIDER_NAME = 'LLM Guard 账号池'

/** 失败分类决定冷却时长：密钥错/欠费要人工处理，限流等一下就好。 */
export function classifyFailure(error, baseCooldownMs = 60_000) {
  const status = Number(error?.status) || 0
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (status === 401 || status === 403) return { code: 'AUTH', cooldownMs: 600_000 }
  if (status === 402 || code === '1113' || /欠费|arrearage|insufficient|balance/i.test(message)) {
    return { code: 'ARREARAGE', cooldownMs: 600_000 }
  }
  if (status === 429) return { code: 'RATE_LIMIT', cooldownMs: Math.max(Number(error?.retryAfterMs) || 0, baseCooldownMs) }
  if (status === 404) return { code: 'NO_MODEL', cooldownMs: 600_000 }
  return { code: code || 'UPSTREAM', cooldownMs: baseCooldownMs }
}

function abortError() {
  return new LlmError('模型请求已取消', 'ABORTED')
}

function toLlmError(error, signal) {
  if (signal?.aborted || error?.code === 'ABORTED') return abortError()
  if (error instanceof UpstreamError) {
    return new LlmError(error.message, error.code || 'UPSTREAM', error.status ? { status: error.status } : undefined)
  }
  return new LlmError(String(error?.message || error || 'upstream failure').slice(0, 300), 'UPSTREAM')
}

/**
 * 把多个 OpenAI 兼容账号/模型合成一个提供方路由。
 *
 * 只在"还没有向调用方吐出任何分片"时换号：一旦开始流式输出，回退会重复内容，
 * 此时宁可让错误沿协议向上传递。
 */
export class PoolAdapter extends LlmAdapter {
  constructor(options) {
    super()
    this.provider = options.provider
    this.accounts = options.accounts
    this.fallback = options.fallback || {}
    this.cooldownMs = options.cooldownMs || 60_000
    this.maxAttempts = options.maxAttempts || 6
    this.timeoutMs = options.timeoutMs || 300_000
    this.contextWindow = options.contextWindow || 0
    this.allowAnyModel = options.allowAnyModel === true
    this.onSwitch = options.onSwitch || (() => {})
    this.log = options.log || {}
    this.cool = new Map()
  }

  providerInfo(provider) {
    return { id: provider, name: `${PROVIDER_NAME}（${this.accounts.length} 个账号）` }
  }

  async listModels() {
    const out = []
    const seen = new Set()
    for (const account of this.accounts) {
      for (const model of account.models) {
        if (seen.has(model)) continue
        seen.add(model)
        out.push({ provider: this.provider, id: model, name: model })
      }
    }
    return out
  }

  async resolveModel(provider, model) {
    const info = { provider, id: model, name: model }
    if (this.contextWindow > 0) info.context = { contextWindow: this.contextWindow }
    return info
  }

  /** 报告用的池健康快照；不触发任何网络请求。 */
  health() {
    const now = Date.now()
    return this.accounts.map((account) => {
      const cooling = account.models
        .map((model) => ({ model, until: this.cool.get(`${account.id}|${model}`) || 0 }))
        .filter((row) => row.until > now)
      return {
        id: account.id,
        models: [...account.models],
        coolingUntil: cooling.length ? new Date(Math.min(...cooling.map((row) => row.until))).toISOString() : null,
      }
    })
  }

  candidates(requested) {
    const chain = []
    const seen = new Set()
    const push = (account, model) => {
      const key = `${account.id}|${model}`
      if (seen.has(key)) return
      seen.add(key)
      chain.push({ account, model, key })
    }
    for (const model of [requested, ...(this.fallback[requested] || [])]) {
      for (const account of this.accounts) {
        if (account.models.length && !account.models.includes(model)) continue
        push(account, model)
      }
    }
    if (!chain.length && this.allowAnyModel) {
      for (const account of this.accounts) for (const model of account.models) push(account, model)
    }
    return chain
  }

  nextCandidate(chain, tried) {
    const now = Date.now()
    let fallback = null
    for (const candidate of chain) {
      if (tried.has(candidate.key)) continue
      const until = this.cool.get(candidate.key) || 0
      if (until <= now) return candidate
      if (!fallback || until < fallback.until) fallback = { candidate, until }
    }
    // 全部在冷却：挑最早解冻的那个再试，不让一次限流把整条路由钉死。
    return fallback ? fallback.candidate : null
  }

  markFailure(candidate, error) {
    if (error?.code === 'ABORTED') return
    const info = classifyFailure(error, this.cooldownMs)
    this.cool.set(candidate.key, Date.now() + info.cooldownMs)
    return info
  }

  markSuccess(candidate) {
    this.cool.delete(candidate.key)
  }

  async open(candidate, key, options) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)
    timer.unref?.()
    const onAbort = () => controller.abort()
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer)
        return { ok: false, error: new UpstreamError('已取消', { code: 'ABORTED' }) }
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }
    const cleanup = () => {
      clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
    }

    let response
    try {
      response = await fetch(`${candidate.account.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: `Bearer ${key}`,
          ...attributionHeaders(),
          ...candidate.account.headers,
        },
        body: JSON.stringify(buildBody(options, candidate.model)),
        signal: controller.signal,
      })
    } catch (error) {
      cleanup()
      if (options.signal?.aborted) return { ok: false, error: new UpstreamError('已取消', { code: 'ABORTED' }) }
      return {
        ok: false,
        error: new UpstreamError(
          timedOut ? `请求超时（${this.timeoutMs}ms）` : String(error?.message || error),
          { code: timedOut ? 'TIMEOUT' : 'TRANSPORT' },
        ),
      }
    }

    if (!response.ok) {
      const info = await readErrorBody(response)
      cleanup()
      try {
        await response.body?.cancel()
      } catch {}
      return { ok: false, error: info }
    }

    return { ok: true, response, cleanup }
  }

  async *translate(response) {
    const assembler = new StreamAssembler()
    let usage = null
    let finishReason = null

    for await (const event of readSSE(response.body)) {
      if (event && event.error) throw errorFromPayload(event.error, response.status)
      const rawUsage = event?.usage
      if (rawUsage) usage = mapUsage(rawUsage) || usage

      const choice = event?.choices?.[0]
      if (!choice) continue
      const delta = choice.delta || {}

      const reasoning = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : ''
      for (const chunk of assembler.reasoning(reasoning)) yield chunk
      if (typeof delta.content === 'string') {
        for (const chunk of assembler.text(delta.content)) yield chunk
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          for (const chunk of assembler.toolCall(call)) yield chunk
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason
    }

    for (const chunk of assembler.close()) yield chunk
    if (usage) yield { type: 'usage', usage }
    yield { type: 'finish', reason: mapFinish(finishReason, assembler.sawToolCall) }
  }

  async *stream(options) {
    const chain = this.candidates(options.model)
    if (!chain.length) {
      const known = this.accounts.flatMap((account) => account.models)
      throw new LlmError(
        `llm-guard 账号池没有可用模型：请求的是 ${options.model}，池内是 ${known.join(', ') || '(空)'}；`
        + '请配置 pool.fallback 或把该模型加入某个账号的 models',
        'GUARD_POOL_NO_MODEL',
      )
    }

    const tried = new Set()
    const failures = []
    let attempts = 0

    while (attempts < this.maxAttempts) {
      const candidate = this.nextCandidate(chain, tried)
      if (!candidate) break
      tried.add(candidate.key)
      attempts += 1

      const label = `${candidate.account.id}/${candidate.model}`
      const key = apiKeyOf(candidate.account)
      if (!key) {
        failures.push(`${label}: 缺少密钥（${candidate.account.apiKeyEnv || 'apiKeyEnv 未配置'}）`)
        this.cool.set(candidate.key, Date.now() + 600_000)
        continue
      }

      const attempt = await this.open(candidate, key, options)
      if (!attempt.ok) {
        if (attempt.error.code === 'ABORTED') throw abortError()
        const info = this.markFailure(candidate, attempt.error)
        failures.push(`${label}: ${attempt.error.message}`)
        this.log.warn?.(`账号池跳过 ${label}：${info.code} ${attempt.error.message}`)
        continue
      }

      const iterator = this.translate(attempt.response)[Symbol.asyncIterator]()
      let first
      try {
        first = await iterator.next()
      } catch (error) {
        attempt.cleanup()
        if (options.signal?.aborted) throw abortError()
        const upstream = error instanceof UpstreamError
          ? error
          : new UpstreamError(String(error?.message || error), { code: 'STREAM' })
        this.markFailure(candidate, upstream)
        failures.push(`${label}: ${upstream.message}`)
        this.log.warn?.(`账号池流未开始即失败 ${label}：${upstream.code} ${upstream.message}`)
        continue
      }

      if (first.done) {
        attempt.cleanup()
        await iterator.return?.()
        const empty = new UpstreamError('空响应', { code: 'EMPTY_RESPONSE' })
        this.markFailure(candidate, empty)
        failures.push(`${label}: 空响应`)
        continue
      }

      this.markSuccess(candidate)
      if (attempts > 1) this.onSwitch(failures[0] || '?', label, attempts)

      try {
        yield first.value
        while (true) {
          let next
          try {
            next = await iterator.next()
          } catch (error) {
            throw toLlmError(error, options.signal)
          }
          if (next.done) break
          yield next.value
        }
      } finally {
        attempt.cleanup()
        try {
          await iterator.return?.()
        } catch {}
      }
      return
    }

    throw new LlmError(
      `llm-guard 账号池全部失败（尝试 ${attempts} 次）：${failures.join('；') || '无可用账号'}`,
      'GUARD_POOL_EXHAUSTED',
    )
  }
}
