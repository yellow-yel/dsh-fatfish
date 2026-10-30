import { LlmError } from '@deepseek-ai/dsh-llm'

/**
 * 把 harness 的消息词汇翻译成 OpenAI Chat Completions 线格式。
 * 只实现账号池真正需要的子集：文本、工具调用、工具结果。
 */

function textOf(blocks) {
  let out = ''
  for (const block of blocks || []) {
    if (block.type === 'text') out += block.text
  }
  return out
}

function assertNoImage(blocks, where) {
  for (const block of blocks || []) {
    if (block.type === 'image') {
      throw new LlmError(
        `llm-guard 账号池是纯文本通道，不支持图片输入（${where}）；请把这条会话切回原生提供方`,
        'UNSUPPORTED_OPTION',
      )
    }
    if (block.type === 'tool-result') assertNoImage(block.content, 'tool-result')
  }
}

export function toWireMessages(options) {
  const out = []
  const system = typeof options.system === 'string' ? options.system.trim() : ''
  if (system) out.push({ role: 'system', content: system })

  for (const message of options.messages || []) {
    assertNoImage(message.content, 'messages')

    if (message.role === 'system') {
      const text = textOf(message.content)
      if (text) out.push({ role: 'system', content: text })
      continue
    }

    if (message.source && message.source.kind === 'tool') {
      let pushed = 0
      for (const block of message.content || []) {
        if (block.type !== 'tool-result') continue
        out.push({ role: 'tool', tool_call_id: String(block.toolCallId), content: textOf(block.content) })
        pushed += 1
      }
      // 没有 tool-result 块却标了 tool 来源：退化成普通用户消息，别把内容丢掉。
      if (!pushed) out.push({ role: 'user', content: textOf(message.content) })
      continue
    }

    if (message.role === 'assistant') {
      const text = textOf(message.content)
      const calls = (message.content || []).filter((block) => block.type === 'tool-call')
      const wire = { role: 'assistant', content: text || (calls.length ? null : '') }
      if (calls.length) {
        wire.tool_calls = calls.map((block) => ({
          id: String(block.id),
          type: 'function',
          function: { name: block.name, arguments: block.arguments || '{}' },
        }))
      }
      out.push(wire)
      continue
    }

    out.push({ role: 'user', content: textOf(message.content) })
  }
  return out
}

export function buildBody(options, model) {
  const body = {
    model,
    messages: toWireMessages(options),
    stream: true,
    stream_options: { include_usage: true },
  }
  if (typeof options.temperature === 'number') body.temperature = options.temperature
  if (options.maxTokens) body.max_tokens = options.maxTokens
  if (Array.isArray(options.stop) && options.stop.length) body.stop = options.stop
  if (Array.isArray(options.tools) && options.tools.length) {
    body.tools = options.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
    body.tool_choice = 'auto'
  }
  return body
}

/** 上游错误（HTTP 非 2xx，或 SSE 里的 error 对象）。 */
export class UpstreamError extends Error {
  constructor(message, { status = 0, code = 'UPSTREAM', retryAfterMs = 0, body = '' } = {}) {
    super(message)
    this.name = 'UpstreamError'
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
    this.body = body
  }
}

export function errorFromPayload(error, status = 0) {
  const message = typeof error === 'string'
    ? error
    : String(error?.message || error?.msg || error?.type || 'upstream error')
  const code = String(error?.code || error?.type || 'UPSTREAM')
  return new UpstreamError(message.slice(0, 300), { status, code })
}

export async function readErrorBody(response) {
  let text = ''
  try {
    text = (await response.text()).slice(0, 2000)
  } catch {}
  let message = text.trim() || response.statusText || 'upstream error'
  let code = 'UPSTREAM'
  try {
    const parsed = JSON.parse(text)
    const payload = parsed?.error ?? parsed
    if (payload && typeof payload === 'object') {
      if (payload.message) message = String(payload.message)
      if (payload.code != null) code = String(payload.code)
      if (payload.type && code === 'UPSTREAM') code = String(payload.type)
    }
  } catch {}
  return new UpstreamError(message.slice(0, 300), {
    status: response.status,
    code,
    retryAfterMs: parseRetryAfter(response.headers),
    body: text.slice(0, 500),
  })
}

export function parseRetryAfter(headers) {
  const raw = headers?.get?.('retry-after')
  if (!raw) return 0
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(600_000, seconds * 1000)
  const at = Date.parse(raw)
  if (Number.isFinite(at)) return Math.max(0, Math.min(600_000, at - Date.now()))
  return 0
}

