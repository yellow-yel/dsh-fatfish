/**
 * 路径探测与配置自愈。
 *
 * 原则：
 * - 只读文件系统，不执行任何命令，不联网；
 * - 只写插件自己的 JSON 配置（默认 ~/.dsh/path-healer.json），写前留 .bak；
 * - 找不到就如实报 missing，不编造路径。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const IS_WIN = process.platform === 'win32'

const SKIP_DIRS = new Set([
  '$RECYCLE.BIN', 'System Volume Information', 'Windows', 'WinSxS',
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'ProgramData',
  'AppData', 'Temp', 'tmp', 'Cache', 'cache',
])

const MAX_DIRS_DEFAULT = 12000

function env(name) {
  return String(process.env[name] || '').trim()
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function childDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

function unique(list) {
  return [...new Set(list.filter(Boolean).map((p) => path.resolve(String(p))))]
}

export function defaultConfigFile() {
  const home = env('DSH_HOME') || path.join(os.homedir(), '.dsh')
  return path.join(home, 'path-healer.json')
}

export function defaultTargets() {
  const local = env('LOCALAPPDATA')
  const pf = env('ProgramFiles')
  const pf86 = env('ProgramFiles(x86)')
  const win = IS_WIN
  const pyDirs = unique([
    local && path.join(local, 'Programs', 'Python'),
    pf && path.join(pf, 'Python39'),
    pf && path.join(pf, 'Python310'),
    pf && path.join(pf, 'Python311'),
    pf && path.join(pf, 'Python312'),
    'C:\\Python39', 'C:\\Python310', 'C:\\Python311', 'C:\\Python312',
    ...(local ? childDirs(path.join(local, 'Programs', 'Python')) : []),
  ])
  return [
    {
      key: 'node',
      label: 'Node.js',
      marker: win ? 'node.exe' : 'node',
      depth: 6,
      dirs: unique([
        pf && path.join(pf, 'nodejs'),
        local && path.join(local, 'Programs', 'nodejs'),
        '/usr/local/bin', '/usr/bin', '/opt/homebrew/bin',
      ]),
    },
    {
      key: 'python',
      label: 'Python',
      marker: win ? 'python.exe' : 'python3',
      depth: 5,
      dirs: pyDirs,
    },
    {
      key: 'pythonw',
      label: 'Python (无窗口)',
      marker: win ? 'pythonw.exe' : 'python3',
      depth: 5,
      dirs: pyDirs,
    },
    {
      key: 'git',
      label: 'Git',
      marker: win ? 'git.exe' : 'git',
      depth: 4,
      dirs: unique([
        pf && path.join(pf, 'Git', 'cmd'),
        pf86 && path.join(pf86, 'Git', 'cmd'),
        pf && path.join(pf, 'Git', 'bin'),
        local && path.join(local, 'Programs', 'Git', 'cmd'),
        '/usr/bin', '/usr/local/bin',
      ]),
    },
    {
      key: 'edge',
      label: 'Microsoft Edge',
      marker: win ? 'msedge.exe' : 'microsoft-edge',
      depth: 4,
      dirs: unique([
        pf86 && path.join(pf86, 'Microsoft', 'Edge', 'Application'),
        pf && path.join(pf, 'Microsoft', 'Edge', 'Application'),
        '/usr/bin', '/opt/microsoft/msedge',
      ]),
    },
    {
      key: 'dsh',
      label: 'DSH NEXT',
      marker: win ? 'DSH NEXT.exe' : 'dsh',
      depth: 4,
      dirs: unique([
        pf && path.join(pf, 'DSH NEXT'),
        local && path.join(local, 'Programs', 'DSH NEXT'),
        '/usr/local/bin', '/usr/bin', '/opt/dsh',
      ]),
    },
    {
      key: 'napcat',
      label: 'NapCat',
      marker: 'NapCatWinBootMain.exe',
      depth: 4,
      dirs: unique([
        process.cwd(),
        path.join(process.cwd(), 'NapCat'),
        path.join(process.cwd(), 'napcat'),
      ]),
    },
  ]
}

export function dshNodeCandidates() {
  const home = env('DSH_HOME') || path.join(os.homedir(), '.dsh')
  const out = []
  for (const runtime of childDirs(path.join(home, 'dsh-runtimes'))) {
    out.push(path.join(runtime, 'dependencies', 'node', 'bin', 'node.exe'))
    out.push(path.join(runtime, 'dependencies', 'node', 'node.exe'))
    out.push(path.join(runtime, 'resources', 'runtime', 'x64', 'primary-runtime',
      'dependencies', 'node', 'bin', 'node.exe'))
  }
  return out.filter(fileExists)
}

export function fromPath(marker) {
  const raw = String(process.env.PATH || '')
  for (const dir of raw.split(path.delimiter)) {
    const clean = dir.replace(/^"(.*)"$/, '$1').trim()
    if (!clean) continue
    const hit = path.join(clean, marker)
    if (fileExists(hit)) return path.resolve(hit)
  }
  return ''
}

export function looksValid(target, value) {
  if (!value || typeof value !== 'string') return false
  const p = value.trim()
  if (!p) return false
  try {
    const st = fs.statSync(p)
    if (st.isDirectory()) return fileExists(path.join(p, target.marker))
    if (st.isFile()) {
      return path.basename(p).toLowerCase() === String(target.marker).toLowerCase()
    }
  } catch {
    return false
  }
  return false
}

function scanRoots() {
  if (!IS_WIN) return ['/']
  const roots = []
  for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    if (dirExists(letter + ':\\')) roots.push(letter + ':\\')
  }
  roots.push(os.homedir())
  return roots
}

/**
 * 浅层广度优先找 marker。默认跳过系统目录/依赖目录，最多看 maxDirs 个目录。
 * 只用于已知位置都没找到时的兜底，所以把上限压得比较低。
 */
