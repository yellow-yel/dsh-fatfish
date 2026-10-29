/**
 * 大肥鱼安全检查 · 本地轻量查杀
 *
 * 查三类东西：可疑进程、开机启动项、指定目录里的可执行文件。
 * 只读：不删文件、不杀进程、不改注册表；扫描结果只留在本机。
 * 病毒库：内置规则 + 可选的 HTTPS 订阅（security.feedUrl），原子写入缓存。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { BUILTIN_SIGNATURES } from './signatures.js'
import { dataDir } from './memory.js'

const execFileAsync = promisify(execFile)

const FEED_MAX_BYTES = 2 * 1024 * 1024
const FILE_MAX_BYTES = 64 * 1024 * 1024
const HASH_BUDGET_BYTES = 256 * 1024 * 1024
const FILE_EXTS = new Set([
  '.exe', '.dll', '.scr', '.com', '.bat', '.cmd', '.ps1', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.hta', '.msi', '.jar',
])

export function securityDir() {
  return path.join(dataDir(), 'security')
}

export function signaturesFile() {
  return path.join(securityDir(), 'signatures.json')
}

function stateFile() {
  return path.join(securityDir(), 'state.json')
}

function ensureDir() {
  fs.mkdirSync(securityDir(), { recursive: true })
}

function atomicWrite(file, text) {
  ensureDir()
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

function str(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
}

function normalizeDb(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('病毒库格式不对')
  const processes = []
  const commandPatterns = []
  const fileNames = []
  const hashes = []
  const seenP = new Set()
  const seenC = new Set()
  const seenF = new Set()
  const seenH = new Set()

  for (const item of Array.isArray(raw.processes) ? raw.processes : []) {
    const name = str(typeof item === 'string' ? item : item?.name, 80).toLowerCase().replace(/\.exe$/, '')
    if (!name || seenP.has(name)) continue
    seenP.add(name)
    processes.push({ name, why: str(item?.why, 160) || '已知恶意进程' })
    if (processes.length >= 5000) break
  }
  for (const item of Array.isArray(raw.commandPatterns) ? raw.commandPatterns : []) {
    const contains = str(typeof item === 'string' ? item : item?.contains, 160).toLowerCase()
    if (contains.length < 4 || seenC.has(contains)) continue
    seenC.add(contains)
    commandPatterns.push({ contains, why: str(item?.why, 160) || `命令行包含 ${contains}` })
    if (commandPatterns.length >= 2000) break
  }
  for (const item of Array.isArray(raw.fileNames) ? raw.fileNames : []) {
    const name = str(typeof item === 'string' ? item : item?.name, 120).toLowerCase()
    if (!name || seenF.has(name)) continue
    seenF.add(name)
    fileNames.push({ name, why: str(item?.why, 160) || '已知恶意文件名' })
    if (fileNames.length >= 5000) break
  }
  for (const item of Array.isArray(raw.hashes) ? raw.hashes : []) {
    const sha256 = str(item?.sha256, 64).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sha256) || seenH.has(sha256)) continue
    seenH.add(sha256)
    hashes.push({ sha256, name: str(item?.name, 80) || '未知样本', why: str(item?.why, 160) || '命中已知恶意文件哈希' })
    if (hashes.length >= 50000) break
  }

  if (!processes.length && !commandPatterns.length && !fileNames.length && !hashes.length) {
    throw new Error('病毒库是空的')
  }

  return {
    version: str(raw.version, 40) || 'custom',
    updatedAt: str(raw.updatedAt, 40) || new Date().toISOString(),
    source: str(raw.source, 120) || 'custom',
    processes,
    commandPatterns,
    fileNames,
    hashes,
  }
}

function counts(db) {
  return {
    processes: db.processes.length,
    commandPatterns: db.commandPatterns.length,
    fileNames: db.fileNames.length,
    hashes: db.hashes.length,
  }
}

function mergeDb(builtin, cached) {
  const merge = (a, b, key) => {
    const m = new Map()
    for (const x of a) m.set(String(x[key]).toLowerCase(), x)
    for (const x of b) m.set(String(x[key]).toLowerCase(), x)
    return [...m.values()]
  }
  return {
    version: cached.version,
    updatedAt: cached.updatedAt,
    source: 'builtin+feed',
    processes: merge(builtin.processes, cached.processes, 'name'),
    commandPatterns: merge(builtin.commandPatterns, cached.commandPatterns, 'contains'),
    fileNames: merge(builtin.fileNames, cached.fileNames, 'name'),
    hashes: merge(builtin.hashes, cached.hashes, 'sha256'),
  }
}

function withMaps(db, builtinVersion, cacheError = '') {
  return {
    ...db,
    builtinVersion,
    cacheError,
    counts: counts(db),
    processMap: new Map(db.processes.map((x) => [x.name, x.why])),
    fileNameMap: new Map(db.fileNames.map((x) => [x.name, x.why])),
    hashMap: new Map(db.hashes.map((x) => [x.sha256, x])),
  }
}

export function loadDb() {
  const builtin = normalizeDb(BUILTIN_SIGNATURES)
  let cached = null
  let cacheError = ''
  try {
    if (fs.existsSync(signaturesFile())) {
      cached = normalizeDb(JSON.parse(fs.readFileSync(signaturesFile(), 'utf8')))
    }
  } catch (e) {
    cacheError = `在线库读取失败，先用内置库：${e.message}`
  }
  if (!cached) return withMaps(builtin, builtin.version, cacheError)
  return withMaps(mergeDb(builtin, cached), builtin.version, cacheError)
}

export function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

function patchState(patch) {
  const next = { ...loadState(), ...patch }
  atomicWrite(stateFile(), JSON.stringify(next, null, 2))
  return next
}

function displayUrl(value) {
  const s = str(value, 300)
  if (!s) return ''
  try {
    const u = new URL(s)
    return `${u.origin}${u.pathname}`.slice(0, 160)
  } catch {
    return s.slice(0, 160)
  }
}

export function securityStatus({ feedUrl = '' } = {}) {
  const db = loadDb()
  const state = loadState()
  return {
    ok: true,
    db: {
      version: db.version,
      builtinVersion: db.builtinVersion,
      source: db.source,
      updatedAt: db.updatedAt,
      counts: db.counts,
      cacheError: db.cacheError,
    },
    feed: { url: displayUrl(feedUrl), configured: Boolean(feedUrl) },
    lastUpdate: state.lastUpdate || null,
    lastScan: state.lastScan || null,
    dataDir: securityDir(),
  }
}

export async function updateSignatures(url, { timeoutMs = 15000 } = {}) {
  const target = str(url, 500)
  if (!/^https:\/\//i.test(target)) throw new Error('病毒库地址必须是 https:// 开头')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(3000, Math.min(60000, Number(timeoutMs) || 15000)))
  let res
  try {
    res = await fetch(target, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'dsh-fatfish/0.5', accept: 'application/json' },
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  let finalUrl
  try {
    finalUrl = new URL(res.url || target)
  } catch {
    throw new Error('病毒库地址不合法')
  }
  if (finalUrl.protocol !== 'https:') throw new Error('病毒库跳转到了非 https 地址')
  const len = Number(res.headers.get('content-length') || 0)
  if (len > FEED_MAX_BYTES) throw new Error('病毒库文件太大')
  const body = await res.text()
  if (body.length > FEED_MAX_BYTES) throw new Error('病毒库文件太大')
  let raw
  try {
    raw = JSON.parse(body)
  } catch {
    throw new Error('病毒库不是合法 JSON')
  }
  const db = normalizeDb(raw)
  const fetchedAt = new Date().toISOString()
  const payload = {
    version: db.version === 'custom' ? fetchedAt.slice(0, 10) : db.version,
    updatedAt: db.updatedAt,
    source: `feed:${finalUrl.host}`,
    fetchedAt,
    processes: db.processes,
    commandPatterns: db.commandPatterns,
    fileNames: db.fileNames,
    hashes: db.hashes,
  }
  atomicWrite(signaturesFile(), JSON.stringify(payload, null, 2))
  const summary = { at: fetchedAt, version: payload.version, counts: counts(db), source: payload.source }
  patchState({ lastUpdate: summary })
  return { ok: true, ...summary }
}

function powershellPath() {
  const root = process.env.SystemRoot || process.env.WINDIR
  if (root) {
    const p = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (fs.existsSync(p)) return p
  }
  return 'powershell.exe'
}

async function runPowerShell(script, timeout = 30000) {
  const { stdout } = await execFileAsync(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  return String(stdout || '').trim()
}

function parseList(text) {
  if (!text) return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function listProcesses() {
  if (process.platform === 'win32') {
    // CIM 能给命令行，但部分系统上 CimCmdlets 模块不可用；失败就退回 Get-Process。
    try {
      const text = await runPowerShell(
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
      )
      return parseList(text).map((p) => ({
        pid: Number(p.ProcessId) || 0,
        name: str(p.Name, 120),
        path: str(p.ExecutablePath, 500),
        commandLine: str(p.CommandLine, 2000),
      }))
    } catch {
      /* 走下面的轻量枚举 */
    }
    try {
      const text = await runPowerShell(
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $out=@(); Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $p=""; try { $p=$_.Path } catch {}; $out += [pscustomobject]@{ Id=$_.Id; ProcessName=$_.ProcessName; Path=$p } }; ConvertTo-Json -InputObject @($out) -Compress',
      )
      return parseList(text).map((p) => ({
        pid: Number(p.Id) || 0,
        name: str(`${p.ProcessName}.exe`, 120),
        path: str(p.Path, 500),
        commandLine: '',
      }))
    } catch {
      /* 最后用 tasklist 兜底 */
    }
    const { stdout } = await execFileAsync('tasklist', ['/fo', 'csv', '/nh'], {
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
    return String(stdout || '').split(/\r?\n/).map((line) => {
      const m = line.match(/^"([^"]*)","(\d+)"/)
      return m ? { pid: Number(m[2]), name: m[1], path: '', commandLine: '' } : null
    }).filter(Boolean)
  }
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,comm=,args='], {
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return String(stdout || '').split(/\r?\n/).map((line) => {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/)
    return m ? { pid: Number(m[1]), name: m[2], path: '', commandLine: m[3] } : null
  }).filter(Boolean)
}

