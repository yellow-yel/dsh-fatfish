/**
 * bat/cmd/ps1 体检与修复。
 *
 * 为什么管编码：cmd.exe 在 chcp 65001 下读 UTF-8 批处理会按字符数而不是
 * 字节数定位下一行，中文一多就串行（报 'xx' is not recognized）。所以
 * 中文批处理用 GBK + chcp 936 最稳；带中文的 ps1 用 UTF-8 BOM，PowerShell
 * 5.1 才不会按 ANSI 读。
 *
 * 边界：只动指定目录里的 .bat/.cmd/.ps1；写前 .bak；不联网、不删文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const IS_WIN = process.platform === 'win32'

export const DEFAULT_EXTENSIONS = ['.bat', '.cmd', '.ps1']

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.venv', 'venv',
  '__pycache__', 'runtime', '运行时', 'AppData', 'Windows', 'WinSxS',
  '$RECYCLE.BIN', 'System Volume Information', '.next', '.cache', '.turbo',
])

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const hasWide = (text) => /[^\x00-\x7F]/.test(text)

export function decodeBuffer(buf) {
  if (!buf || buf.length === 0) return { text: '', encoding: 'empty', bom: false }
  if (buf.includes(0)) return { text: '', encoding: 'binary', bom: false }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    try {
      return {
        text: new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(3)),
        encoding: 'utf8',
        bom: true,
      }
    } catch {
      return { text: '', encoding: 'binary', bom: true }
    }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return { text, encoding: hasWide(text) ? 'utf8' : 'ascii', bom: false }
  } catch {
    /* 不是 UTF-8，试 GBK */
  }
  try {
    return { text: new TextDecoder('gbk', { fatal: true }).decode(buf), encoding: 'gbk', bom: false }
  } catch {
    return { text: '', encoding: 'binary', bom: false }
  }
}