export function scanForMarker(marker, opts = {}) {
  const maxDepth = Number.isInteger(opts.maxDepth) ? opts.maxDepth : 4
  const maxDirs = Number.isInteger(opts.maxDirs) ? opts.maxDirs : MAX_DIRS_DEFAULT
  const roots = opts.roots || scanRoots()
  const wanted = String(marker).toLowerCase()
  let visited = 0
  for (const root of roots) {
    const queue = [[root, 0]]
    let head = 0
    while (head < queue.length && visited < maxDirs) {
      const [dir, depth] = queue[head++]
      visited++
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === wanted) {
          return path.join(dir, entry.name)
        }
      }
      if (depth >= maxDepth) continue
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (SKIP_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.')) continue
        queue.push([path.join(dir, entry.name), depth + 1])
      }
    }
  }
  return ''
}

export function detectTarget(target, opts = {}) {
  const marker = String(target.marker || '').trim()
  if (!marker) return ''
  const viaPath = fromPath(marker)
  if (viaPath) return viaPath
  if (target.key === 'node') {
    const bundled = dshNodeCandidates()
    if (bundled.length) return path.resolve(bundled[0])
  }
  const dirs = unique([...(target.dirs || []), ...(opts.extraDirs || [])])
  for (const dir of dirs) {
    const hit = path.join(dir, marker)
    if (fileExists(hit)) return path.resolve(hit)
  }
  if (!opts.deep) return ''
  return scanForMarker(marker, {
    maxDepth: opts.maxDepth ?? target.depth ?? 4,
    maxDirs: opts.maxDirs,
  })
}

export function readConfig(file) {
  const empty = { raw: {}, nested: false, paths: {}, targets: [] }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return empty
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty
  const nested = !!(raw.paths && typeof raw.paths === 'object' && !Array.isArray(raw.paths))
  const paths = {}
  if (nested) {
    for (const [key, value] of Object.entries(raw.paths)) {
      if (typeof value === 'string' && value.trim()) paths[key] = value.trim()
    }
  } else {
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('_')) continue
      if (typeof value === 'string' && value.trim()) paths[key] = value.trim()
    }
  }
  const targets = Array.isArray(raw.targets)
    ? raw.targets.filter((t) => t && typeof t === 'object' && t.key && t.marker)
    : []
  return { raw, nested, paths, targets }
}

export function writeConfig(file, cfg, paths) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const meta = {
    tool: 'dsh-path-healer',
    host: env('COMPUTERNAME') || os.hostname(),
    updatedAt: new Date().toISOString(),
  }
  let body
  if (cfg.nested) {
    body = {
      ...cfg.raw,
      paths: { ...(cfg.raw.paths || {}), ...paths },
      _meta: meta,
    }
  } else {
    body = { ...cfg.raw, ...paths, _meta: meta }
  }
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) delete body[key]
  }
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n', 'utf8')
  let backup = ''
  if (fileExists(file)) {
    backup = file + '.bak'
    fs.copyFileSync(file, backup)
  }
  fs.renameSync(tmp, file)
  return backup
}

function mergeTargets(base, custom) {
  const all = base.map((t) => ({ ...t }))
  for (const item of custom || []) {
    if (!item || !item.key || !item.marker) continue
    const patch = {
      key: String(item.key),
      label: String(item.label || item.key),
      marker: String(item.marker),
      depth: Number.isInteger(item.depth) ? item.depth : 4,
      dirs: Array.isArray(item.dirs) ? item.dirs.map(String) : [],
    }
    const index = all.findIndex((t) => t.key === patch.key)
    if (index >= 0) all[index] = { ...all[index], ...patch }
    else all.push(patch)
  }
  return all
}

/**
 * 体检/修复。write=false 只检查，不落盘；deep=true 才扫盘兜底。
 */
export function heal(opts = {}) {
  const file = path.resolve(opts.configFile || defaultConfigFile())
  const cfg = readConfig(file)
  const targets = Array.isArray(opts.targets)
    ? mergeTargets([], opts.targets)
    : mergeTargets(defaultTargets(), cfg.targets)
  const paths = { ...cfg.paths }
  const entries = []
  let changed = false

  for (const target of targets) {
    const old = String(paths[target.key] || '')
    if (looksValid(target, old)) {
      entries.push({ key: target.key, label: target.label, status: 'ok', path: old, old })
      continue
    }
    const found = detectTarget(target, {
      deep: !!opts.deep,
      maxDepth: opts.maxDepth,
      extraDirs: target.dirs,
    })
    if (found) {
      paths[target.key] = found
      changed = true
      entries.push({
        key: target.key,
        label: target.label,
        status: old ? 'moved' : 'filled',
        path: found,
        old,
      })
    } else {
      entries.push({ key: target.key, label: target.label, status: 'missing', path: '', old })
    }
  }

  let backup = ''
  if (changed && opts.write !== false) backup = writeConfig(file, cfg, paths)
  return {
    ok: entries.every((e) => e.status !== 'missing'),
    changed,
    entries,
    configFile: file,
    backup,
    written: changed && opts.write !== false,
  }
}

export function getPath(key, opts = {}) {
  const result = heal({ ...opts, write: false })
  const entry = result.entries.find((e) => e.key === key)
  return entry && entry.path ? entry.path : ''
}

export const _internal = { fileExists, dirExists, childDirs, unique, mergeTargets, scanRoots, SKIP_DIRS }
