/**
 * 冒烟测试：node test/smoke.mjs
 *
 * 覆盖记忆抽取、人设文本、动作、病毒库合并与路径扫描，不联网。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-smoke-'))
process.env.FATFISH_DATA = dataDir

const memory = await import('../lib/memory.js')
const persona = await import('../lib/persona.js')
const security = await import('../lib/security.js')
const actions = await import('../lib/actions.js')

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('  ✓', name)
  } catch (e) {
    failed++
    console.error('  ✘', name, '—', e.message)
  }
}

await check('自动抽取名字/生日/喜好/习惯', () => {
  const facts = memory.autoCapture('我叫小满，我喜欢喝茉莉花茶，我的生日是3月5日，我每天早上跑步')
  const texts = facts.map((f) => f.text)
  assert.ok(texts.includes('主人叫小满'), texts.join(' | '))
  assert.ok(texts.some((t) => t.includes('茉莉花茶')))
  assert.ok(texts.some((t) => t.includes('3月5日')))
  assert.ok(texts.some((t) => t.includes('跑步')))
  assert.ok(facts.every((f) => f.tags.includes('自动')))
})

await check('自动抽取跳过密码句', () => {
  const facts = memory.autoCapture('记住 我的密码是 abc12345')
  assert.equal(facts.length, 0)
  assert.equal(memory.memoryStats().total >= 4, true)
})

await check('重复事实合并而不是堆叠', () => {
  const before = memory.memoryStats().total
  const r = memory.saveFact({ text: '主人喜欢喝茉莉花茶', tags: ['茶'] })
  assert.equal(r.created, false)
  assert.equal(memory.memoryStats().total, before)
})

await check('按关键词召回并更新使用时间', () => {
  const facts = memory.recallFacts('生日是哪天', { limit: 3 })
  assert.ok(facts.length >= 1)
  assert.ok(facts[0].text.includes('生日'))
  const again = memory.recallFacts('生日是哪天', { limit: 3 })
  assert.ok(again[0].hits >= 1)
  assert.ok(again[0].lastUsedAt)
})

await check('遗忘：按查询删掉一条', () => {
  const r = memory.forgetFacts({ query: '生日' })
  assert.equal(r.removed.length, 1)
  assert.equal(memory.recallFacts('生日').length, 0)
})

await check('拒收手机号/银行卡/证件号', () => {
  assert.match(memory.containsSecret(`手机号是 ${'138'}${'00138000'}`), /手机号/)
  assert.match(memory.containsSecret(`卡号 ${'6222'}${'020200112233445'}`), /银行卡/)
  assert.match(memory.containsSecret(`身份证 ${'110105'}${'19491231002X'}`), /身份证/)
  assert.equal(memory.containsSecret('主人喜欢下雨天'), '')
})

await check('记忆条数上限生效', () => {
  for (let i = 0; i < 60; i++) {
    memory.saveFact({ text: `测试事实编号 ${i} 号`, maxFacts: 50 })
  }
  assert.ok(memory.memoryStats().total <= 50)
})

await check('人设文本含红线、工具和记忆', () => {
  const facts = memory.listFacts(3)
  const text = persona.buildPersonaText('normal', '', true, true, {
    memories: facts,
    memoryEnabled: true,
    securityEnabled: true,
  })
  assert.match(text, /红线/)
  assert.match(text, /fatfish_memory_save/)
  assert.match(text, /fatfish_security_scan/)
  assert.match(text, /fatfish_act/)
  assert.ok(facts.some((f) => text.includes(f.text)))
  assert.match(text, /现在是/)
  assert.match(text, /精力 \d+%/)
})

await check('三种人格与自定义', () => {
  assert.match(persona.buildPersonaText('roast', '', false, false), /毒舌/)
  assert.match(persona.buildPersonaText('sleepy', '', false, false), /犯困/)
  assert.match(persona.buildPersonaText('custom', '说话像教书先生', false, false), /教书先生/)
  assert.match(persona.buildPersonaText('nope', '', false, false), /好脾气/)
  assert.doesNotMatch(persona.buildPersonaText('custom', 'x'.repeat(999), false, false), /x{700}/)
})

await check('时段/精力/心情', () => {
  assert.equal(persona.getPeriod(3), '深夜')
  assert.equal(persona.getPeriod(7), '早上')
  assert.equal(persona.getPeriod(10), '上午')
  assert.equal(persona.getPeriod(13), '中午')
  assert.equal(persona.getPeriod(16), '下午')
  assert.equal(persona.getPeriod(20), '晚上')
  assert.equal(persona.getPeriod(23), '深夜')
  assert.ok(persona.energyTarget(3) < persona.energyTarget(10))
  assert.equal(persona.moodLabel(0.1), '困得睁不开眼')
  assert.equal(persona.moodLabel(0.9), '元气满满')
})

await check('动作有文字且能拒绝未知动作', () => {
  for (const key of Object.keys(actions.ACTIONS)) {
    const r = actions.performAction(key)
    assert.equal(r.ok, true, key)
    assert.ok(r.label && r.text)
  }
  const bad = actions.performAction('fly')
  assert.equal(bad.ok, false)
  assert.match(bad.error, /stretch/)
  const note = actions.performAction('tail', '坏\u0000笑')
  assert.match(note.text, /坏笑/)
  assert.doesNotMatch(note.text, /\u0000/)
})

await check('API 配置解析（不联网）', () => {
  const cfg = persona.resolveApiConfig({ enabled: true, provider: 'qwen', apiKey: 'test-key', model: '' })
  assert.equal(cfg.provider, 'qwen')
  assert.equal(cfg.model, 'qwen-turbo')
  assert.match(cfg.baseUrl, /dashscope\.aliyuncs\.com/)
  const fallback = persona.resolveApiConfig({ provider: 'nope' })
  assert.equal(fallback.provider, 'zhipu')
  assert.equal(fallback.model, 'glm-4-flash')
})

await check('病毒库归一化与合并', () => {
  assert.throws(() => security._internal.normalizeDb({}), /空的/)
  assert.throws(() => security._internal.normalizeDb([]), /格式/)
  const db = security._internal.normalizeDb({
    version: 'smoke',
    processes: ['XMRig.exe', { name: 'minerd', why: '挖矿' }],
    commandPatterns: [{ contains: 'powershell -enc', why: '编码命令' }],
    fileNames: ['Bad.Exe'],
    hashes: ['not-a-hash', { sha256: 'A'.repeat(64), name: '样本' }],
  })
  assert.equal(db.processes.length, 2)
  assert.equal(db.processes[0].name, 'xmrig')
  assert.equal(db.fileNames[0].name, 'bad.exe')
  assert.equal(db.hashes.length, 1)
  const merged = security._internal.mergeDb(db, security._internal.normalizeDb({
    version: 'cached',
    processes: ['minerd'],
    hashes: [{ sha256: 'A'.repeat(64) }],
  }))
  assert.equal(merged.processes.length, 2)
  assert.equal(merged.hashes.length, 1)
})

await check('内置病毒库可读且状态正常', () => {
  const st = security.securityStatus({ feedUrl: 'https://gitee.com/akiba-yuzuki_0/dsh-fatfish/raw/master/signatures.json' })
  assert.equal(st.ok, true)
  assert.ok(st.db.counts.processes >= 30)
  assert.ok(st.db.counts.commandPatterns >= 15)
  assert.equal(st.feed.configured, true)
  assert.match(st.feed.url, /^https:\/\/gitee\.com\//)
})

await check('扫描不存在的路径只记警告', async () => {
  const r = await security.scan({ scope: 'path', target: path.join(dataDir, 'no-such-dir') })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'clean')
  assert.ok(r.warnings.some((w) => w.includes('文件检查失败')))
})

await check('扫描非法 scope 会退回 quick', async () => {
  const r = await security.scan({ scope: 'root', maxFiles: 20 })
  assert.equal(r.ok, true)
  assert.equal(r.scope, 'quick')
})

await check('病毒库更新拒绝 http / 空地址', async () => {
  await assert.rejects(security.updateSignatures('http://example.com/x.json'), /https/)
  await assert.rejects(security.updateSignatures(''), /https/)
})

await check('设置页能渲染两种配置', async () => {
  const made = []
  const makeEl = () => ({
    className: '',
    _html: '',
    set innerHTML(v) { this._html = v },
    get innerHTML() { return this._html },
    querySelectorAll() { return [] },
    querySelector() { return null },
  })
  const prev = globalThis.document
  globalThis.document = { createElement() { const el = makeEl(); made.push(el); return el } }
  try {
    const client = await import('../client.js')
    assert.equal(client.name, 'fatfish')
    const plain = client.render({}, undefined, () => {})
    assert.match(plain.innerHTML, /大肥鱼/)
    assert.match(plain.innerHTML, /fatfish-memory-toggle/)
    assert.match(plain.innerHTML, /fatfish-security-feed/)
    assert.doesNotMatch(plain.innerHTML, /fatfish-api-key/)
    const full = client.render({}, {
      mode: 'custom',
      custom: '<script>alert(1)</script>',
      api: { enabled: true, provider: 'unknown', apiKey: '"><b>x</b>', model: 'm' },
      memory: { enabled: true, maxFacts: 'not-a-number' },
      security: { enabled: true, autoUpdate: false, feedUrl: 'https://x.test/s.json' },
    }, () => {})
    assert.match(full.innerHTML, /fatfish-api-key/)
    assert.match(full.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(full.innerHTML, /value="&quot;&gt;&lt;b&gt;x&lt;\/b&gt;"/)
    assert.match(full.innerHTML, /value="300"/)
    assert.match(full.innerHTML, /https:\/\/open\.bigmodel\.cn\//)
  } finally {
    globalThis.document = prev
  }
})

fs.rmSync(dataDir, { recursive: true, force: true })

if (failed) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n冒烟测试通过')
