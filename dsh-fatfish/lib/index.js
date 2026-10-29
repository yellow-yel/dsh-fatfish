/**
 * dsh-fatfish —— 大肥鱼 for DeepSeek Harness
 *
 * 一条会记事、会干活、还会卖萌的鱼：
 * - 人设：好脾气 / 毒舌 / 犯困 / 自定义，时段感知 + 情绪 + 写死的红线
 * - 记忆：本地事实库，对话里自动抽取，可召回可遗忘
 * - 安全：本地轻量查杀（进程 / 启动项 / 文件哈希），病毒库可在线更新
 * - 动作：伸懒腰 / 吐泡泡 / 打盹 / 被摸头 / 吃一口 / 翻肚皮 / 甩尾巴
 *
 * 隐私：记忆和安全结果只写本机 ~/.dsh/fatfish；没有遥测，不上传文件。
 */
import {
  FREE_API_PROVIDERS,
  RED_LINES,
  PERSONA_BASE,
  PERSONA_NORMAL,
  PERSONA_ROAST,
  PERSONA_SLEEPY,
  buildPersonaText,
  getPeriod,
  energyTarget,
  moodLabel,
  resolveApiConfig,
  callAPI,
} from './persona.js'
import {
  autoCapture,
  forgetFacts,
  listFacts,
  memoryStats,
  recallFacts,
  saveFact,
  MEMORY_LIMIT_DEFAULT,
} from './memory.js'
import { scan, securityStatus, updateSignatures, loadState } from './security.js'
import { ACTIONS, performAction } from './actions.js'

const DEFAULT_FEED = 'https://gitee.com/akiba-yuzuki_0/dsh-fatfish/raw/master/signatures.json'

const text = (s) => [{ type: 'text', text: s }]

function guard(fn) {
  return async (args) => {
    try {
      return await fn(args || {})
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  }
}

function clamp(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

const MEMORY_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    score: { type: 'number' },
    updatedAt: { type: 'string' },
  },
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    severity: { type: 'string', description: 'high / medium' },
    kind: { type: 'string', description: 'process / startup / file' },
    name: { type: 'string' },
    pid: { type: 'integer' },
    detail: { type: 'string' },
    why: { type: 'string' },
    advice: { type: 'string' },
  },
}

function memoryView(facts) {
  if (!facts.length) return '记忆里还没有相关的事。'
  return facts.map((f) => {
    const tags = (f.tags || []).length ? `  [${f.tags.join(' / ')}]` : ''
    return `- (${f.id}) ${f.text}${tags}`
  }).join('\n')
}

function scanView(v) {
  if (v.ok === false) return `✘ ${v.error || '扫描失败'}`
  const lines = []
  const counts = v.db?.counts || {}
  lines.push(`大肥鱼安全检查 · ${v.scope} · 用时 ${(v.elapsedMs / 1000).toFixed(1)}s`)
  lines.push(`病毒库 ${v.db?.version || '?'}（进程 ${counts.processes || 0} / 命令 ${counts.commandPatterns || 0} / 文件名 ${counts.fileNames || 0} / 哈希 ${counts.hashes || 0}）`)
  lines.push(`扫了：进程 ${v.scanned?.processes || 0} · 启动项 ${v.scanned?.startup || 0} · 文件 ${v.scanned?.files || 0}（哈希 ${v.scanned?.hashed || 0}）`)
  if (v.findings?.length) {
    lines.push(`⚠ ${v.findings.length} 项要留意：`)
    for (const f of v.findings.slice(0, 20)) {
      const where = f.pid ? `PID ${f.pid}` : f.detail
      lines.push(`  [${f.severity === 'high' ? '高' : '中'}] ${f.kind} · ${f.name}${where ? ` (${where})` : ''}`)
      lines.push(`      ${f.why}`)
      lines.push(`      → ${f.advice}`)
    }
    if (v.findings.length > 20) lines.push(`  ……还有 ${v.findings.length - 20} 项`)
  } else {
    lines.push('✔ 没发现匹配的恶意程序。')
  }
  if (v.warnings?.length) lines.push(`注意：${v.warnings.join('；')}`)
  if (v.truncated) lines.push('（文件太多，本次只扫了一部分；可用 path 指定目录再扫）')
  lines.push(v.disclaimer || '')
  return lines.filter(Boolean).join('\n')
}

