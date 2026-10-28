/**
 * dsh-fatfish-hands · 插件入口
 *
 * 给 DSH 里的 agent 一双「手」：用系统自带 Microsoft Edge 真上网。
 * 工具读的是**页面文字和链接**，不是像素坐标——比截图猜位置稳得多。
 *
 * 安全边界（写死在浏览器内核 lib/edge.js 里，不靠提示词自觉）：
 *   - 专用干净配置，不碰主人日常 Edge 的登录态/书签/历史；
 *   - 只允许 http/https；支付/网购/银行站点直接拒绝；
 *   - 下载一律拒绝；有密码框的页面拒绝输入；支付/验证码页面拒绝点击和输入。
 */
import { EdgeRpc, EdgeUnavailable, findNode, findCli, dshHome } from './bridge.js'
import { pcStatus } from './pc.js'

const text = (s) => [{ type: 'text', text: s }]

function shortHref(href) {
  try {
    const u = new URL(href)
    return ((u.hostname || '') + (u.pathname || '/')).slice(0, 80)
  } catch {
    return String(href || '').slice(0, 80)
  }
}

function pageView(v) {
  const lines = [`标题: ${v.title || '(无标题)'}`, `网址: ${v.url || ''}`]
  const heads = (v.headings || []).filter(Boolean).slice(0, 6)
  if (heads.length) lines.push('小标题: ' + heads.map((h) => String(h).slice(0, 40)).join(' / '))
  const links = v.links || []
  if (links.length) {
    lines.push(`可点链接（${links.length} 个，点击时把方括号里的编号给 fatfish_edge_click）:`)
    for (const l of links) {
      lines.push(`  [${l.i}] ${String(l.text || '').slice(0, 70)} -> ${shortHref(l.href)}`)
    }
  } else {
    lines.push('可点链接: (这一页没有可点的链接)')
  }
  if (v.text) lines.push('正文节选:\n' + String(v.text).slice(0, 2000))
  if (v.hasPassword) lines.push('⚠ 这一页有密码框。不要输入任何账号、密码或验证码；需要登录就请主人自己来。')
  if (v.hasVideo) lines.push('(这一页有音视频)')
  return lines.join('\n')
}

const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: '动作是否成功' },
    error: { type: 'string', description: '失败原因（ok=false 时）' },
    title: { type: 'string' },
    url: { type: 'string' },
    text: { type: 'string', description: '页面正文节选' },
    headings: { type: 'array', items: { type: 'string' } },
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: '点击时用的编号' },
          text: { type: 'string' },
          href: { type: 'string' },
        },
      },
    },
    hasPassword: { type: 'boolean' },
    hasVideo: { type: 'boolean' },
  },
}

const pageOutput = {
  schema: PAGE_SCHEMA,
  render: (_args, v) => text(v && v.ok === false ? `✘ ${v.error || '失败'}` : pageView(v || {})),
}

function guard(fn) {
  return async (args, ctx) => {
    try {
      return await fn(args || {}, ctx)
    } catch (e) {
      const msg = String(e?.message || e)
      if (e instanceof EdgeUnavailable || /找不到可用的 node/.test(msg)) {
        return { ok: false, error: msg + '（装过 DSH 就会自带 node；也可以设置 DSH_NODE 环境变量。）' }
      }
      return { ok: false, error: msg }
    }
  }
}

