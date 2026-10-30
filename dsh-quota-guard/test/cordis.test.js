import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as guard from '../index.js'

/**
 * 用真实的 cordis Context 跑一遍插件生命周期：服务注入、waterfall 监听、
 * 工具注册、超限拦截、释放时落盘。假 ctx 的单元测试证明不了这些。
 */
test('真实 cordis 生命周期：注册、拦截、释放落盘', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-guard-cordis-'))
  const file = path.join(dir, 'usage.json')

  const root = new Context()
  const tools = new Map()
  const fakeLlm = { registerAdapter: () => () => {} }
  root.provide('llm', fakeLlm)
  root.provide('tools', {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  })

  const fiber = await root.plugin(guard, { stateFile: file, limits: { dailyRequests: 1 } })
  assert.equal(tools.has('llm_guard_report'), true)

  const options = { provider: 'p', model: 'm', messages: [] }
  const upstream = () => (async function* () {
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()

  const first = []
  for await (const chunk of root.waterfall(fakeLlm, 'llm/stream', options, upstream)) first.push(chunk)
  assert.equal(first.at(-1).type, 'finish')

  await assert.rejects(async () => {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of root.waterfall(fakeLlm, 'llm/stream', options, upstream)) { /* 不会产出 */ }
  }, (error) => error.code === 'GUARD_LIMIT')

  const report = await tools.get('llm_guard_report').execute({})
  assert.equal(report.today.totalTokens, 7)

  await fiber.dispose()
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(state.totals.totalTokens, 7)
  assert.equal(state.totals.blocked, 1)

  fs.rmSync(dir, { recursive: true, force: true })
})