function statusView(v) {
  if (v.ok === false) return `✘ ${v.error || '读取失败'}`
  const c = v.db?.counts || {}
  const lines = [
    `病毒库：${v.db?.version || '?'}${v.db?.builtinVersion ? `（内置 ${v.db.builtinVersion}）` : ''}`,
    `规则：进程 ${c.processes || 0} · 命令 ${c.commandPatterns || 0} · 文件名 ${c.fileNames || 0} · 哈希 ${c.hashes || 0}`,
    `订阅：${v.feed?.url || '(未配置)'}${v.feed?.configured ? '' : '（未配置时只用内置库）'}`,
    `上次更新：${v.lastUpdate?.at ? `${v.lastUpdate.at} → ${v.lastUpdate.version}` : '还没更新过'}`,
    `上次扫描：${v.lastScan?.at ? `${v.lastScan.at} · ${v.lastScan.scope} · ${v.lastScan.verdict === 'clean' ? '没发现异常' : `${v.lastScan.findings} 项要留意`}` : '还没扫过'}`,
    `数据目录：${v.dataDir || ''}`,
  ]
  if (v.db?.cacheError) lines.push(`注意：${v.db.cacheError}`)
  return lines.join('\n')
}

function buildTools(cfg) {
  const memoryEnabled = cfg.memory?.enabled !== false
  const securityEnabled = cfg.security?.enabled !== false
  const feedUrl = String(cfg.security?.feedUrl ?? DEFAULT_FEED).trim()

  return [
    {
      name: 'fatfish_memory_save',
      description:
        '把主人说的长期有用的事实记进本地记忆（名字、喜好、习惯、重要日期、计划）。只在主人主动说出这类事实时调用；绝不要记密码、验证码、证件号、银行卡、API Key、住址。记忆只存在本机。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一句事实，最多 240 字' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选标签，最多 6 个' },
        },
        required: ['text'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            created: { type: 'boolean', description: 'true=新记忆，false=合并到已有记忆' },
            id: { type: 'string' },
            text: { type: 'string' },
            total: { type: 'integer' },
          },
        },
        render: (_a, v) => text(v.ok === false
          ? `✘ ${v.error}`
          : `${v.created ? '记下了' : '这条已经记过，补了标签'}（${v.id}），现在一共 ${v.total} 条。\n${v.text || ''}`),
      },
      execute: guard(async (args) => {
        if (!memoryEnabled) throw new Error('记忆功能已在设置里关闭')
        const r = saveFact({
          text: args.text,
          tags: args.tags,
          source: 'tool',
          maxFacts: cfg.memory?.maxFacts || MEMORY_LIMIT_DEFAULT,
        })
        return { ok: true, created: r.created, id: r.fact.id, text: r.fact.text, total: r.total }
      }),
    },
    {
      name: 'fatfish_memory_recall',
      description:
        '从本地记忆里找和主人有关的事。回答关于主人的问题前先查一下；query 留空则按时间列最近几条。不会把整库都倒出来。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要找的关键词；留空=最近记忆' },
          limit: { type: 'integer', description: '返回几条，默认 5，最多 20' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            facts: { type: 'array', items: MEMORY_ITEM_SCHEMA },
            count: { type: 'integer' },
          },
        },
        render: (_a, v) => text(v.ok === false ? `✘ ${v.error}` : memoryView(v.facts || [])),
      },
      execute: guard(async (args) => {
        if (!memoryEnabled) throw new Error('记忆功能已在设置里关闭')
        const facts = recallFacts(args.query || '', { limit: clamp(args.limit, 1, 20, 5) })
        return { ok: true, facts, count: facts.length }
      }),
    },
    {
      name: 'fatfish_memory_forget',
      description:
        '删掉本地记忆。只有主人明确说「忘掉 / 删掉 / 不记得这个」时才调用；给 id 最稳，也可以给一段描述。没有「清空全部」这个用法。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '记忆 id（recall 返回的括号里那串）' },
          query: { type: 'string', description: '按内容匹配，至少两个字' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            removed: { type: 'integer' },
            total: { type: 'integer' },
            items: { type: 'array', items: MEMORY_ITEM_SCHEMA },
          },
        },
        render: (_a, v) => text(v.ok === false
          ? `✘ ${v.error}`
          : v.removed
            ? `删掉 ${v.removed} 条，还剩 ${v.total} 条：\n${(v.items || []).map((f) => `- ${f.text}`).join('\n')}`
            : '没找到匹配的记忆，没删东西。'),
      },
      execute: guard(async (args) => {
        if (!memoryEnabled) throw new Error('记忆功能已在设置里关闭')
        if (!args.id && !args.query) throw new Error('给一个 id 或一段描述')
        const r = forgetFacts({ id: args.id, query: args.query })
        return { ok: true, removed: r.removed.length, total: r.total, items: r.removed }
      }),
    },
    {
      name: 'fatfish_security_status',
      description:
        '看病毒库和安全检查状态：规则数量、上次更新时间、上次扫描结果、数据目录。查毒前先看一眼。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            db: { type: 'object' },
            feed: { type: 'object' },
            lastUpdate: { type: 'object' },
            lastScan: { type: 'object' },
            dataDir: { type: 'string' },
          },
        },
        render: (_a, v) => text(statusView(v)),
      },
      execute: guard(async () => {
        if (!securityEnabled) throw new Error('安全检查已在设置里关闭')
        return securityStatus({ feedUrl })
      }),
    },
    {
      name: 'fatfish_security_update',
      description:
        '从 https 地址拉取最新病毒库（只下载规则 JSON，不上传任何本机数据）。地址不填就用设置里的订阅地址。更新失败会继续用旧库/内置库。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '可选：https 开头的病毒库 JSON 地址' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            version: { type: 'string' },
            source: { type: 'string' },
            counts: { type: 'object' },
            at: { type: 'string' },
          },
        },
        render: (_a, v) => text(v.ok === false
          ? `✘ ${v.error}`
          : `病毒库已更新到 ${v.version}（${v.source}）\n进程 ${v.counts?.processes || 0} · 命令 ${v.counts?.commandPatterns || 0} · 文件名 ${v.counts?.fileNames || 0} · 哈希 ${v.counts?.hashes || 0}`),
      },
      execute: guard(async (args) => {
        if (!securityEnabled) throw new Error('安全检查已在设置里关闭')
        const url = String(args.url || feedUrl || '').trim()
        if (!url) throw new Error('没配置病毒库地址，给一个 https 订阅地址')
        return updateSignatures(url)
      }),
    },
    {
      name: 'fatfish_security_scan',
      description:
        '本地轻量查杀：检查可疑进程、开机启动项、下载/桌面/临时目录里的可执行文件。只读，不删文件、不杀进程；发现可疑项会说明原因和处理建议。scope=quick 默认全查。',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['quick', 'process', 'startup', 'path'],
            description: 'quick=进程+启动项+常用目录；path=只扫指定路径',
          },
          path: { type: 'string', description: 'scope=path 时的目录或文件路径' },
          maxFiles: { type: 'integer', description: '最多扫多少文件，默认 200，最多 2000' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            scope: { type: 'string' },
            verdict: { type: 'string' },
            elapsedMs: { type: 'number' },
            scanned: { type: 'object' },
            findings: { type: 'array', items: FINDING_SCHEMA },
            warnings: { type: 'array', items: { type: 'string' } },
            truncated: { type: 'boolean' },
            db: { type: 'object' },
            disclaimer: { type: 'string' },
          },
        },
        render: (_a, v) => text(scanView(v)),
      },
      execute: guard(async (args) => {
        if (!securityEnabled) throw new Error('安全检查已在设置里关闭')
        const scope = ['quick', 'process', 'startup', 'path'].includes(args.scope) ? args.scope : 'quick'
        return scan({
          scope,
          target: String(args.path || ''),
          maxFiles: clamp(args.maxFiles, 20, 2000, 200),
        })
      }),
    },
    {
      name: 'fatfish_act',
      description:
        '大肥鱼做一个小动作并说一句符合人设的话。想卖萌、表达情绪、或者主人让你做动作时调用。可选：stretch 伸懒腰 / bubble 吐泡泡 / nap 打盹 / pat 被摸头 / snack 吃一口 / roll 翻肚皮 / tail 甩尾巴。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: Object.keys(ACTIONS),
            description: '动作名',
          },
          note: { type: 'string', description: '可选：加一句现场吐槽，最多 60 字' },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            action: { type: 'string' },
            label: { type: 'string' },
            text: { type: 'string' },
          },
        },
        render: (_a, v) => text(v.ok === false ? `✘ ${v.error}` : v.text),
      },
      execute: async (args) => performAction(args.action, args.note),
    },
  ]
}