export function encodeGbk(text) {
  if (!IS_WIN) {
    throw new Error('当前系统没有 PowerShell，无法写 GBK；请改用 utf8 模式，或在 Windows 上运行')
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-doctor-'))
  const src = path.join(dir, 'in.txt')
  const dst = path.join(dir, 'out.bin')
  fs.writeFileSync(src, text, 'utf8')
  try {
    const script = [
      '$ErrorActionPreference="Stop"',
      '$t=[IO.File]::ReadAllText($env:BD_SRC,[Text.Encoding]::UTF8)',
      '[IO.File]::WriteAllText($env:BD_DST,$t,[Text.Encoding]::GetEncoding(936))',
    ].join(';')
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
    ], {
      env: { ...process.env, BD_SRC: src, BD_DST: dst },
      windowsHide: true,
      timeout: 20000,
      stdio: 'pipe',
    })
    const out = fs.readFileSync(dst)
    const round = new TextDecoder('gbk', { fatal: true }).decode(out)
    if (round !== text) {
      const at = [...text].findIndex((ch, i) => round[i] !== ch)
      throw new Error(`GBK 编码不下（第 ${at + 1} 个字符附近有 GBK 之外的字符）`)
    }
    return out
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function lineEndings(text) {
  const crlf = (text.match(/\r\n/g) || []).length
  const lf = (text.match(/\n/g) || []).length - crlf
  return { crlf, lf, mixed: crlf > 0 && lf > 0 }
}

function chcpOf(text) {
  const match = text.match(/^[ \t]*chcp[ \t]+(\d+)/mi)
  return match ? Number(match[1]) : null
}

function staleHits(text, patterns) {
  const hits = []
  for (const raw of patterns || []) {
    if (!raw) continue
    let re
    try {
      re = new RegExp(String(raw), 'i')
    } catch {
      re = new RegExp(String(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      if (re.test(lines[i])) {
        hits.push({ line: i + 1, text: lines[i].trim().slice(0, 90) })
        break
      }
    }
  }
  return hits
}

/**
 * 近似判断块内 echo 的裸括号：只把以 "(" 结尾的行当作块开始，
 * 以 ")" 开头的行当作块结束，避免把 if (...) 全算进去。
 */
function nakedParenLine(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (depth > 0 && /^\s*@?echo\b/i.test(line)) {
      const bare = line.replace(/\^[()]/g, '')
      if (bare.includes('(') || bare.includes(')')) return i + 1
    }
    if (/^\s*\)/.test(line)) depth = Math.max(0, depth - 1)
    const code = line.replace(/\s+$/, '')
    if (/(^|[^\\])\($/.test(code)) depth++
  }
  return 0
}

export function analyzeBuffer(file, buf, opts = {}) {
  const ext = path.extname(file).toLowerCase()
  const rel = opts.rel || file
  const decoded = decodeBuffer(buf)
  const issues = []
  if (decoded.encoding === 'binary') {
    issues.push({ level: 'error', code: 'binary', message: '不是文本或含 NUL 字节，跳过' })
    return { file, rel, kind: ext.slice(1), encoding: decoded.encoding, bom: decoded.bom, chcp: null, issues }
  }
  if (decoded.encoding === 'empty') {
    return { file, rel, kind: ext.slice(1), encoding: 'empty', bom: false, chcp: null, issues }
  }
  const text = decoded.text
  const chcp = chcpOf(text)
  const wide = hasWide(text)
  const ends = lineEndings(text)

  if (ext === '.bat' || ext === '.cmd') {
    if (decoded.bom) {
      issues.push({ level: 'error', code: 'bat-bom', message: '批处理带 UTF-8 BOM，cmd 会把 BOM 当成命令字符' })
    }
    if (decoded.encoding === 'utf8' && wide) {
      issues.push({ level: 'error', code: 'bat-utf8', message: '中文批处理是 UTF-8，cmd 可能吃字符（建议转 GBK）' })
    }
    if (decoded.encoding === 'gbk' && chcp === 65001) {
      issues.push({ level: 'error', code: 'chcp-mismatch', message: '文件是 GBK 但 chcp 是 65001，中文会乱码' })
    }
    if (decoded.encoding === 'utf8' && chcp === 936) {
      issues.push({ level: 'error', code: 'chcp-mismatch', message: '文件是 UTF-8 但 chcp 是 936，中文会乱码' })
    }
    if (wide && chcp === null) {
      issues.push({ level: 'warning', code: 'missing-chcp', message: '有中文但没有设置 chcp，换控制台代码页可能乱码' })
    }
    if (ends.lf > 0) {
      issues.push({ level: 'warning', code: 'line-endings', message: `有 ${ends.lf} 处 LF 行尾（批处理建议纯 CRLF）` })
    }
    const parenLine = nakedParenLine(text)
    if (parenLine) {
      issues.push({ level: 'warning', code: 'naked-paren', message: `第 ${parenLine} 行块内 echo 有裸括号，可能提前闭合块` })
    }
  } else if (ext === '.ps1') {
    if (wide && decoded.encoding === 'utf8' && !decoded.bom) {
      issues.push({ level: 'warning', code: 'ps1-bom', message: '中文 UTF-8 没有 BOM，PowerShell 5.1 可能按 ANSI 读成乱码' })
    }
    if (decoded.encoding === 'gbk') {
      issues.push({ level: 'info', code: 'ps1-gbk', message: 'ps1 是 GBK 编码，PowerShell 7 可能读不了；建议 UTF-8 BOM' })
    }
  }

  for (const hit of staleHits(text, opts.stalePaths)) {
    issues.push({
      level: 'warning',
      code: 'stale-path',
      message: `第 ${hit.line} 行像是写死的老路径：${hit.text}`,
    })
  }

  return {
    file,
    rel,
    kind: ext.slice(1),
    encoding: decoded.encoding,
    bom: decoded.bom,
    chcp,
    lines: text.split('\n').length,
    issues,
  }
}

function walk(root, opts = {}) {
  const extensions = new Set((opts.extensions || DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()))
  const skip = new Set([...SKIP_DIRS, ...(opts.skipDirs || [])])
  const exclude = (opts.exclude || []).map(String)
  const maxFiles = Number.isInteger(opts.maxFiles) ? opts.maxFiles : 1000
  const out = []
  const queue = [root]
  let head = 0
  while (head < queue.length && out.length < maxFiles) {
    const dir = queue[head++]
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue
        if (entry.name.startsWith('.') && dir !== root) continue
        queue.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!extensions.has(path.extname(entry.name).toLowerCase())) continue
      const rel = path.relative(root, full)
      if (exclude.some((part) => rel.includes(part))) continue
      out.push(full)
      if (out.length >= maxFiles) break
    }
  }
  return out
}