async function listStartup() {
  if (process.platform !== 'win32') {
    return { entries: [], warning: '启动项检查目前只支持 Windows' }
  }
  const script = [
    "$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',",
    "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',",
    "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',",
    "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',",
    "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run');",
    '$out=@(); foreach($k in $keys){ if(Test-Path $k){ $p=Get-ItemProperty -Path $k;',
    "foreach($n in $p.PSObject.Properties){ if($n.Name -notlike 'PS*'){",
    '$out += [pscustomobject]@{key=$k;name=$n.Name;value=[string]$n.Value} } } } };',
    'ConvertTo-Json -InputObject @($out) -Compress',
  ].join('')
  const { stdout } = await execFileAsync(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  const text = String(stdout || '').trim()
  if (!text) return { entries: [] }
  const parsed = JSON.parse(text)
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return {
    entries: list.map((x) => ({ key: str(x.key, 200), name: str(x.name, 120), value: str(x.value, 1000) })),
  }
}

function redactPath(value) {
  let s = str(value, 500)
  const home = os.homedir()
  if (home && s.toLowerCase().startsWith(home.toLowerCase())) s = `~${s.slice(home.length)}`
  return s
}

function redactLine(value) {
  return str(value, 400).replace(/\b[A-Za-z0-9_\-]{28,}\b/g, (m) => `${m.slice(0, 6)}***`)
}

function processFinding(db, proc) {
  const reasons = []
  let high = false
  const base = str(proc.name, 200).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '')
  const nameHit = db.processMap.get(base)
  if (nameHit) reasons.push(nameHit)
  const cmd = String(proc.commandLine || '').toLowerCase()
  for (const rule of db.commandPatterns) {
    if (cmd.includes(rule.contains)) {
      reasons.push(rule.why)
      high = true
    }
  }
  if (!reasons.length) return null
  return {
    severity: high ? 'high' : 'medium',
    kind: 'process',
    name: proc.name || `PID ${proc.pid}`,
    pid: proc.pid,
    detail: redactPath(proc.path),
    why: [...new Set(reasons)].join('；'),
    advice: '先确认是不是你自己运行的工具；需要结束请在任务管理器手动操作，插件不会杀进程。',
  }
}

