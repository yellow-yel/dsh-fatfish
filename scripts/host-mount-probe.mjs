/**
 * 宿主装载探针：node scripts/host-mount-probe.mjs [包目录...]
 *
 * 无头复现 cordis 的两条装载契约，专门抓「单测全绿、装进 DSH 却不装载」这一类：
 *   1) 配置校验走 runtime.Config['~standard'].validate(value)——裸 JSON Schema 会 TypeError；
 *   2) ctx 代理只对 inject 声明过的服务放行，其余读取抛 cannot get property "x" without inject，
 *      而 inject 里写了宿主根作用域没有的服务（例如 command）会让 fiber 永远 pending。
 * 只做装载判定，不联网、不写文件、不碰真实 profile。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
// 宿主根作用域「不用声明也能读」的成员，抄自 cordis/lib/index.js:736-753 的 mixin 名单：
//   reflect: get/set/provide/accessor/mixin  fiber: runtime/effect  registry: inject/plugin  events: on/once/parallel/emit/serial/bail/waterfall
// 这些是方法，不是服务，漏了会把正常写法判成装载失败（国际版 11-02 实测：ctx.inject([...]) 动态注入被判红）。
const HOST_METHODS = new Set(['get', 'set', 'provide', 'accessor', 'mixin', 'runtime', 'effect',
  'inject', 'plugin', 'on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall'])
// 本机 plugin.state 实测根作用域可用的服务：dsh-quota-guard（inject=['llm']，用 ctx.on/ctx.get）与
// dsh-fatfish-hands（用 ctx.rpc）都 active，所以这些算「不用声明也能读」的宿主混入/服务。
const HOST_SERVICES = new Set(['llm', 'tools', 'systemPrompt', 'rpc', 'logger', 'options', 'fiber',
  'events', 'platform', 'sessions'])
// 根作用域确定没有的服务：写进 inject 就永远 pending（实测 dsh-fatfish 卡 command、dsh-ops-tui 卡 tuiPanels）
const NOT_AT_ROOT = new Set(['command', 'tuiPanels', 'guide', 'canvas'])

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const dirs = args.length ? args : fs.readdirSync(ROOT).filter((d) => {
  return fs.existsSync(path.join(ROOT, d, 'package.json')) && fs.existsSync(path.join(ROOT, d, 'lib', 'index.js'))
})

let failed = 0
for (const dir of dirs) {
  const pkgDir = path.isAbsolute(dir) ? dir : path.join(ROOT, dir)
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  const entry = path.join(pkgDir, pkg.main || 'lib/index.js')
  const name = pkg.name
  const problems = []
  const notes = []

  let plugin
  try {
    const mod = await import(pathToFileURL(entry).href)
    plugin = typeof mod.apply === 'function' ? mod : mod.default
    if (typeof plugin?.apply !== 'function') problems.push('入口既没有 apply(ctx, config) 也没有 default.apply')
  } catch (e) {
    problems.push(`入口 import 失败：${e.message}`)
    plugin = null
  }

  if (plugin && typeof plugin.apply === 'function') {
    const inject = Array.isArray(plugin.inject) ? plugin.inject : null
    if (!inject) notes.push('未声明 inject（宿主按全放行处理）')

    const pending = (inject || []).filter((s) => NOT_AT_ROOT.has(s))
    if (pending.length) problems.push(`inject 里有根作用域不存在的服务，fiber 会永远 pending：${pending.join(', ')}`)

    // 契约一：配置校验
    let cfg = {}
    if (plugin.Config) {
      const std = plugin.Config['~standard']
      if (typeof std?.validate !== 'function') {
        problems.push('Config 缺 ["~standard"].validate：宿主 resolveConfig 会 TypeError，整枚不装载')
      } else {
        for (const input of [undefined, null, {}, cfg]) {
          let r
          try {
            r = std.validate(input)
          } catch (e) {
            problems.push(`validate(${JSON.stringify(input)}) 抛错：${e.message}`)
            break
          }
          if (r && typeof r.then === 'function') { problems.push('validate 返回了 Promise：宿主拒绝异步校验'); break }
          if (r?.issues) { problems.push(`validate(${JSON.stringify(input)}) 返回 issues：${JSON.stringify(r.issues).slice(0, 160)}`); break }
        }
        if (!problems.length) cfg = std.validate({}).value
      }
    }

    // 契约二：ctx 代理只对 inject 声明过的服务 + 宿主根作用域成员放行，其余读取抛错
    const allowed = new Set(inject ? [...inject, ...HOST_METHODS, ...HOST_SERVICES] : [...HOST_METHODS, ...HOST_SERVICES])
    const dyn = { declared: [], pending: [] }
    const state = { tools: 0, commands: 0, effects: 0, promptSections: 0, passthrough: new Set() }
    // cordis 的 LoggerService 即可调用也可点方法：ctx.logger('tag').info(...) 与 ctx.logger.info(...) 都要成立
    const logger = new Proxy(function () { return logger }, {
      get: (t, prop) => (prop === 'then' ? undefined : () => {}),
      apply: () => logger,
    })
    const noop = (() => {
      const swallow = new Proxy(function () {}, {
        get: (t, prop) => (prop === 'then' || prop === Symbol.toPrimitive ? undefined : swallow),
        apply: () => swallow,
        construct: () => swallow,
      })
      return () => swallow
    })()
    const ctx = new Proxy({}, {
      get(_, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop === 'then') return undefined
        if (!allowed.has(prop)) throw new Error(`cannot get property "${prop}" without inject`)
        if (prop === 'tools') return { register: () => { state.tools++; return () => state.tools-- } }
        if (prop === 'systemPrompt') return { section: () => { state.promptSections++; return { dispose() {} } } }
        if (prop === 'effect') return (fn) => { state.effects++; if (typeof fn === 'function') fn() }
        if (prop === 'logger') return logger
        if (prop === 'command') return () => { state.commands++; return { dispose() {} } }
        // 动态注入：宿主 ctx.inject(decl, cb) == ctx.plugin({inject: decl, apply: cb})（index.js:1600-1606），
        // 注册动作在 cb 里——吞掉它就会假报「apply 跑完但什么都没注册」。
        if (prop === 'inject') return (decl, cb) => startPlugin({ inject: decl, apply: cb })
        if (prop === 'plugin') return (p, pluginCfg) => startPlugin(p, pluginCfg)
        // 其余已声明/实测可用的宿主服务：给一个吞掉一切调用的替身，只求「装载不炸」
        state.passthrough.add(prop)
        return noop()
      },
    })

    // 宿主 ctx.plugin 的真实语义：解析 inject → 起 fiber → 调 apply(ctx, config)（index.js:1619-1639）
    const startPlugin = (p, pluginCfg) => {
      const decl = Array.isArray(p?.inject) ? p.inject
        : (p?.inject && typeof p.inject === 'object' ? Object.keys(p.inject) : [])
      const bad = decl.filter((s) => NOT_AT_ROOT.has(s))
      dyn.declared.push(...decl)
      if (bad.length) dyn.pending.push(...bad)
      for (const s of decl) allowed.add(s)
      const cfgIn = pluginCfg ?? {}
      const std = p?.Config?.['~standard']
      if (std && typeof std.validate !== 'function') {
        problems.push(`动态插件 ${p?.name || '(匿名)'} 的 Config 缺 ["~standard"].validate：宿主起 fiber 会 TypeError`)
      } else if (typeof std?.validate === 'function') {
        const r = std.validate(cfgIn)
        if (r?.issues) problems.push(`动态插件配置校验 issues：${JSON.stringify(r.issues).slice(0, 160)}`)
      }
      const fn = typeof p === 'function' ? p : p?.apply
      if (typeof fn === 'function') fn(ctx, cfgIn)
      return { dispose() {}, then: undefined }
    }


    try {
      const r = plugin.apply(ctx, cfg)
      if (r && typeof r.then === 'function') notes.push('apply 返回 Promise（异步装载，宿主支持）')
    } catch (e) {
      problems.push(`apply 抛错：${e.message}`)
    }
    notes.push(`工具 ${state.tools} · 命令 ${state.commands} · effect ${state.effects} · 人设段 ${state.promptSections}`)
    if (dyn.declared.length) notes.push(`动态注入 ${[...new Set(dyn.declared)].join('/')}`)
    if (dyn.pending.length) problems.push(`动态注入里有根作用域不存在的服务，fiber 会永远 pending：${[...new Set(dyn.pending)].join(', ')}`)
            if (state.passthrough.size) notes.push(`吞掉调用的宿主服务：${[...state.passthrough].join('/')}`)
    if (!state.tools && !state.commands && !state.promptSections && !state.effects) {
      problems.push('apply 跑完但什么都没注册')
    }
  }

  if (problems.length) {
    failed++
    console.log(`✘ ${name}@${pkg.version}`)
    for (const p of problems) console.log(`    ${p}`)
  } else {
    console.log(`✓ ${name}@${pkg.version} — ${notes.join(' · ')}`)
  }
}

console.log(failed ? `\n${failed} 枚装不上（共探 ${dirs.length} 枚）` : `\n${dirs.length} 枚全部可按宿主契约装载`)
process.exit(failed ? 1 : 0)
