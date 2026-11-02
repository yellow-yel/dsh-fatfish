/**
 * 插件契约测试：node test/plugin.mjs
 *
 * 不联网、不打开浏览器、不碰真实记忆目录。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-test-'))
process.env.FATFISH_DATA = dataDir

const plugin = await import('../lib/index.js')

const registered = new Map()
const effects = []
const commands = new Map()
const sections = []

const ctx = {
  systemPrompt: {
    section(opts) {
      sections.push(opts)
      return { dispose() {} }
    },
  },
  tools: {
    register(def) {
      assert.ok(def.name && def.description && def.parameters, '工具三件套不齐')
      assert.equal(typeof def.execute, 'function', `${def.name} 缺 execute`)
      registered.set(def.name, def)
      return () => registered.delete(def.name)
    },
  },
  command(name, desc, handler) {
    commands.set(name, handler)
    return { dispose() {} }
  },
  effect(fn) {
    const cleanup = fn()
    if (typeof cleanup === 'function') effects.push(cleanup)
  },
  logger: { info() {}, warn() {} },
}

plugin.apply(ctx, {
  mode: 'normal',
  enableTimeAwareness: true,
  enableMood: true,
  memory: { enabled: true, autoCapture: true, maxFacts: 100 },
  security: { enabled: true, autoUpdate: false, feedUrl: '' },
  api: { enabled: false },
})

let failed = 0
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log('  ✓', name))
    .catch((e) => {
      failed++
      console.error('  ✘', name, '—', e.message)
    })
}

const assertSchema = (schema, label = 'schema') => {
  assert.equal(schema.type, 'object', `${label}: 顶层应为 object`)
  assert.ok(schema.properties, `${label}: 缺 properties`)
  for (const [key, prop] of Object.entries(schema.properties)) {
    assert.ok(prop.type || prop.oneOf || prop.items || prop.enum, `${label}.${key} 缺 type`)
    if (prop.type === 'object') assertSchema(prop, `${label}.${key}`)
    if (prop.type === 'array') assert.ok(prop.items, `${label}.${key} 是数组但缺 items`)
  }
  if (schema.required) {
    for (const key of schema.required) assert.ok(schema.properties?.[key], `${label}.required.${key} 不在 properties`)
  }
}

await check('导出符合 DSH 约定', () => {
  assert.equal(plugin.name, 'fatfish')
  assert.ok(plugin.inject.includes('systemPrompt'))
  assert.ok(plugin.inject.includes('tools'))
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(plugin.Config?.properties?.memory)
  assert.ok(plugin.Config?.properties?.security)
  assert.equal(sections.length, 1)
  assert.match(sections[0].text, /fatfish_memory_save/)
})

await check('宿主 Standard Schema 契约（cordis 读 Config["~standard"].validate，缺它整枚不装载）', () => {
  const std = plugin.Config['~standard']
  assert.equal(typeof std?.validate, 'function')
  assert.equal(std.version, 1)
  const empty = std.validate({})
  assert.ok(!empty.issues, '默认配置不该产生 issues')
  assert.equal(empty.value.mode, 'normal')
  assert.equal(empty.value.memory.maxFacts, 300)
  assert.equal(empty.value.security.updateHours, 12)
  const junk = std.validate({ mode: 'nope', memory: { maxFacts: 99999 }, security: { updateHours: 'abc' } })
  assert.ok(!junk.issues)
  assert.equal(junk.value.mode, 'normal')
  assert.equal(junk.value.memory.maxFacts, 1000)
  assert.equal(junk.value.security.updateHours, 12)
  assert.equal(std.validate({ custom: 'x'.repeat(900) }).value.custom.length, 600)
  assert.ok(std.validate(null).value)
  assert.ok(std.validate(undefined).value)
})

await check('inject 覆盖源码里用到的每个 ctx 服务（宿主没声明就抛 "without inject"）', () => {
  const CORE = new Set(['effect', 'logger', 'options', 'fiber', 'events', 'platform', 'sessions'])
  const libDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib')
  const used = new Set()
  const guarded = new Set()
  for (const f of fs.readdirSync(libDir).filter((x) => x.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(libDir, f), 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\bctx\.([a-zA-Z_][\w]*)/g)) {
        const key = m[1]
        const near = lines.slice(Math.max(0, i - 2), i + 3).join('\n')
        if (/\btry\s*\{/.test(near) && /\}\s*catch/.test(near)) guarded.add(key)
        else used.add(key)
      }
    })
  }
  const missing = [...used].filter((k) => !CORE.has(k) && !plugin.inject.includes(k))
  assert.deepEqual(missing, [], `plugin.inject 少了：${missing.join(', ')}`)
  // command 只在 agent 子作用域有：写进 inject 会让整枚插件永远 pending，只能 try/catch 取
  assert.ok(!plugin.inject.includes('command'), 'command 不能出现在 inject 里')
  assert.ok(!used.has('command'), 'ctx.command 必须包在 try/catch 里读')
  assert.ok(guarded.has('command'), '源码里没有受保护的 ctx.command 取值')
})

await check('注册了全部工具', () => {
  assert.equal(registered.size, 7)
  const names = [...registered.keys()].sort()
  assert.deepEqual(names, [
    'fatfish_act',
    'fatfish_memory_forget',
    'fatfish_memory_recall',
    'fatfish_memory_save',
    'fatfish_security_scan',
    'fatfish_security_status',
    'fatfish_security_update',
  ])
})

await check('输入/输出 schema 与 render 齐全', () => {
  for (const [name, def] of registered) {
    assertSchema(def.parameters, name)
    assert.ok(def.output?.schema, `${name} 缺 output.schema`)
    assert.equal(typeof def.output?.render, 'function', `${name} 缺 output.render`)
    const rendered = def.output.render({}, { ok: false, error: '示例' })
    assert.ok(Array.isArray(rendered) && rendered[0]?.type === 'text')
  }
})

await check('记忆闭环：记、去重、召回、遗忘', async () => {
  const save = registered.get('fatfish_memory_save')
  const recall = registered.get('fatfish_memory_recall')
  const forget = registered.get('fatfish_memory_forget')

  const a = await save.execute({ text: '主人喜欢喝茉莉花茶', tags: ['喜好'] })
  assert.equal(a.ok, true)
  assert.equal(a.created, true)

  const b = await save.execute({ text: '主人喜欢喝茉莉花茶', tags: ['喝茶'] })
  assert.equal(b.created, false, '重复内容应合并')

  const r = await recall.execute({ query: '茉莉花茶' })
  assert.equal(r.ok, true)
  assert.equal(r.count, 1)
  assert.match(r.facts[0].text, /茉莉/)

  const d = await forget.execute({ id: a.id })
  assert.equal(d.removed, 1)
  const r2 = await recall.execute({ query: '茉莉花茶' })
  assert.equal(r2.count, 0)
})

await check('记忆拒收密码/验证码', async () => {
  const save = registered.get('fatfish_memory_save')
  const r = await save.execute({ text: '我的密码是 abc12345' })
  assert.equal(r.ok, false)
  assert.match(r.error, /密码/)
  const r2 = await save.execute({ text: `${'sk-'}${'testfake000000000'}` })
  assert.equal(r2.ok, false)
})

await check('动作工具', async () => {
  const act = registered.get('fatfish_act')
  const r = await act.execute({ action: 'stretch' })
  assert.equal(r.ok, true)
  assert.match(r.text, /懒腰/)
  const bad = await act.execute({ action: 'fly' })
  assert.equal(bad.ok, false)
})

await check('病毒库更新拒绝非 https（不联网）', async () => {
  const upd = registered.get('fatfish_security_update')
  const r = await upd.execute({ url: 'http://example.com/signatures.json' })
  assert.equal(r.ok, false)
  assert.match(r.error, /https/)
})

await check('安全状态可读', async () => {
  const st = registered.get('fatfish_security_status')
  const r = await st.execute({})
  assert.equal(r.ok, true)
  assert.ok(r.db.counts.processes > 0)
  assert.ok(r.db.counts.hashes > 0)
})

await check('文件哈希查杀（自定义临时病毒库，不用 EICAR）', async () => {
  const sampleDir = path.join(dataDir, 'samples')
  fs.mkdirSync(sampleDir, { recursive: true })
  const sample = path.join(sampleDir, 'fatfish-test-sample.exe')
  const content = Buffer.from('this is a harmless file used to test hash matching')
  fs.writeFileSync(sample, content)
  const digest = crypto.createHash('sha256').update(content).digest('hex')
  fs.mkdirSync(path.join(dataDir, 'security'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'security', 'signatures.json'), JSON.stringify({
    version: 'test-1',
    updatedAt: new Date().toISOString(),
    source: 'test',
    hashes: [{ sha256: digest, name: '测试样本', why: '测试用哈希' }],
  }))

  const scanTool = registered.get('fatfish_security_scan')
  const r = await scanTool.execute({ scope: 'path', path: sampleDir, maxFiles: 20 })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'attention')
  const hit = r.findings.find((f) => f.name === 'fatfish-test-sample.exe')
  assert.ok(hit, '应命中文档哈希')
  assert.equal(hit.severity, 'high')
  assert.match(hit.why, /测试用哈希/)
  assert.equal(hit.name, 'fatfish-test-sample.exe')
})

await check('进程扫描能跑通（只读）', async () => {
  const scanTool = registered.get('fatfish_security_scan')
  const r = await scanTool.execute({ scope: 'process' })
  assert.equal(r.ok, true)
  assert.ok(r.scanned.processes >= 1, '至少应看到当前进程')
})

await check('命令注册齐全', () => {
  assert.ok(commands.has('fatfish.remember <text...>'))
  assert.ok(commands.has('fatfish.recall <query...>'))
  assert.ok(commands.has('fatfish.scan [scope]'))
  assert.ok(commands.has('fatfish.act <action>'))
  assert.ok(!commands.has('fatfish.chat <message...>'), 'API 关闭时不应注册聊天命令')
})

await check('卸载后工具全部注销', () => {
  for (const cleanup of effects) cleanup()
  effects.length = 0
  assert.equal(registered.size, 0)
})

fs.rmSync(dataDir, { recursive: true, force: true })

if (failed) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n插件契约检查通过')
