import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as store from '../lib/store.js'
import { normalizeLimits } from '../lib/config.js'

const at = (iso) => new Date(iso)

test('check 按每日请求数给出结论，跨天自动恢复', () => {
  const state = store.emptyState()
  const limits = normalizeLimits({ dailyRequests: 2 })

  const first = store.check(state, limits, at('2026-10-30T10:00:00'))
  assert.equal(first.allowed, true)
  store.count(state, at('2026-10-30T10:00:00'))

  assert.equal(store.check(state, limits, at('2026-10-30T10:00:01')).allowed, true)
  store.count(state, at('2026-10-30T10:00:01'))

  const blocked = store.check(state, limits, at('2026-10-30T10:00:02'))
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.kind, 'dailyRequests')
  store.recordBlocked(state, at('2026-10-30T10:00:02'))

  assert.equal(state.days['2026-10-30'].requests, 2)
  assert.equal(state.days['2026-10-30'].blocked, 1)
  assert.equal(store.check(state, limits, at('2026-10-31T00:00:01')).allowed, true)
})

test('check 按分钟限流，跨分钟清零', () => {
  const state = store.emptyState()
  const limits = normalizeLimits({ perMinuteRequests: 2 })

  store.count(state, at('2026-10-30T10:00:00'))
  store.count(state, at('2026-10-30T10:00:30'))
  const blocked = store.check(state, limits, at('2026-10-30T10:00:59'))
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.kind, 'perMinuteRequests')
  assert.equal(store.check(state, limits, at('2026-10-30T10:01:00')).allowed, true)
})

test('check 用当日 token 总量判定，并给出接近上限的警告', () => {
  const state = store.emptyState()
  const limits = normalizeLimits({ dailyTokens: 1000, warnAt: 0.5 })
  store.settle(state, {
    day: '2026-10-30', provider: 'p', model: 'm', status: 'ok', costCny: 0,
    usage: { inputTokens: 400, outputTokens: 200 },
  })
  const decision = store.check(state, limits, at('2026-10-30T12:00:00'))
  assert.equal(decision.allowed, true)
  assert.equal(decision.warn, true)
  assert.ok(decision.ratio >= 0.6)

  store.settle(state, {
    day: '2026-10-30', provider: 'p', model: 'm', status: 'ok', costCny: 0,
    usage: { inputTokens: 300, outputTokens: 200 },
  })
  const blocked = store.check(state, limits, at('2026-10-30T12:01:00'))
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.kind, 'dailyTokens')
})

test('settle 汇总到当日与累计，并分模型/提供方记账', () => {
  const state = store.emptyState()
  store.settle(state, {
    day: '2026-10-30', provider: 'p', model: 'm', status: 'ok', costCny: 0.5, priced: true,
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 },
  })
  store.settle(state, {
    day: '2026-10-30', provider: 'p', model: 'm', status: 'error', costCny: 0,
    usage: { inputTokens: 10 },
  })

  const day = state.days['2026-10-30']
  assert.equal(day.totalTokens, 160)
  assert.equal(day.errors, 1)
  assert.equal(day.byModel['p|m'].requests, 2)
  assert.equal(day.byModel['p|m'].priced, true)
  assert.equal(day.byProvider.p.totalTokens, 160)
  assert.equal(state.totals.totalTokens, 160)
})

test('snapshot 给出限额剩余、未定价标记与历史趋势', () => {
  const state = store.emptyState()
  const limits = normalizeLimits({ dailyTokens: 500, dailyRequests: 10, perMinuteRequests: 3 })
  store.count(state, at('2026-10-30T09:00:00'))
  store.settle(state, {
    day: '2026-10-30', provider: 'p', model: 'm', status: 'ok', costCny: 0,
    usage: { inputTokens: 200, outputTokens: 100 },
  })

  const report = store.snapshot(state, limits, at('2026-10-30T09:00:30'), 3)
  assert.equal(report.today.totalTokens, 300)
  assert.equal(report.remaining.dailyTokens, 200)
  assert.equal(report.remaining.dailyRequests, 9)
  assert.equal(report.remaining.perMinuteRequests, 2)
  assert.equal(report.models[0].model, 'm')
  assert.equal(report.models[0].priced, false)
  assert.equal(report.history.length, 3)
  assert.equal(report.history.at(-1).day, '2026-10-30')
  assert.equal(report.history.at(-1).totalTokens, 300)
})

test('settle 累计首字延迟，snapshot 给出平均值', () => {
  const state = store.emptyState()
  const limits = normalizeLimits({})
  const settle = (latencyMs) => store.settle(state, {
    day: '2026-10-30', provider: 'p', model: 'm', status: 'ok', costCny: 0, latencyMs, usage: {},
  })
  settle(100)
  settle(300)
  settle(null)

  const report = store.snapshot(state, limits, at('2026-10-30T12:00:00'), 1)
  assert.equal(report.today.avgLatencyMs, 200)
  assert.equal(report.totals.avgLatencyMs, 200)
  assert.equal(report.models[0].avgLatencyMs, 200)
  assert.equal(report.history.at(-1).avgLatencyMs, 200)
  assert.equal(report.models[0].requests, 3)
})

test('没有任何首字样本时平均延迟是 0 而不是 NaN', () => {
  const state = store.emptyState()
  store.settle(state, {
    day: '2026-10-30', provider: 'p', model: 'm', status: 'error', costCny: 0, latencyMs: null,
    usage: { inputTokens: 5 },
  })
  const report = store.snapshot(state, normalizeLimits({}), at('2026-10-30T12:00:00'), 1)
  assert.equal(report.today.avgLatencyMs, 0)
  assert.equal(report.models[0].avgLatencyMs, 0)
})

test('损坏或版本不符的账本先备份再重新开始，缺文件时不产生备份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-guard-state-'))
  const file = path.join(dir, 'usage.json')
  const backup = `${file}.corrupt`

  const missing = store.load(path.join(dir, 'absent.json'))
  assert.deepEqual(Object.keys(missing.days), [])
  assert.equal(fs.existsSync(`${path.join(dir, 'absent.json')}.corrupt`), false)

  fs.writeFileSync(file, '{"version":1,"days":', 'utf8')
  const warnings = []
  const broken = store.load(file, { warn: (message) => warnings.push(message) })
  assert.deepEqual(Object.keys(broken.days), [])
  assert.equal(fs.readFileSync(backup, 'utf8'), '{"version":1,"days":')
  assert.equal(warnings.length, 1)
  assert.equal(fs.existsSync(file), false)

  fs.writeFileSync(file, JSON.stringify({ version: 99, days: {} }), 'utf8')
  store.load(file)
  assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).version, 99)
  assert.equal(fs.existsSync(file), false)

  fs.rmSync(dir, { recursive: true, force: true })
})