/** 逐行解析 SSE。只关心 `data:`，`[DONE]` 结束，坏行直接跳过。 */
export async function* readSSE(body) {
  if (!body || typeof body.getReader !== 'function') return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = parseLine(buffer.slice(0, cut))
        buffer = buffer.slice(cut + 1)
        if (line === null) continue
        if (line === '[DONE]') {
          finished = true
          return
        }
        try {
          yield JSON.parse(line)
        } catch {}
      }
    }
    const tail = parseLine(buffer)
    if (tail && tail !== '[DONE]') {
      try {
        yield JSON.parse(tail)
      } catch {}
    }
  } finally {
    if (!finished) {
      try {
        await reader.cancel()
      } catch {}
    }
    try {
      reader.releaseLock()
    } catch {}
  }
}

function parseLine(raw) {
  let line = raw
  if (line.endsWith('\r')) line = line.slice(0, -1)
  if (!line.startsWith('data:')) return null
  const data = line.slice(5).trim()
  return data || null
}

/**
 * OpenAI usage → TokenUsage。计数口径是互斥的：inputTokens 不含缓存。
 */
export function mapUsage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const prompt = Number(raw.prompt_tokens ?? raw.input_tokens)
  if (!Number.isFinite(prompt)) return null
  const completion = Number(raw.completion_tokens ?? raw.output_tokens) || 0
  const cacheRead = Number(
    raw.prompt_tokens_details?.cached_tokens ?? raw.cache_read_input_tokens,
  ) || 0
  const cacheWrite = Number(raw.cache_creation_input_tokens) || 0
  const reasoning = Number(raw.completion_tokens_details?.reasoning_tokens) || 0

  const usage = {
    inputTokens: Math.max(0, prompt - cacheRead - cacheWrite),
    outputTokens: Math.max(0, completion),
  }
  if (cacheRead > 0) usage.cacheReadTokens = cacheRead
  if (cacheWrite > 0) usage.cacheWriteTokens = cacheWrite
  if (reasoning > 0) usage.reasoningTokens = reasoning
  return usage
}

export function mapFinish(reason, sawToolCall) {
  if (reason === 'length' || reason === 'max_tokens') return { kind: 'max-tokens' }
  if (reason === 'tool_calls' || reason === 'function_call') return { kind: 'tool-calls' }
  if (!reason) return sawToolCall ? { kind: 'tool-calls' } : { kind: 'stop' }
  return { kind: 'stop' }
}

const safeId = (id, index) =>
  typeof id === 'string' && id.trim() ? id.trim() : `call_${index}`

/**
 * 把上游增量拼成 block 协议。文本/推理是顺序块，工具调用各自独立、并行累积，
 * 统一在 finish 前按 index 顺序收尾。
 */
export class StreamAssembler {
  constructor() {
    this.nextIndex = 0
    this.current = null
    this.tools = new Map()
    this.sawToolCall = false
  }

  _open(type) {
    this.current = { index: this.nextIndex++, type, text: '' }
    return { type: 'block-start', index: this.current.index, blockType: type }
  }

  _closeCurrent(out) {
    const block = this.current
    if (!block) return
    this.current = null
    out.push({
      type: 'block-end',
      index: block.index,
      block: { type: block.type, text: block.text },
    })
  }

  text(delta) {
    const out = []
    if (!delta) return out
    if (!this.current || this.current.type !== 'text') {
      this._closeCurrent(out)
      out.push(this._open('text'))
    }
    this.current.text += delta
    out.push({ type: 'text-delta', index: this.current.index, text: delta })
    return out
  }

  reasoning(delta) {
    const out = []
    if (!delta) return out
    if (!this.current || this.current.type !== 'reasoning') {
      this._closeCurrent(out)
      out.push(this._open('reasoning'))
    }
    this.current.text += delta
    out.push({ type: 'reasoning-delta', index: this.current.index, text: delta })
    return out
  }

  toolCall(delta) {
    const out = []
    const slot = Number.isInteger(delta?.index) ? delta.index : 0
    let block = this.tools.get(slot)
    if (!block) {
      block = { index: this.nextIndex++, id: '', name: '', args: '' }
      this.tools.set(slot, block)
      this.sawToolCall = true
      out.push({ type: 'block-start', index: block.index, blockType: 'tool-call' })
    }
    if (delta.id) block.id = String(delta.id)
    if (delta.function?.name) block.name = String(delta.function.name)
    const argsDelta = typeof delta.function?.arguments === 'string' ? delta.function.arguments : ''
    block.args += argsDelta
    out.push({
      type: 'tool-call-delta',
      index: block.index,
      id: safeId(block.id, block.index),
      ...(delta.function?.name ? { name: String(delta.function.name) } : {}),
      argumentsDelta: argsDelta,
    })
    return out
  }

  close() {
    const out = []
    this._closeCurrent(out)
    const tools = [...this.tools.values()].sort((a, b) => a.index - b.index)
    for (const block of tools) {
      out.push({
        type: 'block-end',
        index: block.index,
        block: {
          type: 'tool-call',
          id: safeId(block.id, block.index),
          name: block.name || 'tool',
          arguments: block.args || '{}',
        },
      })
    }
    this.tools.clear()
    return out
  }
}