function renderFacts(facts) {
  if (!facts.length) return '记忆里还没有相关的事。'
  return facts.map((f) => `- ${f.text}（${f.id}）`).join('\n')
}

function scheduleUpdates(ctx, cfg, feedUrl) {
  if (!feedUrl || cfg.security?.autoUpdate === false) return
  const hours = clamp(cfg.security?.updateHours, 1, 168, 12)
  const tick = async () => {
    try {
      const last = Date.parse(loadState()?.lastUpdate?.at || '') || 0
      if (Date.now() - last < hours * 3600_000) return
      await updateSignatures(feedUrl, { timeoutMs: 20000 })
    } catch {
      /* 网络不通就继续用旧库，不打扰主人 */
    }
  }
  const first = setTimeout(tick, 15000)
  const timer = setInterval(tick, 3600_000)
  first.unref?.()
  timer.unref?.()
  ctx.effect(() => () => {
    clearTimeout(first)
    clearInterval(timer)
  }, 'fatfish.security.autoUpdate()')
}

export const name = 'fatfish'
export const inject = ['systemPrompt', 'tools']

export const Config = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['normal', 'roast', 'sleepy', 'custom'],
      default: 'normal',
      description: '人设模式: normal(好脾气) / roast(毒舌) / sleepy(犯困) / custom(自定义)',
    },
    custom: { type: 'string', default: '', description: '自定义人设文本(仅 mode=custom 时生效, 最多600字)' },
    enableTimeAwareness: { type: 'boolean', default: true, description: '时段感知' },
    enableMood: { type: 'boolean', default: true, description: '情绪状态' },
    memory: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true, description: '启用本地记忆' },
        autoCapture: { type: 'boolean', default: true, description: '从对话里自动记下事实' },
        maxFacts: { type: 'integer', default: MEMORY_LIMIT_DEFAULT, minimum: 50, maximum: 1000 },
      },
    },
    security: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true, description: '启用本地安全检查' },
        feedUrl: { type: 'string', default: DEFAULT_FEED, description: '病毒库 HTTPS 订阅地址，留空只用内置库' },
        autoUpdate: { type: 'boolean', default: true, description: '按周期自动更新病毒库' },
        updateHours: { type: 'integer', default: 12, minimum: 1, maximum: 168, description: '自动更新间隔（小时）' },
      },
    },
    api: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false, description: '启用独立 API（不依赖 DSH 的 LLM）' },
        provider: { type: 'string', enum: Object.keys(FREE_API_PROVIDERS), default: 'zhipu', description: 'API 提供商' },
        apiKey: { type: 'string', default: '', description: 'API Key' },
        model: { type: 'string', default: 'glm-4-flash', description: '使用的模型' },
      },
    },
  },
}