export const TOOLS = [
  {
    name: 'fatfish_edge_status',
    description:
      '查看专用 Edge 浏览器现在开着哪个页面、调试端口和配置目录。不会打开新窗口以外的任何东西；第一次调用会启动 Edge。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          ready: { type: 'string' },
          port: { type: 'integer' },
          edge: { type: 'string', description: 'Edge 可执行文件路径' },
          profile: { type: 'string', description: '专用配置目录' },
        },
      },
      render: (_a, v) => text(v.ok === false
        ? `✘ ${v.error}`
        : `Edge 状态\n  页面: ${v.title || '(空白页)'}\n  网址: ${v.url || ''}\n  通道: 127.0.0.1:${v.port}\n  程序: ${v.edge || '?'}\n  配置: ${v.profile || '?'}`),
    },
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('status', {}, 60000)
      return { ok: true, ...r }
    }),
  },
  {
    name: 'fatfish_edge_open',
    description:
      '用专用 Edge 打开一个 http/https 网址，并返回页面标题、可点链接和正文节选。支付、网购、银行类站点会被安全层直接拒绝。打开后想点页面上的东西，用 fatfish_edge_click 的 index（编号来自这次返回的链接列表）。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整网址，必须以 http:// 或 https:// 开头' },
        maxLinks: { type: 'integer', description: '返回多少个链接，默认 25，最多 60' },
        maxChars: { type: 'integer', description: '返回多少正文字符，默认 4000，最多 20000' },
      },
      required: ['url'],
    },
    output: pageOutput,
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('open', { url: String(args.url || '') }, 90000)
      return { ok: true, ...trimPage(r, args) }
    }),
  },
  {
    name: 'fatfish_edge_read',
    description:
      '读取当前页面的标题、可点链接（带编号）和正文节选。逛网页时先 read 再决定点什么；不要靠猜坐标。',
    parameters: {
      type: 'object',
      properties: {
        maxLinks: { type: 'integer', description: '返回多少个链接，默认 25，最多 60' },
        maxChars: { type: 'integer', description: '返回多少正文字符，默认 4000，最多 20000' },
      },
    },
    output: pageOutput,
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('read', {
        maxLinks: clamp(args.maxLinks, 5, 60, 25),
        maxChars: clamp(args.maxChars, 500, 20000, 4000),
      }, 60000)
      return { ok: true, ...trimPage(r, args) }
    }),
  },
  {
    name: 'fatfish_edge_click',
    description:
      '点击当前页面上的元素。index 是「最近一次 read/open 返回的链接编号」，最稳；也可以给可见文字 text 或 CSS selector。编号对不上时（比如页面刚被滚动或别处改过），直接用 fatfish_edge_open 打开链接的完整 href。点完会返回新页面。不要点广告、下载、登录注册；支付/验证码页面会被安全层拒绝。',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '最近一次 read 返回的链接编号' },
        text: { type: 'string', description: '元素上的可见文字（链接编号不好用时）' },
        selector: { type: 'string', description: 'CSS 选择器（前两种都不行时）' },
      },
    },
    output: pageOutput,
    execute: guard(async (args, ctx) => {
      const payload = {}
      if (args.index !== undefined && args.index !== null && args.index !== '') payload.index = Number(args.index)
      else if (args.selector) payload.selector = String(args.selector)
      else if (args.text) payload.text = String(args.text)
      else throw new Error('给 index / text / selector 之一')
      const r = await ctx.rpc.call('click', payload, 90000)
      return { ok: true, ...trimPage(r, args) }
    }),
  },
  {
    name: 'fatfish_edge_type',
    description:
      '在当前页面的输入框里打字（默认找搜索框），submit=true 时回车提交。禁止输入密码、验证码、支付信息；页面有密码框时会被安全层拒绝。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要输入的内容' },
        submit: { type: 'boolean', description: '打完是否回车提交，默认 false' },
        selector: { type: 'string', description: '可选：指定输入框的 CSS 选择器' },
      },
      required: ['text'],
    },
    output: pageOutput,
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('type', {
        text: String(args.text ?? ''),
        submit: Boolean(args.submit),
        selector: args.selector ? String(args.selector) : undefined,
      }, 90000)
      return { ok: true, ...trimPage(r, args) }
    }),
  },
  {
    name: 'fatfish_edge_press',
    description: '按一个键：Enter / Tab / Escape / ArrowDown / PageDown / Home / End / Space 等。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '按键名，默认 Enter' },
      },
      required: ['key'],
    },
    output: pageOutput,
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('press', { key: String(args.key || 'Enter') }, 60000)
      return { ok: true, ...trimPage(r, args) }
    }),
  },
  {
    name: 'fatfish_edge_scroll',
    description: '滚动当前页面。dy 为正数往下、负数往上，常见 600~1200。滚完返回页面文字。',
    parameters: {
      type: 'object',
      properties: {
        dy: { type: 'integer', description: '滚动像素，默认 800' },
      },
    },
    output: pageOutput,
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('scroll', { dy: clamp(args.dy, -5000, 5000, 800) }, 60000)
      return { ok: true, ...trimPage(r, args) }
    }),
  },
  {
    name: 'fatfish_edge_back',
    description: '后退一页，返回上一页的标题、链接和正文。',
    parameters: { type: 'object', properties: {} },
    output: pageOutput,
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('back', {}, 60000)
      return { ok: true, ...trimPage(r, args) }
    }),
  },
  {
    name: 'fatfish_edge_screenshot',
    description: '给当前页面截一张 PNG，返回保存路径。只在文字读不出关键信息时用（比如图表、验证码页面）。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          path: { type: 'string', description: '截图文件路径' },
          width: { type: 'integer' },
          height: { type: 'integer' },
        },
      },
      render: (_a, v) => text(v.ok === false ? `✘ ${v.error}` : `已截图: ${v.path} (${v.width}x${v.height})`),
    },
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('shot', {}, 60000)
      return { ok: true, ...r }
    }),
  },
  {
    name: 'fatfish_edge_close',
    description: '关闭专用 Edge 窗口。只关插件自己的干净配置窗口，不影响主人日常使用的 Edge。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          closed: { type: 'boolean' },
        },
      },
      render: (_a, v) => text(v.ok === false ? `✘ ${v.error}` : '专用 Edge 已关闭。'),
    },
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('close', {}, 20000).catch((e) => ({ closed: false, note: String(e.message || e) }))
      ctx.rpc.close()
      return { ok: true, closed: Boolean(r.closed) }
    }),
  },
  {
    name: 'fatfish_doctor',
    description: '体检：node 运行时、edge-cli 脚本、Edge 程序、调试端口、专用配置目录是否都就位。装完插件先跑一次。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          node: { type: 'string' },
          cli: { type: 'string' },
          edge: { type: 'string' },
          port: { type: 'integer' },
          running: { type: 'boolean', description: '调试端口现在是否已启动' },
          browser: { type: 'string', description: 'Edge 版本' },
          profile: { type: 'string' },
          config: { type: 'string' },
          dshHome: { type: 'string' },
        },
      },
      render: (_a, v) => text([
        '大肥鱼之手 · 体检',
        `  node   : ${v.node || '✘ 没找到'}`,
        `  脚本   : ${v.cli || '✘ 没找到'}`,
        `  Edge   : ${v.edge || '✘ 没找到'}`,
        `  调试口 : 127.0.0.1:${v.port} ${v.running ? '已启动' : '未启动（第一次用工具时会自动拉起）'}`,
        v.browser ? `  版本   : ${v.browser}` : '',
        `  配置   : ${v.config}`,
        `  数据   : ${v.profile}`,
      ].filter(Boolean).join('\n')),
    },
    execute: guard(async (args, ctx) => {
      const r = await ctx.rpc.call('doctor', {}, 30000)
      return { ok: true, node: findNode(), cli: findCli(), dshHome: dshHome(), ...r }
    }),
  },
  {
    name: 'fatfish_pc_status',
    description: '看一眼这台电脑的状态：内存占用、开机多久、CPU 核数、最占内存的几个进程。只读，不会结束任何程序。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          platform: { type: 'string' },
          hostname: { type: 'string' },
          uptimeHours: { type: 'number' },
          cpu: { type: 'string' },
          memoryTotalGB: { type: 'number' },
          memoryFreeGB: { type: 'number' },
          memoryUsedPercent: { type: 'integer' },
          topProcesses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                pid: { type: 'integer' },
                memoryMB: { type: 'integer' },
              },
            },
          },
        },
      },
      render: (_a, v) => {
        if (v.ok === false) return text(`✘ ${v.error}`)
        const lines = [
          `电脑状态（${v.platform}，${v.hostname}）`,
          `  已开机: ${v.uptimeHours} 小时 · CPU ${v.cpu}`,
          `  内存: 已用 ${v.memoryUsedPercent}%（${v.memoryTotalGB} GB 中剩 ${v.memoryFreeGB} GB）`,
        ]
        if (v.topProcesses?.length) {
          lines.push('  最占内存:')
          for (const p of v.topProcesses) lines.push(`    ${p.name}  ${p.memoryMB} MB`)
        }
        return text(lines.join('\n'))
      },
    },
    execute: async () => {
      try {
        return { ok: true, ...(await pcStatus()) }
      } catch (e) {
        return { ok: false, error: String(e?.message || e) }
      }
    },
  },
]

function clamp(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function trimPage(page, args) {
  const maxLinks = clamp(args?.maxLinks, 5, 60, 25)
  const maxChars = clamp(args?.maxChars, 500, 20000, 4000)
  const out = { ...(page || {}) }
  if (Array.isArray(out.links)) out.links = out.links.slice(0, maxLinks)
  if (typeof out.text === 'string') out.text = out.text.slice(0, maxChars)
  return out
}

export default {
  name: 'dsh-fatfish-hands',
  inject: ['tools'],
  apply(ctx) {
    const rpc = new EdgeRpc()
    const disposers = []
    for (const spec of TOOLS) {
      disposers.push(ctx.tools.register({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: spec.output,
        execute: (args, exec) => spec.execute(args, { rpc, signal: exec?.signal, agent: exec?.agent }),
      }))
    }
    ctx.effect(() => () => {
      for (const d of disposers) {
        try { d() } catch {}
      }
      rpc.close()
    })
    try {
      console.log(`[fatfish-hands] 已挂载 ${TOOLS.length} 个工具 · Edge 配置 ${dshHome()}\\fatfish-hands`)
    } catch {}
  },
}
