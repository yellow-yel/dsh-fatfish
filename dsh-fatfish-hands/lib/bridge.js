/**
 * dsh-fatfish-hands · 常驻 Edge 桥
 *
 * 工具调用和 tools/edge-cli.mjs --rpc 之间是「一行一个 JSON」的常驻通道：
 *   → {"id":1,"cmd":"click","args":{"index":3}}
 *   ← {"id":1,"ok":true,"data":{...}}
 *
 * 为什么不每次 spawn 一个进程：click 按 index 点的是「最近一次 read」里的编号，
 * 进程一换 lastRead 就丢了，模型点到的会是错的东西。
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NODE_BIN = process.platform === 'win32' ? 'node.exe' : 'node'

export class EdgeUnavailable extends Error {}

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** DSH 桌面端的 process.execPath 是 Electron 主程序，不能当 node 用。 */
export function findNode() {
  const cands = [process.env.DSH_NODE, process.env.FATFISH_NODE]
  const runtimes = path.join(dshHome(), 'dsh-runtimes')
  try {
    for (const d of fs.readdirSync(runtimes)) {
      if (!/runtime$/.test(d)) continue
      cands.push(path.join(runtimes, d, 'dependencies', 'node', 'bin', NODE_BIN))
      cands.push(path.join(runtimes, d, 'dependencies', 'node', NODE_BIN))
    }
  } catch {}
  if (process.platform === 'win32') {
    cands.push(path.join(process.env.ProgramFiles || '', 'nodejs', NODE_BIN))
    cands.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', NODE_BIN))
  }
  for (const p of cands) {
    try {
      if (p && fs.existsSync(p)) return p
    } catch {}
  }
  const probe = spawnSync('node', ['--version'], { timeout: 3000, windowsHide: true })
  if (probe.status === 0) return 'node'
  return ''
}

export function findCli() {
  const cands = [
    process.env.FATFISH_HANDS_CLI,
    path.join(HERE, '..', 'tools', 'edge-cli.mjs'),
    path.join(dshHome(), 'fatfish-hands', 'tools', 'edge-cli.mjs'),
  ]
  for (const profile of ['desktop', 'web']) {
    cands.push(path.join(dshHome(), 'profiles', profile, 'node_modules',
      'dsh-fatfish-hands', 'tools', 'edge-cli.mjs'))
  }
  for (const p of cands) {
    try {
      if (p && fs.existsSync(p)) return path.resolve(p)
    } catch {}
  }
  return ''
}

export class EdgeRpc {
  constructor() {
    this.node = ''
    this.cli = ''
    this.proc = null
    this.buffer = ''
    this.nextId = 0
    this.pending = new Map()
    this.stderr = []
  }

  _start() {
    this.node = findNode()
    this.cli = findCli()
    if (!this.node) {
      throw new EdgeUnavailable(
        '找不到可用的 node 运行时。装过 DSH 就会自带；也可以设 DSH_NODE 指向 node 的绝对路径。')
    }
    if (!this.cli) {
      throw new EdgeUnavailable(
        '找不到 tools/edge-cli.mjs。插件可能没装全，重装 dsh-fatfish-hands 再试。')
    }
    const proc = spawn(this.node, [this.cli, '--rpc'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    })
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => this._onData(chunk))
    proc.stderr.on('data', (chunk) => {
      this.stderr.push(String(chunk).trim())
      if (this.stderr.length > 20) this.stderr.shift()
    })
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null
      const err = new Error('Edge 桥接进程退出了。' + this._lastErr())
      for (const [, p] of this.pending) p.reject(err)
      this.pending.clear()
    })
    proc.on('error', (e) => {
      if (this.proc === proc) this.proc = null
      for (const [, p] of this.pending) p.reject(new Error('Edge 桥启动失败: ' + e.message))
      this.pending.clear()
    })
    this.proc = proc
    return proc
  }

  _lastErr() {
    const tail = this.stderr.filter(Boolean).slice(-3)
    return tail.length ? ' 细节: ' + tail.join(' | ') : ''
  }

  _onData(chunk) {
    this.buffer += chunk
    let at = this.buffer.indexOf('\n')
    while (at >= 0) {
      const line = this.buffer.slice(0, at).trim()
      this.buffer = this.buffer.slice(at + 1)
      if (line) this._onLine(line)
      at = this.buffer.indexOf('\n')
    }
  }

  _onLine(line) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.ok) p.resolve(msg.data ?? {})
    else p.reject(new Error(String(msg.error || 'Edge 操作失败')))
  }

  async call(cmd, args = {}, timeoutMs = 90000) {
    if (!this.proc || this.proc.exitCode !== null) this._start()
    const proc = this.proc
    if (!proc || proc.exitCode !== null) throw new EdgeUnavailable('Edge 桥没起来')
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Edge 操作超时（${cmd}）`))
      }, Math.max(5000, timeoutMs))
      this.pending.set(id, { resolve, reject, timer })
      try {
        proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
      } catch (e) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new Error('往 Edge 桥写命令失败: ' + e.message))
      }
    })
  }

  close() {
    const proc = this.proc
    this.proc = null
    if (!proc) return
    try {
      proc.stdin.end()
    } catch {}
    setTimeout(() => {
      try {
        if (proc.exitCode === null) proc.kill()
      } catch {}
    }, 1500).unref?.()
  }
}
