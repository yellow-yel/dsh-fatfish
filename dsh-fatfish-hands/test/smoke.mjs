/**
 * 离线冒烟测试：node test/smoke.mjs
 *
 * 起一个本地小网页（不联网），走和插件工具完全相同的 EdgeRpc 通道，
 * 验证 open / read / click(index) / type(submit) / back / screenshot / status / doctor。
 * 需要本机有 Microsoft Edge；测试会打开一个 1440x900 的窗口。
 */
import http from 'node:http'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { EdgeRpc } from '../lib/bridge.js'
import { loadConfig, ensureEdge } from '../lib/edge.js'

const LONG = '这是一段用来测试正文提取的示例文字。'.repeat(30)

const PAGE_HOME = `<!doctype html><html><head><meta charset="utf-8"><title>大肥鱼测试首页</title></head>
<body>
  <h1>测试首页</h1>
  <nav><a href="/about">关于本站</a> <a href="/login">登录</a></nav>
  <ul>
    <li><h3><a href="/article/1">第一篇测试文章</a></h3></li>
    <li><h3><a href="/article/2">第二篇测试文章</a></h3></li>
  </ul>
  <form action="/search" method="get">
    <input name="q" placeholder="搜索" autocomplete="off">
    <button type="submit">搜索</button>
  </form>
  <p>${LONG}</p>
</body></html>`

const PAGE_ONE = `<!doctype html><html><head><meta charset="utf-8"><title>测试文章一</title></head>
<body><h1>测试文章一</h1><p>${LONG}</p><a href="/">回首页</a></body></html>`

const PAGE_LOGIN = `<!doctype html><html><head><meta charset="utf-8"><title>测试登录</title></head>
<body><h1>登录</h1>
<form action="/search" method="get">
  <input name="u" placeholder="用户名">
  <input type="password" name="p" placeholder="密码">
  <button type="submit">登录</button>
</form></body></html>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  res.setHeader('content-type', 'text/html; charset=utf-8')
  if (url.pathname === '/article/1') return res.end(PAGE_ONE)
  if (url.pathname === '/login') return res.end(PAGE_LOGIN)
  if (url.pathname === '/search') {
    const q = url.searchParams.get('q') || ''
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>搜索结果: ${q}</title></head>
      <body><h1>搜索结果: ${q}</h1><p>${LONG}</p></body></html>`)
    return
  }
  res.end(PAGE_HOME)
})

const checks = []
function ok(name, fn) {
  checks.push([name, fn])
}

const rpc = new EdgeRpc()
let base = ''

ok('open 首页', async () => {
  const p = await rpc.call('open', { url: base + '/' })
  assert.match(p.title, /大肥鱼测试首页/)
  assert.ok(p.links.length >= 4, '首页应有可点链接')
  assert.ok(p.text.includes('示例文字'), '应读到正文')
  return p
})

ok('read 带编号链接', async () => {
  const p = await rpc.call('read', { maxLinks: 20 })
  const first = p.links.find((l) => l.text.includes('第一篇测试文章'))
  assert.ok(first, '应能找到「第一篇测试文章」链接')
  assert.equal(typeof first.i, 'number')
  return first
})

ok('click index 打开文章', async (first) => {
  const p = await rpc.call('click', { index: first.i })
  assert.match(p.title, /测试文章一/)
  return p
})

ok('back 回首页', async () => {
  const p = await rpc.call('back', {})
  assert.match(p.title, /大肥鱼测试首页/)
  return p
})

ok('type + submit 搜索', async () => {
  const p = await rpc.call('type', { text: '大肥鱼', submit: true })
  assert.match(p.title, /搜索结果: 大肥鱼/)
  return p
})

ok('screenshot 落盘', async () => {
  const r = await rpc.call('shot', {})
  assert.ok(fs.existsSync(r.path), '截图文件应存在')
  assert.ok(r.width > 0 && r.height > 0)
  return r
})

ok('status 有页面信息', async () => {
  const r = await rpc.call('status', {})
  assert.ok(r.url.startsWith(base))
  assert.ok(r.edge, '应解析出 Edge 路径')
  return r
})

ok('doctor 体检', async () => {
  const r = await rpc.call('doctor', {})
  assert.ok(r.edge, '应找到 Edge')
  assert.ok(r.port > 0)
  return r
})

ok('安全拦截 支付站点', async () => {
  await assert.rejects(() => rpc.call('open', { url: 'https://www.alipay.com/' }), /安全拦截/)
})

ok('安全拦截 file:// 网址', async () => {
  await assert.rejects(() => rpc.call('open', { url: 'file:///C:/Windows/win.ini' }), /只允许 http/)
})

ok('安全拦截 密码页输入', async () => {
  await rpc.call('open', { url: base + '/login' })
  await assert.rejects(() => rpc.call('type', { text: 'hunter2', submit: true }), /密码/)
})

/** 上一轮测试可能留下多个标签，先清场，保证本轮从一张空白页开始。
 *  只动插件自己的专用配置（fatfish-hands/edge-profile），不碰日常 Edge。 */
async function resetBrowser() {
  const cfg = loadConfig()
  await ensureEdge(cfg)
  const list = await (await fetch(`http://127.0.0.1:${cfg.port}/json/list`)).json()
  const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  for (const t of pages.slice(1)) {
    await fetch(`http://127.0.0.1:${cfg.port}/json/close/${t.id}`).catch(() => {})
  }
  if (!pages.length) {
    await fetch(`http://127.0.0.1:${cfg.port}/json/new?url=about:blank`, { method: 'PUT' }).catch(() => {})
  }
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  await resetBrowser()
  console.log('本地测试页:', base)
  let passed = 0
  let last = null
  for (const [name, fn] of checks) {
    try {
      last = await fn(last)
      passed++
      console.log('  ✓', name)
    } catch (e) {
      console.error('  ✘', name, '—', e.message)
      process.exitCode = 1
      break
    }
  }
  console.log(`\n${passed}/${checks.length} 通过`)
  rpc.close()
  server.close()
  setTimeout(() => process.exit(process.exitCode || 0), 300)
}

main()