function startupFinding(db, entry) {
  const haystack = `${entry.name} ${entry.value}`.toLowerCase()
  const reasons = []
  let hit = false
  for (const rule of db.commandPatterns) {
    if (haystack.includes(rule.contains)) {
      reasons.push(rule.why)
      hit = true
    }
  }
  for (const [name, why] of db.processMap) {
    if (haystack.includes(`${name}.exe`)) {
      reasons.push(why)
      hit = true
    }
  }
  if (!hit) return null
  return {
    severity: 'high',
    kind: 'startup',
    name: entry.name || '(未命名启动项)',
    detail: redactLine(entry.value),
    why: [...new Set(reasons)].join('；'),
    advice: '在任务管理器 →「启动」里手动禁用；插件不会改注册表。',
  }
}

function fileRoots(scope, target) {
  if (scope === 'path') {
    if (!target) throw new Error('scope=path 时请给 path')
    if (!fs.existsSync(target)) throw new Error('路径不存在')
    return [path.resolve(target)]
  }
  const home = os.homedir()
  return [path.join(home, 'Downloads'), path.join(home, 'Desktop'), os.tmpdir()]
    .filter((p) => {
      try {
        return fs.statSync(p).isDirectory()
      } catch {
        return false
      }
    })
}

async function collectFiles(root, { depth, maxFiles }) {
  const out = []
  const queue = [[root, 0]]
  let truncated = false
  while (queue.length) {
    const [current, level] = queue.shift()
    let entries
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) {
        truncated = true
        break
      }
      if (ent.isSymbolicLink()) continue
      const full = path.join(current, ent.name)
      if (ent.isDirectory()) {
        if (level < depth) queue.push([full, level + 1])
        continue
      }
      if (!ent.isFile()) continue
      if (!FILE_EXTS.has(path.extname(ent.name).toLowerCase())) continue
      out.push(full)
    }
    if (out.length >= maxFiles) break
  }
  return { files: out, truncated }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const rs = fs.createReadStream(file)
    rs.on('error', reject)
    rs.on('data', (chunk) => hash.update(chunk))
    rs.on('end', () => resolve(hash.digest('hex')))
  })
}

