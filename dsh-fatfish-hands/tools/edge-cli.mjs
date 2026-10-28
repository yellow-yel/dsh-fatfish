#!/usr/bin/env node
/**
 * 大肥鱼之手 · Edge 命令行 / RPC 桥
 *
 * 一次性：
 *   node tools/edge-cli.mjs open '{"url":"https://www.bilibili.com"}'
 *   node tools/edge-cli.mjs read '{"links":true}'
 *   node tools/edge-cli.mjs shot '{"out":"C:\\tmp\\a.png"}'
 *
 * 常驻（给 Python / 别的程序用）：
 *   node tools/edge-cli.mjs --rpc
 *   stdin 每行 {"id":1,"cmd":"read","args":{...}}
 *   stdout 每行 {"id":1,"ok":true,"data":{...}}
 */
import readline from 'node:readline'
import { EdgeSession, loadConfig, edgeStatusSync } from '../lib/edge.js'

const cfg = loadConfig()
const session = new EdgeSession(cfg)

async function dispatch(cmd, args = {}) {
  switch (cmd) {
    case 'open': return session.open(args.url)
    case 'read': return session.read(args)
    case 'click': return session.click(args)
    case 'type': return session.type(args.text, { selector: args.selector, submit: args.submit })
    case 'press': return session.press(args.key)
    case 'scroll': return session.scroll(args.dy)
    case 'calm': return session.calm({ settleMs: args.settleMs })
    case 'back': return session.back()
    case 'shot': return session.screenshot({ outPath: args.out })
    case 'status': return session.status()
    case 'close':
      await session.close()
      return { closed: true }
    case 'doctor': {
      let running = false
      let info = {}
      try {
        const r = await fetch(`http://127.0.0.1:${cfg.port}/json/version`, { signal: AbortSignal.timeout(1200) })
        info = await r.json()
        running = true
      } catch {}
      return { ...edgeStatusSync(cfg), running, browser: info.Browser || '' }
    }
    default:
      throw new Error('未知命令: ' + cmd)
  }
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

if (process.argv.includes('--rpc')) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  let chain = Promise.resolve()
  rl.on('line', (line) => {
    const raw = line.trim()
    if (!raw) return
    chain = chain.then(async () => {
      let msg
      try { msg = JSON.parse(raw) } catch (e) {
        reply({ id: null, ok: false, error: '请求不是合法 JSON: ' + e.message })
        return
      }
      try {
        const data = await dispatch(msg.cmd, msg.args || {})
        reply({ id: msg.id ?? null, ok: true, data })
      } catch (e) {
        reply({ id: msg.id ?? null, ok: false, error: String(e?.message || e) })
      }
    })
  })
  rl.on('close', () => {
    setTimeout(() => process.exit(0), 1500).unref()
    chain.then(() => {
      try { session.cdp?.close() } catch {}
      process.exit(0)
    })
  })
} else {
  const cmd = process.argv[2]
  if (!cmd) {
    console.error('用法: node edge-cli.mjs <open|read|click|type|press|scroll|back|shot|status|close|doctor> [JSON参数]')
    process.exit(2)
  }
  let args = {}
  try { args = JSON.parse(process.argv[3] || '{}') } catch (e) {
    console.error('参数不是合法 JSON: ' + e.message)
    process.exit(2)
  }
  dispatch(cmd, args)
    .then((data) => {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n')
      process.exit(0)
    })
    .catch((e) => {
      console.error('失败: ' + String(e?.message || e))
      process.exit(1)
    })
}
