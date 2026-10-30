/**
 * dsh-batch-doctor —— Windows 脚本编码体检
 *
 * 中文 bat/cmd 被存成 UTF-8、ps1 没有 BOM、行尾混用 LF、chcp 和文件编码
 * 对不上——这些都是「本机好好的，换台电脑就乱码」的常见原因。本插件
 * 扫指定目录，给出问题行；fix 时会转编码、统一 CRLF、补 BOM，写前留 .bak。
 *
 * 边界：只动 .bat/.cmd/.ps1，只在指定目录内，不联网、不删文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  lintDir,
  fixDir,
  IS_WIN,
  DEFAULT_EXTENSIONS,
} from './lint.js'

export const name = 'batch-doctor'
export const inject = ['tools']

export const Config = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['gbk', 'utf8'],
      default: 'gbk',
      description: 'fix 时的目标编码：中文批处理建议 gbk',
    },
    backup: {
      type: 'boolean',
      default: true,
      description: '改写前是否留 .bak',
    },
    maxFiles: {
      type: 'integer',
      default: 1000,
      minimum: 1,
      maximum: 5000,
      description: '单次最多扫描多少个脚本',
    },
    stalePaths: {
      type: 'array',
      items: { type: 'string' },
      description: '要留意的写死路径正则（例如 F:\\\\111|D:\\\\D盘）',
    },
    skipDirs: {
      type: 'array',
      items: { type: 'string' },
      description: '额外跳过的目录名',
    },
  },
}

const LEVEL = { error: '错误', warning: '警告', info: '提示' }

function normalizeOptions(args, config) {
  const mode = args.mode === 'utf8' ? 'utf8' : (args.mode === 'gbk' ? 'gbk' : config.mode || 'gbk')
  const maxFiles = Number.isInteger(args.maxFiles)
    ? Math.max(1, Math.min(5000, args.maxFiles))
    : (config.maxFiles || 1000)
  return {
    mode,
    backup: args.backup !== false && config.backup !== false,
    maxFiles,
    stalePaths: Array.isArray(args.stalePaths) ? args.stalePaths.map(String) : (config.stalePaths || []),
    skipDirs: Array.isArray(config.skipDirs) ? config.skipDirs.map(String) : [],
    extensions: Array.isArray(args.extensions) && args.extensions.length
      ? args.extensions.map(String)
      : DEFAULT_EXTENSIONS,
  }
}

function formatLint(result) {
  const head = `脚本体检：${result.root}（扫描 ${result.scanned} 个，错误 ${result.errors}，警告 ${result.warnings}）`
  const lines = [head]
  for (const file of result.files) {
    for (const issue of file.issues) {
      lines.push(`  [${LEVEL[issue.level] || issue.level}] ${file.rel}：${issue.message}`)
    }
  }
  if (!result.files.length) lines.push('  没发现问题。')
  return lines.join('\n')
}

function formatFix(result, mode, write) {
  const head = `脚本修复：${result.root}（模式 ${mode}，扫描 ${result.scanned} 个，` +
    `可改写 ${result.changed} 个，实际写盘 ${result.written} 个${write ? '' : '，当前是预演'}）`
  const lines = [head]
  for (const item of result.results) {
    const rel = path.relative(result.root, item.file)
    if (item.error) {
      lines.push(`  [跳过] ${rel}：${item.error}`)
      continue
    }
    const notes = item.notes && item.notes.length ? `，${item.notes.join('、')}` : ''
    lines.push(`  [改写] ${rel}：${item.from} -> ${item.to}${notes}`)
  }
  if (!result.results.length) lines.push('  没有需要改的。')
  if (result.changed && !write) lines.push('预演模式没有写盘；确认无误后用 write=true 或 /batchdoctor.fix 执行。')
  return lines.join('\n')
}

function run(args, config) {
  const action = args.action === 'fix' ? 'fix' : 'lint'
  const dir = String(args.dir || '').trim() || process.cwd()
  const stat = fs.statSync(dir, { throwIfNoEntry: false })
  if (!stat || !stat.isDirectory()) throw new Error(`目录不存在：${dir}`)
  const opts = normalizeOptions(args, config)
  if (action === 'lint') {
    const result = lintDir(dir, opts)
    return {
      ok: result.errors === 0,
      action,
      dir: result.root,
      scanned: result.scanned,
      errors: result.errors,
      warnings: result.warnings,
      changed: 0,
      written: 0,
      files: result.files.map((f) => ({
        file: f.rel,
        encoding: f.encoding,
        issues: f.issues.map((i) => ({ level: i.level, code: i.code, message: i.message })),
      })),
      text: formatLint(result),
    }
  }
  opts.write = args.write === true
  const result = fixDir(dir, opts)
  return {
    ok: !result.results.some((r) => r.error),
    action,
    dir: result.root,
    scanned: result.scanned,
    errors: result.before.errors,
    warnings: result.before.warnings,
    changed: result.changed,
    written: result.written,
    files: result.results.map((r) => ({
      file: r.file,
      changed: r.changed,
      written: !!r.written,
      from: r.from || '',
      to: r.to || '',
      notes: r.notes || [],
      error: r.error || '',
    })),
    text: formatFix(result, opts.mode, opts.write),
  }
}

export function apply(ctx, config) {
  const cfg = config || {}
  const logger = ctx.logger ? ctx.logger('batch-doctor') : console

  if (ctx.tools?.register) {
    const dispose = ctx.tools.register({
      name: 'batch_doctor',
      description:
        '体检/修复 Windows 脚本（.bat/.cmd/.ps1）的编码问题：中文批处理 UTF-8 串行、ps1 缺 BOM、chcp 与编码不匹配、LF 行尾、块内 echo 裸括号、写死老路径。action=lint 只报告；action=fix 会按 mode 转码并统一 CRLF，只有 write=true 才写盘，写前留 .bak。只动指定目录里的脚本，不联网、不删文件。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['lint', 'fix'], description: 'lint=只体检；fix=修复（配合 write）' },
          dir: { type: 'string', description: '目录，默认当前工作目录' },
          mode: { type: 'string', enum: ['gbk', 'utf8'], description: 'fix 目标编码，默认跟随插件配置（gbk）' },
          write: { type: 'boolean', description: 'fix 时是否真的写盘；默认 false=预演' },
          backup: { type: 'boolean', description: '写盘前是否留 .bak，默认 true' },
          stalePaths: { type: 'array', items: { type: 'string' }, description: '要留意写死路径的正则' },
          maxFiles: { type: 'integer', description: '最多扫描多少个脚本，默认 1000' },
          extensions: { type: 'array', items: { type: 'string' }, description: '扩展名，默认 .bat/.cmd/.ps1' },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            action: { type: 'string' },
            dir: { type: 'string' },
            scanned: { type: 'integer' },
            errors: { type: 'integer' },
            warnings: { type: 'integer' },
            changed: { type: 'integer' },
            written: { type: 'integer' },
            text: { type: 'string' },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string' },
                  encoding: { type: 'string' },
                  changed: { type: 'boolean' },
                  written: { type: 'boolean' },
                  from: { type: 'string' },
                  to: { type: 'string' },
                  error: { type: 'string' },
                  notes: { type: 'array', items: { type: 'string' } },
                  issues: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        level: { type: 'string' },
                        code: { type: 'string' },
                        message: { type: 'string' },
                      },
                    },
                  },
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
            action: String(args?.action || 'lint'),
            dir: String(args?.dir || process.cwd()),
            scanned: 0,
            errors: 0,
            warnings: 0,
            changed: 0,
            written: 0,
            files: [],
            text: `脚本体检失败：${e.message}`,
          }
        }
      },
    })
    ctx.effect(() => dispose, 'batch-doctor.tools()')
  }

  if (ctx.command) {
    ctx.command?.('batchdoctor.lint [dir]', '体检 bat/cmd/ps1 编码与行尾', async (dir) => {
      try {
        return formatLint(lintDir(String(dir || '').trim() || process.cwd(), normalizeOptions({}, cfg)))
      } catch (e) {
        return `脚本体检失败：${e.message}`
      }
    })
    ctx.command?.('batchdoctor.fix [dir]', '修复脚本编码（按配置的 mode，写前备份）', async (dir) => {
      try {
        const opts = normalizeOptions({}, cfg)
        opts.write = true
        const result = fixDir(String(dir || '').trim() || process.cwd(), opts)
        return formatFix(result, opts.mode, true)
      } catch (e) {
        return `脚本修复失败：${e.message}`
      }
    })
  }

  try {
    logger.log(`[batch-doctor] 平台 ${IS_WIN ? 'Windows' : process.platform} · 默认 ${cfg.mode || 'gbk'} · 扫描上限 ${cfg.maxFiles || 1000}`)
  } catch {}
}

export { lintDir, fixDir }
export const _internal = { formatLint, formatFix, run, normalizeOptions }