export function lintDir(dir, opts = {}) {
  const root = path.resolve(dir || process.cwd())
  const files = walk(root, opts)
  const reports = []
  let errors = 0
  let warnings = 0
  for (const file of files) {
    let buf
    try {
      buf = fs.readFileSync(file)
    } catch {
      continue
    }
    const report = analyzeBuffer(file, buf, {
      ...opts,
      rel: path.relative(root, file) || path.basename(file),
    })
    for (const issue of report.issues) {
      if (issue.level === 'error') errors++
      else if (issue.level === 'warning') warnings++
    }
    if (report.issues.length) reports.push(report)
  }
  return { root, scanned: files.length, errors, warnings, files: reports }
}

function writeAtomic(file, data, backup) {
  if (backup && fs.existsSync(file)) fs.copyFileSync(file, file + '.bak')
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function fixFile(file, opts = {}) {
  const mode = opts.mode === 'utf8' ? 'utf8' : 'gbk'
  const ext = path.extname(file).toLowerCase()
  const buf = fs.readFileSync(file)
  const decoded = decodeBuffer(buf)
  if (decoded.encoding === 'binary' || decoded.encoding === 'empty') {
    return { file, changed: false, skipped: decoded.encoding === 'empty' ? 'empty' : 'binary', notes: [] }
  }
  let out = buf
  const notes = []

  if (ext === '.bat' || ext === '.cmd') {
    let text = decoded.text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
    if (text !== decoded.text) notes.push('CRLF')
    const want = mode === 'gbk' ? 936 : 65001
    let chcpChanged = false
    text = text.replace(/^([ \t]*chcp[ \t]+)(\d+)([^\r\n]*)$/mi, (whole, head, num, tail) => {
      if (Number(num) === want) return whole
      chcpChanged = true
      const suffix = want === 936 ? ' >nul 2>nul' : ' >nul'
      return head + want + suffix
    })
    if (chcpChanged) notes.push('chcp ' + want)
    if (mode === 'gbk') out = encodeGbk(text)
    else out = Buffer.from(text.replace(/^\uFEFF/, ''), 'utf8')
  } else if (ext === '.ps1') {
    if (decoded.encoding === 'utf8') {
      if (hasWide(decoded.text) && !decoded.bom) {
        out = Buffer.concat([UTF8_BOM, buf])
        notes.push('UTF-8 BOM')
      }
    } else if (decoded.encoding === 'gbk' && mode === 'utf8') {
      out = Buffer.concat([UTF8_BOM, Buffer.from(decoded.text, 'utf8')])
      notes.push('GBK -> UTF-8 BOM')
    }
  }

  const changed = !out.equals(buf)
  if (changed && opts.write === true) writeAtomic(file, out, opts.backup !== false)
  return {
    file,
    changed,
    written: changed && opts.write === true,
    from: decoded.encoding + (decoded.bom ? '-bom' : ''),
    to: ext === '.ps1' ? (out[0] === 0xef ? 'utf8-bom' : decoded.encoding) : mode,
    notes,
  }
}

export function fixDir(dir, opts = {}) {
  const lint = lintDir(dir, opts)
  const results = []
  let changed = 0
  let written = 0
  for (const file of walk(path.resolve(dir || process.cwd()), opts)) {
    try {
      const result = fixFile(file, opts)
      if (result.changed) {
        changed++
        if (result.written) written++
        results.push(result)
      }
    } catch (e) {
      results.push({ file, changed: false, error: e.message, notes: [] })
    }
  }
  return {
    root: lint.root,
    scanned: lint.scanned,
    before: { errors: lint.errors, warnings: lint.warnings },
    changed,
    written,
    results,
  }
}

export const _internal = { walk, lineEndings, chcpOf, nakedParenLine, hasWide, UTF8_BOM, SKIP_DIRS }
