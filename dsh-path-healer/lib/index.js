/**
 * dsh-path-healer —— 环境路径自愈
 *
 * 换电脑、换盘符、挪目录之后，配置里的 Node/Python/Git/Edge/DSH/NapCat
 * 路径经常会失效。本插件体检这些路径，能找回的就写回 JSON 配置。
 *
 * 边界：只读文件系统 + 只写自己的配置文件，不执行命令、不联网、不删文件。
 */
import {
  heal,
  getPath,
  defaultConfigFile,
  defaultTargets,
  IS_WIN,
} from './detect.js'

export const name = 'path-healer'
export const inject = ['tools']

export const Config = {
  type: 'object',
  properties: {
    configFile: {
      type: 'string',
      default: '',
      description: '要体检的 JSON 配置路径；留空 = ~/.dsh/path-healer.json',
    },
    scanDrives: {
      type: 'boolean',
      default: false,
      description: '已知位置都找不到时，是否浅层扫盘兜底（慢，可能几十秒）',
    },
    maxDepth: {
      type: 'integer',
      default: 4,
      minimum: 1,
      maximum: 8,
      description: '扫盘兜底的最大目录深度',
    },
    targets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '配置里的键名' },
          label: { type: 'string', description: '显示名' },
          marker: { type: 'string', description: '用来确认路径的可执行文件名' },
          depth: { type: 'integer', description: '扫盘深度' },
          dirs: { type: 'array', items: { type: 'string' }, description: '额外候选目录' },
        },
        required: ['key', 'marker'],
      },
      description: '在默认目标之外追加/覆盖检查项（例如自己的工具链）',
    },
  },
}

const STATUS = {
  ok: '在用',
  moved: '已修正',
  filled: '已补齐',
  missing: '没找到',
}

function formatReport(result) {
  const lines = []
  lines.push(`环境路径体检：${result.configFile}`)
  for (const entry of result.entries) {
    const mark = STATUS[entry.status] || entry.status
    const value = entry.path || (entry.old ? `旧值失效：${entry.old}` : '-')
    lines.push(`  [${mark}] ${entry.label}：${value}`)
  }
  if (result.written) {
    lines.push(`已写回配置${result.backup ? `，旧文件备份在 ${result.backup}` : ''}。`)
  } else if (result.changed) {
    lines.push('发现可修复项，当前是只检查模式，没有写盘。')
  } else {
    lines.push('没有需要改的，配置保持原样。')
  }
  const missing = result.entries.filter((e) => e.status === 'missing')
  if (missing.length) {
    lines.push(`没找到：${missing.map((e) => e.label).join('、')}。装好之后重跑 repair，或在配置里手动填。`)
  }
  return lines.join('\n')
}

function run(args, config) {
  const action = ['check', 'repair', 'get'].includes(args.action) ? args.action : 'check'
  const opts = {
    configFile: config.configFile || defaultConfigFile(),
    deep: args.deep === true || (args.deep !== false && config.scanDrives === true),
    maxDepth: config.maxDepth,
    write: false,
  }
  if (action === 'get') {
    const key = String(args.key || '').trim()
    if (!key) throw new Error('get 需要指定 key，例如 node / python / git')
    const found = getPath(key, opts)
    return {
      ok: !!found,
      action,
      changed: false,
      written: false,
      configFile: opts.configFile,
      entries: [],
      text: found ? `${key}: ${found}` : `${key}: 找不到有效路径，可以先跑 check 看看。`,
    }
  }
  if (action === 'repair') opts.write = true
  const result = heal(opts)
  return {
    ok: result.ok,
    action,
    changed: result.changed,
    written: result.written,
    configFile: result.configFile,
    backup: result.backup,
    entries: result.entries.map((e) => ({
      key: e.key,
      label: e.label,
      status: e.status,
      path: e.path,
      old: e.old,
    })),
    text: formatReport(result),
  }
}

export function apply(ctx, config) {
  const cfg = config || {}
  const logger = ctx.logger ? ctx.logger('path-healer') : console

  if (ctx.tools?.register) {
    const dispose = ctx.tools.register({
      name: 'path_healer',
      description:
        '检查或修复本机工具路径（Node、Python、Git、Edge、DSH NEXT、NapCat）。换电脑/换盘符后配置里的路径失效时用：action=check 只体检，action=repair 找回并写回 JSON 配置，action=get 取某一项的路径。只读写插件自己的配置，不执行命令、不联网、不删文件。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['check', 'repair', 'get'],
            description: 'check=只体检；repair=修复并写回；get=取单个路径',
          },
          key: {
            type: 'string',
            description: 'action=get 时的键名：node / python / pythonw / git / edge / dsh / napcat',
          },
          deep: {
            type: 'boolean',
            description: '已知位置找不到时是否浅层扫盘（默认跟随插件配置 scanDrives）',
          },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            action: { type: 'string' },
            changed: { type: 'boolean' },
            written: { type: 'boolean' },
            configFile: { type: 'string' },
            backup: { type: 'string' },
            text: { type: 'string' },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  label: { type: 'string' },
                  status: { type: 'string' },
                  path: { type: 'string' },
                  old: { type: 'string' },
                },
              },
            },
          },
          required: ['ok', 'action', 'text'],
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args) => {
        try {
          return run(args || {}, cfg)
        } catch (e) {
          return {
            ok: false,
            action: String(args?.action || 'check'),
            changed: false,
            written: false,
            configFile: cfg.configFile || defaultConfigFile(),
            entries: [],
            text: `路径体检失败：${e.message}`,
          }
        }
      },
    })
    ctx.effect(() => dispose, 'path-healer.tools()')
  }

  if (ctx.command) {
    ctx.command?.('pathhealer.check', '体检 Node/Python/Git/Edge/DSH 等路径（只读）', async () => {
      try {
        return formatReport(heal({
          configFile: cfg.configFile || defaultConfigFile(),
          deep: cfg.scanDrives === true,
          maxDepth: cfg.maxDepth,
          write: false,
        }))
      } catch (e) {
        return `路径体检失败：${e.message}`
      }
    })
    ctx.command?.('pathhealer.repair', '找回失效的工具路径并写回配置（写前备份）', async () => {
      try {
        return formatReport(heal({
          configFile: cfg.configFile || defaultConfigFile(),
          deep: cfg.scanDrives === true,
          maxDepth: cfg.maxDepth,
          write: true,
        }))
      } catch (e) {
        return `路径修复失败：${e.message}`
      }
    })
    ctx.command?.('pathhealer.get <key>', '取某个工具的当前路径', async (key) => {
      try {
        const found = getPath(String(key || '').trim(), {
          configFile: cfg.configFile || defaultConfigFile(),
          deep: cfg.scanDrives === true,
          maxDepth: cfg.maxDepth,
        })
        return found ? found : `找不到 ${key || ''} 的有效路径。`
      } catch (e) {
        return `查询失败：${e.message}`
      }
    })
  }

  try {
    logger.log(`[path-healer] 平台 ${IS_WIN ? 'Windows' : process.platform} · 配置 ${cfg.configFile || defaultConfigFile()} · 目标 ${defaultTargets().length + (cfg.targets?.length || 0)} 项`)
  } catch {}
}

export { heal, getPath, defaultConfigFile, defaultTargets, IS_WIN }
export const _internal = { formatReport, run }
