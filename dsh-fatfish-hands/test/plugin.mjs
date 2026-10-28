/**
 * 插件契约测试：node test/plugin.mjs
 *
 * 用一个假的 ctx 把插件装载一遍，检查：
 *   - 导出 name / inject / apply 符合 DSH 约定；
 *   - 每个工具的 name / description / parameters / output.render 都齐全；
 *   - 参数 schema 是合法 JSON Schema 子集；
 *   - 触发 effect 的清理函数后，工具被注销、RPC 关闭。
 * 不打开 Edge，也不联网。
 */
import assert from 'node:assert/strict'
import plugin, { TOOLS } from '../lib/index.js'

const registered = new Map()
const effects = []
const ctx = {
  tools: {
    register(def) {
      assert.ok(def.name && def.description && def.parameters)
      registered.set(def.name, def)
      return () => registered.delete(def.name)
    },
  },
  effect(fn) {
    effects.push(fn)
  },
  logger: { info() {}, warn() {} },
}

assert.equal(plugin.name, 'dsh-fatfish-hands')
assert.ok(Array.isArray(plugin.inject) && plugin.inject.includes('tools'), 'inject 必须包含 tools')

plugin.apply(ctx)

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log('  ✓', name)
  } catch (e) {
    failed++
    console.error('  ✘', name, '—', e.message)
  }
}

const assertSchema = (schema) => {
  assert.equal(schema.type, 'object', '顶层 schema 应为 object')
  assert.ok(schema.properties, '应有 properties')
  for (const [key, prop] of Object.entries(schema.properties)) {
    assert.ok(prop.type || prop.oneOf || prop.items, `${key} 缺 type`)
    if (prop.type === 'object') assertSchema(prop)
    if (prop.type === 'array') assert.ok(prop.items, `${key} 是数组但缺 items`)
  }
  if (schema.required) {
    for (const key of schema.required) {
      assert.ok(schema.properties[key], `required 里的 ${key} 不在 properties 中`)
    }
  }
}

check('注册了全部工具', () => {
  assert.equal(registered.size, TOOLS.length)
  assert.ok(registered.size >= 10, '工具数量偏少')
})

check('工具名带 fatfish 前缀且不重复', () => {
  for (const name of registered.keys()) assert.match(name, /^fatfish_[a-z_]+$/)
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length)
})

check('输入参数 schema 合法', () => {
  for (const [name, def] of registered) {
    try {
      assertSchema(def.parameters)
    } catch (e) {
      throw new Error(`${name}: ${e.message}`)
    }
  }
})

check('输出 schema 与 render 齐全', () => {
  for (const [name, def] of registered) {
    assert.ok(def.output && def.output.schema, `${name} 缺 output.schema`)
    assert.equal(typeof def.output.render, 'function', `${name} 缺 output.render`)
    const rendered = def.output.render({}, { ok: false, error: '示例错误' })
    assert.ok(Array.isArray(rendered) && rendered[0]?.type === 'text', `${name} render 应返回 text 块`)
  }
})

check('doctor 工具存在', () => {
  assert.ok(registered.get('fatfish_doctor'))
})

check('pc_status 工具存在', () => {
  assert.ok(registered.get('fatfish_pc_status'))
})

check('卸载后工具全部注销', () => {
  // ctx.effect(() => () =>{...})：回调返回清理函数，DSH 卸载时执行它
  for (const fn of effects) {
    const cleanup = fn()
    if (typeof cleanup === 'function') cleanup()
  }
  effects.length = 0
  assert.equal(registered.size, 0)
})

if (failed) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}

// async 的那项单独跑完再退出
const def = TOOLS.find((t) => t.name === 'fatfish_pc_status')
const v = await def.execute({}, { rpc: { call: async () => { throw new Error('不应联网') } } })
assert.equal(v.ok, true)
console.log('\n插件契约检查通过')
