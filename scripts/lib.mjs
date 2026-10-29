/**
 * 市场版脚本共用工具：找 node/npm、跑命令、读写 JSON、脱敏输出。
 * 只认相对路径，U 盘换盘符也能跑。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
export const bundleRoot = path.resolve(scriptsDir, '..')
export const config = readJson(path.join(bundleRoot, '上架配置.json'))

export const PLUGIN_DIRS = ['dsh-fatfish', 'dsh-fatfish-hands']

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** npm 偶尔会在 JSON 前后夹带 notice 行，按花括号配平截出主体 */
export function parseJsonLoose(text) {
  const start = String(text).search(/[[{]/)
  if (start < 0) throw new Error('输出里没有 JSON')
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return JSON.parse(text.slice(start, i + 1))
  }
  throw new Error('JSON 未闭合')
}

export function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export function pkgFor(dirName) {
  return readJson(path.join(bundleRoot, dirName, 'package.json'))
}

export function pluginPackages() {
  return PLUGIN_DIRS.map((dir) => {
    const pkg = pkgFor(dir)
    return { dir, name: pkg.name, version: pkg.version, pkg, dirPath: path.join(bundleRoot, dir) }
  })
}

/** 打包时要排除的内容：本机配置、凭据、测试与产物 */
export const PACK_EXCLUDES = ['config', 'test', '.env', '.npmrc', 'api-config.json', 'node_modules']

/**
 * DSH 本体自带的 node 和 pnpm——用它跑测试和安装，跟插件真正跑起来的宿主一致。
 * 两个来源：DSH 安装目录里的 primary-runtime，以及 ~/.dsh/dsh-runtimes 下的解压产物。
 */
export function dshRuntime() {
  const home = os.homedir()
  const appRoots = [
    path.join(home, 'AppData', 'Local', 'Programs', 'DSH NEXT'),
    path.join(home, 'AppData', 'Local', 'Programs', 'dsh-desktop-next'),
  ]
  const nodes = []
  for (const root of appRoots) {
    nodes.push(path.join(root, 'resources', 'runtime', 'x64', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'))
  }
  const runtimes = path.join(home, '.dsh', 'dsh-runtimes')
  if (fs.existsSync(runtimes)) {
    for (const name of fs.readdirSync(runtimes)) {
      nodes.push(path.join(runtimes, name, 'dependencies', 'node', 'bin', 'node.exe'))
    }
  }
  const node = nodes.find((f) => fs.existsSync(f))
  if (!node) return null
  const pnpm = path.join(path.dirname(path.dirname(node)), 'pnpm', 'bin', 'pnpm.mjs')
  return { node, pnpm: fs.existsSync(pnpm) ? pnpm : null, version: spawnSync(node, ['-v'], { encoding: 'utf8' }).stdout.trim() }
}

export function dshProfileDir(name = 'desktop') {
  return path.join(os.homedir(), '.dsh', 'profiles', name)
}

function candidatesForNpmCli() {
  const nodeDir = path.dirname(process.execPath)
  const up = path.resolve(nodeDir, '..')
  return [
    path.join(nodeDir, 'npm-cli.js'),
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(up, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(up, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(bundleRoot, '..', '工具', 'npm-cli', 'bin', 'npm-cli.js'),
  ]
}

/** 返回 { cli } 用 node 直接跑 npm-cli.js；或 { cmd } 走 PATH 上的 npm */
export function npmLauncher() {
  for (const cli of candidatesForNpmCli()) {
    if (fs.existsSync(cli)) return { cli }
  }
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['npm'], { encoding: 'utf8' })
  if (probe.status === 0) return { cmd: 'npm' }
  return null
}

function quoteForShell(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`
}

export function runNpm(args, opts = {}) {
  const launcher = npmLauncher()
  if (!launcher) return { code: 127, stdout: '', stderr: '找不到 npm（既没有 npm-cli.js，也不在 PATH 里）', missing: true }
  if (launcher.cli) {
    return run(process.execPath, [launcher.cli, ...args], opts)
  }
  const command = [launcher.cmd, ...args].map(quoteForShell).join(' ')
  return run(command, null, { ...opts, shell: true })
}

export function run(command, args, opts = {}) {
  const res = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: opts.cwd || bundleRoot,
    env: { ...process.env, ...(opts.env || {}) },
    shell: opts.shell || false,
    maxBuffer: opts.maxBuffer || 32 * 1024 * 1024,
  })
  const stdout = res.stdout || ''
  const stderr = res.stderr || ''
  return {
    code: res.status === null ? -1 : res.status,
    stdout,
    stderr,
    all: stdout + stderr,
    error: res.error ? String(res.error.message || res.error) : '',
    signal: res.signal,
  }
}

/** 所有 git 命令都带上 safe.directory，U 盘/移动硬盘不会报 dubious ownership */
export function runGit(args, opts = {}) {
  return run('git', ['-c', `safe.directory=${bundleRoot.replace(/\\/g, '/')}`, ...args], opts)
}

export function gitOutput(args) {
  const res = runGit(args)
  return res.code === 0 ? res.stdout.trim() : ''
}

export function redact(text, secrets) {
  let out = String(text || '')
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('***令牌***')
  }
  return out
}

/** 令牌优先环境变量，其次配置文件指向的本地文件；只用于本次命令，不写回任何地方 */
export function tokenFor(remoteName) {
  const envKeys = { origin: ['GITEE_TOKEN', 'FF_GIT_TOKEN'], github: ['GITHUB_TOKEN', 'FF_GIT_TOKEN'] }
  for (const key of envKeys[remoteName] || []) {
    if (process.env[key]) return { value: process.env[key].trim(), from: `环境变量 ${key}` }
  }
  const file = config.tokenFiles && config.tokenFiles[remoteName]
  if (file) {
    const full = path.resolve(bundleRoot, file)
    if (fs.existsSync(full)) {
      const value = fs.readFileSync(full, 'utf8').trim().split(/\r?\n/)[0].trim()
      if (value) return { value, from: path.relative(path.resolve(bundleRoot, '..'), full) }
    }
  }
  return null
}

export function urlWithToken(remoteUrl, token) {
  const secrets = (remoteUrl.match(/\/\/([^@/]*)@/) || [])[1]
  const clean = secrets ? remoteUrl.replace(`${secrets}@`, '') : remoteUrl
  const m = clean.match(/^(https:\/\/)([^/]+)(\/.*)$/)
  if (!m) return clean
  const owner = (clean.match(/^(?:https:\/\/[^/]+\/)([^/?#]+)\//) || [])[1] || 'oauth2'
  return `${m[1]}${owner}:${token}${m[3]}`
}

/** 仓库里的 README 用 tree/<branch> 链接，分支名跟着 上架配置.json 走 */
export function currentBranch() {
  const name = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'])
  return name && name !== 'HEAD' ? name : ''
}

export function nodeMajor() {
  return Number(process.versions.node.split('.')[0])
}

export function rel(target) {
  return path.relative(bundleRoot, target).replace(/\\/g, '/') || '.'
}
