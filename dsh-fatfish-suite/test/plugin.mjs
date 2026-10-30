/**
 * 套装契约测试：node test/plugin.mjs
 *
 * 不联网、不打开浏览器、不写任何文件。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BUNDLE = path.resolve(ROOT, '..')

const plugin = await import('../lib/index.js')

const registered = new Map()
const commands = new Map()
let effectCleanup = null

const ctx = {
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
    effectCleanup = fn()
  },
  logger: { info() {}, warn() {} },
}

plugin.apply(ctx)

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
}

await check('导出符合 DSH 约定', () => {
  assert.equal(plugin.name, 'fatfish-suite')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(Array.isArray(plugin.COMPANIONS) && plugin.COMPANIONS.length === 3)
})

await check('注册两个只读工具', () => {
  assert.equal(registered.size, 2)
  assert.deepEqual([...registered.keys()].sort(), ['fatfish_suite_guide', 'fatfish_suite_status'])
  for (const [name, def] of registered) {
    assertSchema(def.parameters, name)
    assert.ok(def.output?.schema, `${name} 缺 output.schema`)
    assert.equal(typeof def.output?.render, 'function', `${name} 缺 output.render`)
  }
})

await check('状态工具能认出三个同伴与挂载关系', async () => {
  const r = await registered.get('fatfish_suite_status').execute({})
  assert.equal(r.ok, true)
  assert.equal(r.companions.length, 3)
  assert.deepEqual(r.companions.map((c) => c.name), ['dsh-fatfish', 'dsh-fatfish-hands', 'dsh-quota-guard'])
  assert.equal(r.allInstalled, true, `缺：${r.missing.join('/')}`)
  assert.equal(r.allMounted, true, `没挂载：${r.unmounted.join('/')}`)
  assert.deepEqual(r.versionMismatch, [])
  assert.equal(r.suite.name, 'dsh-fatfish-suite')
  assert.equal(r.suite.version, '0.1.0')
  const rendered = registered.get('fatfish_suite_status').output.render({}, r)
  assert.match(rendered[0].text, /三件都齐了/)
})

await check('指南覆盖全部主题且只返回文字', async () => {
  const tool = registered.get('fatfish_suite_guide')
  for (const topic of plugin._internal.TOPICS) {
    const r = await tool.execute({ topic })
    assert.equal(r.ok, true)
    assert.equal(r.topic, topic)
    assert.ok(r.text.length > 30, `${topic} 内容过少`)
  }
  const fallback = await tool.execute({ topic: '不存在的主题' })
  assert.equal(fallback.topic, 'overview')
  assert.match(fallback.text, /三个 DSH 插件/)
  const rendered = tool.output.render({}, fallback)
  assert.equal(rendered[0].type, 'text')
})

await check('指南写明红线与免费优先', async () => {
  const tool = registered.get('fatfish_suite_guide')
  const overview = (await tool.execute({ topic: 'overview' })).text
  assert.match(overview, /不自动回复私聊/)
  assert.match(overview, /不代付/)
  assert.match(overview, /免费/)
  const browser = (await tool.execute({ topic: 'browser' })).text
  assert.match(browser, /支付/)
  assert.match(browser, /密码框/)
  const quota = (await tool.execute({ topic: 'quota' })).text
  assert.match(quota, /priced=false/)
})

await check('命令已注册且返回状态文字', async () => {
  assert.ok(commands.has('fatfish.suite'))
  const text = await commands.get('fatfish.suite')()
  assert.match(text, /大肥鱼套装/)
  assert.match(text, /三件都齐了/)
})

await check('patch 恰好插入三个同伴，没有插入自己', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  const names = [...yml.matchAll(/^\s+name:\s*['"]?([^'"\s#]+)/gm)].map((m) => m[1])
  const ids = [...yml.matchAll(/^\s*-\s*id:\s*['"]?([^'"\s#]+)/gm)].map((m) => m[1])
  assert.deepEqual(names.sort(), ['dsh-fatfish', 'dsh-fatfish-hands', 'dsh-quota-guard'])
  assert.equal(new Set(ids).size, ids.length, `id 重复：${ids.join('/')}`)
  assert.ok(!names.includes('dsh-fatfish-suite'), '套装不应插入自己')
})

await check('依赖版本与同伴包一致', () => {
  const self = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  for (const c of plugin.COMPANIONS) {
    const dep = self.dependencies[c.name]
    assert.ok(dep, `package.json 没声明依赖 ${c.name}`)
    const manifest = JSON.parse(fs.readFileSync(path.join(BUNDLE, c.name, 'package.json'), 'utf8'))
    assert.equal(dep, manifest.version, `${c.name}: 依赖 ${dep} 与目录版本 ${manifest.version} 不一致`)
  }
})

await check('套装源码不联网、不起进程、不写文件', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  for (const bad of ['child_process', 'node:http', 'node:https', 'fetch(', 'writeFileSync', 'mkdirSync', 'rmSync', 'unlinkSync']) {
    assert.ok(!src.includes(bad), `源码里出现 ${bad}`)
  }
  assert.ok(src.includes('readFileSync'), '状态检查应只读本地文件')
})

await check('源码与文档没有本机绝对路径/令牌', () => {
  const files = ['lib/index.js', 'README.md', 'CHANGELOG.md', 'SECURITY.md', 'cordis.patch.yml', 'package.json']
  const bad = /[A-Z]:[\\/](?:Users[\\/][^\\/\s]+|大肥鱼)/i
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
    assert.ok(!bad.test(text), `${f} 里有本机绝对路径`)
    assert.ok(!/\bnpm_[A-Za-z0-9]{20,}/.test(text), `${f} 里有 npm 令牌`)
    assert.ok(!/\bsk-[A-Za-z0-9]{20,}/.test(text), `${f} 里有 API Key`)
  }
})

await check('卸载后工具全部注销', () => {
  assert.equal(typeof effectCleanup, 'function')
  effectCleanup()
  assert.equal(registered.size, 0)
})

if (failed) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n套装契约检查通过')
