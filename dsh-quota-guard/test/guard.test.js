import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'
import * as store from '../lib/store.js'

function fakeCtx() {
  const handlers = new Map()
  const disposers = []
  const tools = new Map()
  return {
    handlers,
    disposers,
    tools,
    ctx: {
      logger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
      on(event, handler) {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      },
      effect(fn) {
        const disposer = fn()
        disposers.push(disposer)
        return disposer
      },
      get(name) {
        return this[name]
      },
      llm: {
        registerAdapter() {
          throw new Error('本用例不应注册账号池')
        },
      },
      tools: {
        register(definition) {
          tools.set(definition.name, definition)
          return () => tools.delete(definition.name)
        },
      },
    },
  }
}

function tempStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-guard-'))
  return { dir, file: path.join(dir, 'usage.json') }
}

function upstream(text = 'ok') {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

const collect = async (stream) => {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

test('放行时计量 token，超限后在下一次请求前拦截且不再调用下游', async () => {
  const { dir, file } = tempStateFile()
  const { ctx, handlers, disposers } = fakeCtx()
  apply(ctx, { stateFile: file, limits: { dailyRequests: 1 } })

  const handler = handlers.get('llm/stream')
  assert.equal(typeof handler, 'function')

  const chunks = await collect(handler({ provider: 'p', model: 'm', messages: [] }, () => upstream()))
  assert.equal(chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), 'ok')

  let downstreamCalls = 0
  const second = handler({ provider: 'p', model: 'm', messages: [] }, () => {
    downstreamCalls += 1
    return upstream()
  })
  await assert.rejects(async () => collect(second), (error) => {
    assert.equal(error.code, 'GUARD_LIMIT')
    assert.match(error.message, /今日请求数达到上限/)
    return true
  })
  assert.equal(downstreamCalls, 0)

  for (const dispose of disposers) dispose?.()
  const state = store.load(file)
  assert.equal(state.days[Object.keys(state.days)[0]].requests, 1)
  assert.equal(state.days[Object.keys(state.days)[0]].latencyCount, 1)
  assert.equal(state.totals.totalTokens, 120)
  assert.equal(state.days[Object.keys(state.days)[0]].blocked, 1)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('onExceed=warn 时只告警不拦截，账本继续累计', async () => {
  const { dir, file } = tempStateFile()
  const { ctx, handlers, disposers } = fakeCtx()
  apply(ctx, { stateFile: file, limits: { dailyRequests: 1, onExceed: 'warn' } })

  const handler = handlers.get('llm/stream')
  await collect(handler({ provider: 'p', model: 'm', messages: [] }, () => upstream()))
  await collect(handler({ provider: 'p', model: 'm', messages: [] }, () => upstream()))

  for (const dispose of disposers) dispose?.()
  const state = store.load(file)
  const day = state.days[Object.keys(state.days)[0]]
  assert.equal(day.requests, 2)
  assert.equal(day.blocked, 0)
  assert.equal(day.totalTokens, 240)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('报告工具只读账本并给出剩余额度', async () => {
  const { dir, file } = tempStateFile()
  const { ctx, handlers, tools, disposers } = fakeCtx()
  apply(ctx, { stateFile: file, limits: { dailyTokens: 1000 } })

  const handler = handlers.get('llm/stream')
  await collect(handler({ provider: 'p', model: 'm', messages: [] }, () => upstream()))

  const tool = tools.get('llm_guard_report')
  assert.equal(typeof tool.execute, 'function')
  const report = await tool.execute({ days: 2 })

  assert.equal(report.today.requests, 1)
  assert.equal(report.today.totalTokens, 120)
  assert.equal(report.today.avgLatencyMs >= 0, true)
  assert.equal(report.remaining.dailyTokens, 880)
  assert.equal(report.models[0].model, 'm')
  assert.equal(report.models[0].avgLatencyMs >= 0, true)
  assert.equal(report.history.length, 2)
  assert.equal(report.pool, undefined)
  assert.deepEqual(tool.output.render([], { hello: 'world' }), [{ type: 'text', text: JSON.stringify({ hello: 'world' }, null, 2) }])

  for (const dispose of disposers) dispose?.()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('关闭开关后完全放行且不记账', async () => {
  const { dir, file } = tempStateFile()
  const { ctx, handlers, disposers } = fakeCtx()
  apply(ctx, { enabled: false, stateFile: file, limits: { dailyRequests: 1 } })

  const handler = handlers.get('llm/stream')
  await collect(handler({ provider: 'p', model: 'm', messages: [] }, () => upstream()))
  await collect(handler({ provider: 'p', model: 'm', messages: [] }, () => upstream()))

  for (const dispose of disposers) dispose?.()
  const state = store.load(file)
  assert.equal(Object.keys(state.days).length, 0)

  fs.rmSync(dir, { recursive: true, force: true })
})