export function apply(ctx, config) {
  const cfg = config ?? {}
  const mode = ['normal', 'roast', 'sleepy', 'custom'].includes(cfg.mode) ? cfg.mode : 'normal'
  const custom = typeof cfg.custom === 'string' ? cfg.custom : ''
  const enableTimeAwareness = cfg.enableTimeAwareness !== false
  const enableMood = cfg.enableMood !== false
  const memoryEnabled = cfg.memory?.enabled !== false
  const securityEnabled = cfg.security?.enabled !== false
  const feedUrl = String(cfg.security?.feedUrl ?? DEFAULT_FEED).trim()

  const recent = memoryEnabled ? listFacts(8) : []
  const personaText = buildPersonaText(mode, custom, enableTimeAwareness, enableMood, {
    memories: recent,
    memoryEnabled,
    securityEnabled,
  })

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'fatfish:persona',
    order: 100,
    text: personaText,
  }), 'fatfish.persona()')

  const disposers = []
  if (ctx.tools?.register) {
    for (const tool of buildTools(cfg)) {
      disposers.push(ctx.tools.register(tool))
    }
    if (disposers.length) {
      ctx.effect(() => () => {
        for (const d of disposers) {
          try { d() } catch {}
        }
      }, 'fatfish.tools()')
    }
  }

  if (ctx.command) {
    if (cfg.api?.enabled) {
      ctx.command?.('fatfish.chat <message...>', '和大肥鱼聊天（独立 API）', async (message) => {
        try {
          const api = resolveApiConfig(cfg.api)
          const memories = memoryEnabled ? recallFacts(message, { limit: 5 }) : []
          const persona = buildPersonaText(mode, custom, enableTimeAwareness, enableMood, {
            memories,
            memoryEnabled,
            securityEnabled,
          })
          const reply = await callAPI([
            { role: 'system', content: persona },
            { role: 'user', content: String(message || '') },
          ], api)
          if (memoryEnabled && cfg.memory?.autoCapture !== false) {
            autoCapture(message, { maxFacts: cfg.memory?.maxFacts || MEMORY_LIMIT_DEFAULT })
          }
          return reply
        } catch (err) {
          return `咕噜... 出错了: ${err.message}`
        }
      })
    }

    if (memoryEnabled) {
      ctx.command?.('fatfish.remember <text...>', '让大肥鱼记住一件事', async (value) => {
        try {
          const r = saveFact({ text: value, source: 'command', maxFacts: cfg.memory?.maxFacts || MEMORY_LIMIT_DEFAULT })
          return `${r.created ? '记下了' : '这条已经记过'}（${r.fact.id}），一共 ${r.total} 条。`
        } catch (e) {
          return `咕噜... 记不了：${e.message}`
        }
      })
      ctx.command?.('fatfish.recall <query...>', '翻大肥鱼的记忆', async (value) => {
        const facts = recallFacts(value || '', { limit: 5 })
        return facts.length ? renderFacts(facts) : '记忆里没有相关的事。'
      })
    }

    if (securityEnabled) {
      ctx.command?.('fatfish.scan [scope]', '本地轻量查杀：quick / process / startup', async (value) => {
        const scope = ['quick', 'process', 'startup'].includes(String(value || '').trim()) ? String(value).trim() : 'quick'
        try {
          return scanView(await scan({ scope }))
        } catch (e) {
          return `咕噜... 扫不了：${e.message}`
        }
      })
    }

    ctx.command?.('fatfish.act <action>', `大肥鱼做动作：${Object.keys(ACTIONS).join(' / ')}`, async (value) => {
      const r = performAction(String(value || '').trim())
      return r.ok ? r.text : r.error
    })
  }

  scheduleUpdates(ctx, cfg, securityEnabled ? feedUrl : '')

  try {
    console.log(`[fatfish] 人设 ${mode} · 工具 ${disposers.length} 个 · 记忆 ${memoryStats().total} 条`)
  } catch {}
}

export {
  FREE_API_PROVIDERS,
  RED_LINES,
  PERSONA_BASE,
  PERSONA_NORMAL,
  PERSONA_ROAST,
  PERSONA_SLEEPY,
  buildPersonaText,
  getPeriod,
  energyTarget,
  moodLabel,
  resolveApiConfig,
  callAPI,
}

export const _internal = {
  buildTools,
  memoryView,
  scanView,
  statusView,
  DEFAULT_FEED,
}