async function scanFiles(db, roots, { maxFiles, maxDepth }) {
  const findings = []
  const warnings = []
  let files = []
  let truncated = false
  for (const root of roots) {
    let stat
    try {
      stat = fs.statSync(root)
    } catch {
      continue
    }
    if (stat.isFile()) {
      files.push(root)
      continue
    }
    const r = await collectFiles(root, { depth: maxDepth, maxFiles: maxFiles - files.length })
    files.push(...r.files)
    truncated = truncated || r.truncated
    if (files.length >= maxFiles) break
  }

  let hashed = 0
  let hashBytes = 0
  let hashStopped = false
  const seen = new Set()

  for (const file of files) {
    if (seen.has(file)) continue
    seen.add(file)
    const base = path.basename(file).toLowerCase()
    const nameWhy = db.fileNameMap.get(base)
    let severity = 'medium'
    const reasons = []
    if (nameWhy) reasons.push(nameWhy)

    if (!hashStopped && db.hashMap.size) {
      let size = 0
      try {
        size = fs.statSync(file).size
      } catch {
        continue
      }
      if (size > FILE_MAX_BYTES) {
        // 超大文件只做文件名匹配，不计算哈希
      } else if (hashBytes + size > HASH_BUDGET_BYTES) {
        hashStopped = true
      } else {
        try {
          const digest = await sha256File(file)
          hashBytes += size
          hashed++
          const hit = db.hashMap.get(digest)
          if (hit) {
            reasons.push(hit.why)
            severity = 'high'
          }
        } catch (e) {
          warnings.push(`读不了 ${redactPath(file)}：${e.message}`)
        }
      }
    }

    if (!reasons.length) continue
    findings.push({
      severity,
      kind: 'file',
      name: path.basename(file),
      detail: redactPath(file),
      why: [...new Set(reasons)].join('；'),
      advice: '先别双击运行；确认没用后手动删除。插件不会自动删文件。',
    })
  }
  return { findings, warnings, files: files.length, hashed, truncated, hashStopped }
}

export async function scan({ scope = 'quick', target = '', maxFiles = 200 } = {}) {
  const s = ['process', 'startup', 'quick', 'path'].includes(scope) ? scope : 'quick'
  const started = Date.now()
  const db = loadDb()
  const findings = []
  const warnings = []
  const scanned = { processes: 0, startup: 0, files: 0, hashed: 0 }
  let truncated = false

  if (s === 'process' || s === 'quick') {
    try {
      const list = await listProcesses()
      scanned.processes = list.length
      for (const proc of list) {
        const f = processFinding(db, proc)
        if (f) findings.push(f)
      }
    } catch (e) {
      warnings.push(`进程检查失败：${e.message}`)
    }
  }

  if (s === 'startup' || s === 'quick') {
    try {
      const r = await listStartup()
      if (r.warning) warnings.push(r.warning)
      scanned.startup = r.entries.length
      for (const entry of r.entries) {
        const f = startupFinding(db, entry)
        if (f) findings.push(f)
      }
    } catch (e) {
      warnings.push(`启动项检查失败：${e.message}`)
    }
  }

  if (s === 'path' || s === 'quick') {
    try {
      const roots = fileRoots(s, target)
      const limit = Math.max(20, Math.min(2000, Number(maxFiles) || 200))
      const r = await scanFiles(db, roots, { maxFiles: limit, maxDepth: s === 'path' ? 3 : 1 })
      findings.push(...r.findings)
      warnings.push(...r.warnings)
      scanned.files = r.files
      scanned.hashed = r.hashed
      truncated = r.truncated || r.hashStopped
    } catch (e) {
      warnings.push(`文件检查失败：${e.message}`)
    }
  }

  const verdict = findings.length ? 'attention' : 'clean'
  const summary = {
    at: new Date().toISOString(),
    scope: s,
    verdict,
    findings: findings.length,
    scanned,
    dbVersion: db.version,
    elapsedMs: Date.now() - started,
  }
  patchState({ lastScan: summary })

  return {
    ok: true,
    ...summary,
    db: { version: db.version, source: db.source, counts: db.counts },
    findings,
    warnings: [...new Set(warnings)],
    truncated,
    disclaimer: '轻量本地检查，不是完整杀毒软件；只报告，不删文件、不杀进程。',
  }
}

export const _internal = { normalizeDb, mergeDb, counts, redactPath, redactLine, collectFiles, sha256File, displayUrl }
