/**
 * dsh-fatfish-suite —— 大肥鱼套装入口
 *
 * 一个包装齐三件：人设/记忆/查毒、Edge 上网、额度护栏。
 * 本包自己不联网、不读聊天、不执行命令，只做两件事：
 *   1. 通过 cordis.patch.yml 把三个同伴插件挂进 DSH；
 *   2. 提供两个只读工具，让人和 agent 都能看清「套装现在装齐了没、各自能干什么」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'fatfish-suite'
export const inject = ['tools']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

export const COMPANIONS = Object.freeze([
  {
    name: 'dsh-fatfish',
    title: '大肥鱼',
    role: '人设 / 时段与情绪 / 本地记忆 / 只读查毒 / 小动作',
    boundary: '记忆拒收密码与 Key；查毒只报告，不删文件不杀进程',
  },
  {
    name: 'dsh-fatfish-hands',
    title: '大肥鱼之手',
    role: '专用 Edge 上网 / 读正文与链接 / 截图 / 只读电脑状态',
    boundary: '支付、网银、登录、下载硬拦截；不碰日常浏览器的账号与历史',
  },
  {
    name: 'dsh-quota-guard',
    title: '额度护栏',
    role: '模型用量账本 / 每日与每分钟限额 / 免费账号轮换',
    boundary: '默认只记账不拦；单价未知时明确标记 priced=false，不假装免费',
  },
])

const TOPICS = ['overview', 'memory', 'browser', 'quota', 'security', 'desktop', 'install']

const GUIDE = {
  overview: [
    '大肥鱼套装 = 三个 DSH 插件，装一次一起挂上：',
    '  · 大肥鱼：人格、时段、情绪、本地记忆、只读查毒、七个小动作。',
    '  · 大肥鱼之手：用专用 Edge 读网页、点链接、搜索、截图，另带只读电脑状态。',
    '  · 额度护栏：记录模型用量，可按天/按分钟设上限，免费账号之间自动轮换。',
    '',
    '默认免费优先：套装不配置任何付费开关，也不自动充值。要用付费模型，必须自己改配置并清楚代价。',
    '红线写在各自插件内核里：不自动回复私聊，不代付，不点支付页，不上传聊天或文件。',
  ].join('\n'),
  memory: [
    '本地记忆：~/.dsh/fatfish/memory.json',
    '  · 对话里自动抽取名字、喜好、习惯、生日；也可用 fatfish_memory_save 手动记。',
    '  · fatfish_memory_recall 按关键词召回，fatfish_memory_forget 按 id 删除。',
    '  · 密码、验证码、证件号、银行卡、手机号、住址、API Key 一律拒收。',
    '  · 没有「清空全部」，删一条必须给出 id 或足够具体的描述。',
  ].join('\n'),
  browser: [
    '大肥鱼之手使用独立 Edge 配置：~/.dsh/fatfish-hands/edge-profile',
    '  · 读页面文字与链接，不靠截图猜坐标；第一次调用会自动起一个 Edge 窗口。',
    '  · 支付、网购、银行、收银台、验证码页：只读，拒绝点击和输入。',
    '  · 页面有密码框时拒绝输入；需要登录请主人自己完成。',
    '  · 下载默认拒绝，只允许 http/https，file:// 一律拒绝。',
    '  · fatfish_pc_status 只读电脑状态，不结束进程、不改设置。',
  ].join('\n'),
  quota: [
    '额度护栏默认只记账，不拦请求：',
    '  · 账本：~/.dsh/llm-guard/usage.json，只记模型、token、耗时、费用估算。',
    '  · 在 DSH 用户层 cordis.patch.yml 给 id: llm-guard 加 limits，例如 dailyTokens / dailyRequests。',
    '  · onExceed 先建议用 warn 观察一周，再切 block，避免误拦长任务。',
    '  · 没配单价的模型显示 priced=false，costCny=0 不代表免费。',
    '  · 账号池只用主人自己放进去的免费账号；插件不自动充值、不自动换付费账号。',
  ].join('\n'),
  security: [
    '查毒是特征匹配，不是完整杀毒引擎：',
    '  · 检查进程名、命令行、启动项和常用目录里的可执行文件哈希。',
    '  · 只读：不删文件、不杀进程、不改注册表。',
    '  · 病毒库可用 HTTPS 订阅更新，默认每 12 小时检查一次。',
    '  · 发现可疑项先看建议，再决定是否用专业安全软件复扫。',
  ].join('\n'),
  desktop: [
    '套装是 DSH 插件形态；电脑上的「大肥鱼陪伴」独立程序是完整版：',
    '  · 独立窗口、桌宠气泡、聊天存档、自动备份、加密保险库、本地 OpenAI 兼容中转。',
    '  · 两者不共享进程；DSH 套装不会自动读独立版的记忆，也不会替它回复私聊。',
    '  · 想让 agent 干重活，用套装里的手和护栏；想日常陪伴与本地中转，用独立程序。',
    '  · 独立程序的中转只监听 127.0.0.1，Key 只存在本机，不写进插件配置。',
  ].join('\n'),
  install: [
    '安装与卸载：',
    '  · DSH：dsh plugin --profile desktop add dsh-fatfish-suite',
    '  · 卸载：dsh plugin --profile desktop remove dsh-fatfish-suite，再按需删三个同伴包。',
    '  · 套装和三件套二选一：已经单独装了某个插件，再装套装会出现重复挂载。',
    '  · 本机目录安装：node scripts/install-to-dsh.mjs --suite（只把套装写进 bundles）。',
    '  · 改完配置重启 DSH，或在 profile 的 cordis.patch.yml 追加 "# reload" 触发热重载。',
  ].join('\n'),
}

function manifestOf(pkgName) {
  const candidates = [
    path.join(ROOT, '..', pkgName, 'package.json'),
    path.join(ROOT, 'node_modules', pkgName, 'package.json'),
    path.join(process.cwd(), 'node_modules', pkgName, 'package.json'),
  ]
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {}
  }
  return null
}

function expectedVersions() {
  const self = manifestOf('dsh-fatfish-suite')
  return (self && self.dependencies) || {}
}

function mountedNames() {
  try {
    const yml = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
    return [...yml.matchAll(/^\s+name:\s*['"]?([^'"\s#]+)/gm)].map((m) => m[1])
  } catch {
    return []
  }
}

export function suiteStatus() {
  const expected = expectedVersions()
  const mounts = mountedNames()
  const companions = COMPANIONS.map((c) => {
    const manifest = manifestOf(c.name)
    const want = expected[c.name] || manifest?.version || ''
    const version = manifest?.version || ''
    return {
      name: c.name,
      title: c.title,
      role: c.role,
      boundary: c.boundary,
      installed: Boolean(manifest),
      version,
      expected: want,
      mounted: mounts.includes(c.name),
      ok: Boolean(manifest) && mounts.includes(c.name) && (!want || version === want),
    }
  })
  const self = manifestOf('dsh-fatfish-suite')
  return {
    ok: true,
    suite: { name: 'dsh-fatfish-suite', version: self?.version || '0.1.0' },
    companions,
    allInstalled: companions.every((c) => c.installed),
    allMounted: companions.every((c) => c.mounted),
    missing: companions.filter((c) => !c.installed).map((c) => c.name),
    unmounted: companions.filter((c) => !c.mounted).map((c) => c.name),
    versionMismatch: companions.filter((c) => c.installed && c.expected && c.version !== c.expected)
      .map((c) => `${c.name} 装的是 ${c.version}，套装要求 ${c.expected}`),
  }
}

function statusView(s) {
  const lines = [`大肥鱼套装 ${s.suite.version}`]
  for (const c of s.companions) {
    const mark = c.ok ? '✓' : '✗'
    const state = !c.installed ? '未安装' : (!c.mounted ? '已安装但没挂载' : `v${c.version}`)
    lines.push(`  ${mark} ${c.title}（${c.name}）· ${state}`)
    lines.push(`      ${c.role}`)
  }
  if (s.allInstalled && s.allMounted && !s.versionMismatch.length) {
    lines.push('三件都齐了。用 fatfish_suite_guide 看每件的用法与边界。')
  } else {
    if (s.missing.length) lines.push(`缺：${s.missing.join(' / ')} —— 重新安装套装，或单独装这些包。`)
    if (s.unmounted.length) lines.push(`没挂载：${s.unmounted.join(' / ')} —— 检查 cordis.patch.yml 的 insert 段。`)
    if (s.versionMismatch.length) lines.push(`版本不一致：${s.versionMismatch.join('；')}。`)
  }
  return lines.join('\n')
}

function guideView(topic) {
  const key = TOPICS.includes(topic) ? topic : 'overview'
  return { ok: true, topic: key, text: GUIDE[key] }
}

const text = (s) => [{ type: 'text', text: s }]

const STATUS_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    suite: {
      type: 'object',
      properties: { name: { type: 'string' }, version: { type: 'string' } },
    },
    companions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          role: { type: 'string' },
          boundary: { type: 'string' },
          installed: { type: 'boolean' },
          version: { type: 'string' },
          expected: { type: 'string' },
          mounted: { type: 'boolean' },
          ok: { type: 'boolean' },
        },
      },
    },
    allInstalled: { type: 'boolean' },
    allMounted: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
    unmounted: { type: 'array', items: { type: 'string' } },
    versionMismatch: { type: 'array', items: { type: 'string' } },
  },
}

export const TOOLS = [
  {
    name: 'fatfish_suite_status',
    description: '查看大肥鱼套装三件（大肥鱼 / 大肥鱼之手 / 额度护栏）是否装齐、是否挂载、版本是否对得上。只读，不联网。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: STATUS_SCHEMA,
      render: (_args, v) => text(v && v.ok ? statusView(v) : '大肥鱼套装状态读取失败。'),
    },
    execute: async () => {
      try {
        return suiteStatus()
      } catch (e) {
        return { ok: false, error: String(e?.message || e) }
      }
    },
  },
  {
    name: 'fatfish_suite_guide',
    description: '查大肥鱼套装的用法与安全边界：总览、记忆、浏览器、额度、查毒、独立桌面版、安装卸载。只返回说明文字，不执行动作。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: TOPICS, description: '想了解的部分，默认 overview' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          topic: { type: 'string' },
          text: { type: 'string' },
        },
      },
      render: (_args, v) => text(v?.text || '没有这条说明。'),
    },
    execute: async (args) => guideView(String(args?.topic || 'overview')),
  },
]

export function apply(ctx) {
  const disposers = []
  for (const tool of TOOLS) {
    disposers.push(ctx.tools.register(tool))
  }
  ctx.effect(() => () => {
    for (const d of disposers) {
      try { d() } catch {}
    }
  })

  if (ctx.command) {
    ctx.command('fatfish.suite', '查看大肥鱼套装三件是否装齐、挂载与版本', async () => {
      const s = suiteStatus()
      return statusView(s)
    })
  }

  try {
    const s = suiteStatus()
    console.log(`[fatfish-suite] ${s.allInstalled && s.allMounted ? '三件已挂载' : `缺 ${s.missing.concat(s.unmounted).join('/') || '版本不一致'}`}`)
  } catch {}
}

export const _internal = { manifestOf, mountedNames, expectedVersions, statusView, guideView, TOPICS }
