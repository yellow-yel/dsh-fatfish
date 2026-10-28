/**
 * 大肥鱼之手 · Edge 浏览器内核
 *
 * 用系统自带的 Microsoft Edge，通过 DevTools 协议（CDP）驱动。
 * 关键设计：
 *   - 专用干净配置（user-data-dir 独立），不碰主人日常 Edge 的登录态、书签、历史。
 *   - 只在 127.0.0.1 开调试端口；导航只允许 http/https。
 *   - 下载默认拒绝（CDP Browser.setDownloadBehavior=deny）。
 *   - 页面有密码框时拒绝输入；支付/收银台页面拒绝点击和输入。
 *   - 不实现"读剪贴板/看文件"这类能力。
 *
 * 无第三方依赖，Node 22+（自带全局 WebSocket）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const VERSION = '0.1.0'

const IS_WIN = process.platform === 'win32'
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'fatfish-hands.config.json')

export const DEFAULTS = {
  edgePath: '',
  port: 9333,
  profileDir: '',
  maxChars: 6000,
  maxLinks: 40,
  windowSize: '1440,900',
  headless: false,
  // 红线：支付/网购/金融站点不碰（B 站等正常站点不在里面）
  denyHosts: [
    'alipay.com', 'taobao.com', 'tmall.com', 'jd.com', 'pinduoduo.com',
    'wechatpay', 'tenpay.com', '95516.com', 'unionpay.com', 'paypal.com',
    'bank', 'ebank', 'icbc.com.cn', 'ccb.com', 'boc.cn', 'cmbchina.com',
  ],
  // 这些词出现在标题/网址里时，只读不点不输入
  denyPageWords: ['收银台', '确认付款', '支付密码', '验证码', 'checkout'],
}

export function loadConfig(overrides = {}) {
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } catch {}
  const cfg = { ...DEFAULTS, ...saved, ...overrides }
  if (!cfg.profileDir) cfg.profileDir = path.join(DSH_HOME, 'fatfish-hands', 'edge-profile')
  if (!cfg.dataDir) cfg.dataDir = path.join(DSH_HOME, 'fatfish-hands')
  if (!cfg.shotsDir) cfg.shotsDir = path.join(cfg.dataDir, 'shots')
  return cfg
}

export function saveConfig(patch) {
  const cur = loadConfig()
  const next = { ...cur, ...(patch || {}) }
  delete next.dataDir
  delete next.shotsDir
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function configPath() {
  return CONFIG_FILE
}

export function findEdge(cfg = loadConfig()) {
  const cands = [
    cfg.edgePath,
    process.env.FATFISH_EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ].filter(Boolean)
  for (const p of cands) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
  return ''
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function httpJson(url, options = {}, timeoutMs = 4000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...options, signal: ac.signal })
    const text = await r.text()
    return text ? JSON.parse(text) : {}
  } finally {
    clearTimeout(timer)
  }
}

async function portInfo(port) {
  try {
    return await httpJson(`http://127.0.0.1:${port}/json/version`, {}, 1200)
  } catch {
    return null
  }
}

/** 启动/复用专用 Edge。返回 {started, edge, port, profileDir} */
export async function ensureEdge(cfg = loadConfig()) {
  const info = await portInfo(cfg.port)
  if (info) return { started: false, edge: findEdge(cfg), port: cfg.port, ...info }
  const edge = findEdge(cfg)
  if (!edge) {
    throw new Error('找不到 Microsoft Edge。请在插件设置里填 edgePath，或设 FATFISH_EDGE_PATH。')
  }
  fs.mkdirSync(cfg.profileDir, { recursive: true })
  const args = [
    `--remote-debugging-port=${cfg.port}`,
    `--user-data-dir=${cfg.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-features=msEdgeFirstRunExperience,msEdgeSidebarV2,msImplicitSignin',
    `--window-size=${cfg.windowSize || '1440,900'}`,
  ]
  if (cfg.headless) args.push('--headless=new')
  args.push('about:blank')
  const child = spawn(edge, args, { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  const end = Date.now() + 25000
  while (Date.now() < end) {
    if (await portInfo(cfg.port)) {
      return { started: true, edge, port: cfg.port, pid: child.pid }
    }
    await sleep(300)
  }
  throw new Error(`Edge 调试端口 ${cfg.port} 没起来。可能是配置目录被占用，或端口被别的程序用了。`)
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.nextId = 0
    this.pending = new Map()
    this.lastError = ''
  }

  async connect() {
    if (this.ws && this.ws.readyState === 1) return
    const ws = new WebSocket(this.wsUrl)
    this.ws = ws
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接 Edge 调试通道超时')), 8000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Edge 调试通道连接失败')) }, { once: true })
    })
    ws.addEventListener('message', (ev) => this._onMessage(ev))
    ws.addEventListener('close', () => {
      for (const [, p] of this.pending) p.reject(new Error('Edge 调试通道已断开'))
      this.pending.clear()
    })
  }

  _onMessage(ev) {
    let msg
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message || 'CDP 错误'} (${msg.error.code ?? ''})`))
      else p.resolve(msg.result)
      return
    }
    if (msg.method === 'Page.javascriptDialogOpening') {
      // 默认取消确认框，避免自动点了"确定"造成副作用
      this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {})
    }
  }

  send(method, params = {}, timeoutMs = 20000) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('Edge 没连上'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP 超时: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    })
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error('页面脚本出错: ' + (d.exception?.description || d.text || '未知错误'))
    }
    return r?.result?.value
  }

  close() {
    try { this.ws?.close() } catch {}
    this.ws = null
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

export class EdgeSession {
  constructor(cfg = loadConfig()) {
    this.cfg = cfg
    this.cdp = null
    this.targetId = ''
    this.lastRead = null
  }

  assertUrl(url) {
    let u
    try { u = new URL(String(url).trim()) } catch { throw new Error('网址格式不对: ' + url) }
    if (!/^https?:$/.test(u.protocol)) throw new Error('只允许 http/https 网址')
    const host = u.hostname.toLowerCase()
    for (const bad of this.cfg.denyHosts || []) {
      if (host.includes(String(bad).toLowerCase())) {
        throw new Error(`安全拦截: ${host} 属于支付/网购/金融红线站点，我不碰。需要主人自己操作。`)
      }
    }
    return u.toString()
  }

  async connect() {
    if (this.cdp && this.cdp.ws && this.cdp.ws.readyState === 1) return
    await ensureEdge(this.cfg)
    let list = await httpJson(`http://127.0.0.1:${this.cfg.port}/json/list`)
    // 复用的 Edge 里可能还留着旧标签：优先接回上次用的页，其次空白页，最后才随便挑一张
    const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    let page = pages.find((t) => t.id === this.targetId)
      || pages.find((t) => t.url === 'about:blank')
      || pages[0]
    if (!page) {
      await fetch(`http://127.0.0.1:${this.cfg.port}/json/new?url=about:blank`, { method: 'PUT' }).catch(() => {})
      list = await httpJson(`http://127.0.0.1:${this.cfg.port}/json/list`)
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    }
    if (!page) throw new Error('Edge 里没有可用的页面')
    this.targetId = page.id
    this.cdp = new CDP(page.webSocketDebuggerUrl)
    await this.cdp.connect()
    await this.cdp.send('Page.enable').catch(() => {})
    await this.cdp.send('Runtime.enable').catch(() => {})
    await this.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(async () => {
      await this.cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
    })
    if (this.cfg.headless) {
      await this.cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
      }).catch(() => {})
    }
    return this
  }

  async waitReady(timeoutMs = 8000) {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      try {
        const st = await this.cdp.eval('document.readyState')
        // 读文字/点链接不需要等图片视频全加载完, interactive 就够用
        if (st === 'complete') { await sleep(250); return true }
        if (st === 'interactive') { await sleep(600); return true }
      } catch {}
      await sleep(150)
    }
    await sleep(300)
    return false
  }

  async waitStable(maxMs = 3000) {
    // 搜索跳转/短链会有几跳, 等 location 连续两次一样再读页面
    let last = ''
    let same = 0
    const end = Date.now() + maxMs
    while (Date.now() < end) {
      const u = await this.cdp.eval('location.href').catch(() => '')
      if (u && u === last) {
        same++
        if (same >= 2) return u
      } else {
        same = 0
        last = u
      }
      await sleep(220)
    }
    return last
  }

  async pageGuard() {
    const info = await this.cdp.eval(`(() => ({
      url: location.href,
      title: document.title || '',
      password: !!document.querySelector('input[type="password"]'),
    }))()`)
    const blob = `${info.url} ${info.title}`.toLowerCase()
    for (const w of this.cfg.denyPageWords || []) {
      if (blob.includes(String(w).toLowerCase())) {
        throw new Error(`安全拦截: 当前页面像是支付/验证页面（${info.title || info.url}），我只读，不点也不输入。`)
      }
    }
    return info
  }

  async read({ maxChars, maxLinks } = {}) {
    const chars = Math.max(500, Math.min(20000, Number(maxChars) || this.cfg.maxChars))
    const limit = Math.max(5, Math.min(80, Number(maxLinks) || this.cfg.maxLinks))
    const data = await this.cdp.eval(`(() => {
      const clean = (s) => (s || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
      const links = [];
      const seen = new Set();
      const weakText = (s) => !s || s.length < 6
        || /^[·•\\s\\d:：\\-—\\/|]+$/.test(s)
        || /^(\\d+\\s*(秒|分钟|小时|天)前?|刚刚|昨天|前天)/.test(s);
      const nearTitle = (a) => {
        const box = a.closest('li,article,section,[class*="card"],[class*="result"],[class*="news"],[class*="item"],[class*="title"]');
        if (!box) return '';
        const el = box.querySelector('h1,h2,h3,h4,[class*="title"]');
        return el ? clean(el.innerText) : '';
      };
      for (const a of document.querySelectorAll('a[href]')) {
        if (a.offsetParent === null) continue;
        const lines = (a.innerText || '').split('\\n').map(clean).filter(Boolean);
        let t = clean(lines.join(' '));
        if (weakText(t)) {
          const near = nearTitle(a);
          if (near && near.length >= 4) t = near;
        }
        if (!t) t = clean(a.getAttribute('title') || a.getAttribute('aria-label') || '') || lines[0] || '';
        const h = a.href || '';
        if (!t || t.length < 2 || !/^https?:/i.test(h)) continue;
        const k = t.slice(0, 50) + '|' + h;
        if (seen.has(k)) continue;
        seen.add(k);
        links.push({ text: t.slice(0, 90), href: h });
        if (links.length >= ${limit}) break;
      }
      const root = document.querySelector('main, article, #app, #content') || document.body;
      const text = clean((root && root.innerText) || '').slice(0, ${chars});
      const headings = [...document.querySelectorAll('h1,h2,h3')]
        .map((h) => clean(h.innerText)).filter(Boolean).slice(0, 15);
      return {
        title: document.title || '',
        url: location.href,
        text,
        headings,
        links,
        hasPassword: !!document.querySelector('input[type="password"]'),
        hasVideo: !!document.querySelector('video,audio'),
      };
    })()`)
    data.links = (data.links || []).map((l, i) => ({ i, ...l }))
    this.lastRead = data
    return data
  }

  async open(url) {
    const safe = this.assertUrl(url)
    await this.connect()
    try {
      await this.cdp.send('Page.navigate', { url: safe }, 12000)
    } catch (e) {
      // 有些站点跳转慢或被拦, navigate 的应答会迟到; 页面通常已经在加载, 继续读状态
    }
    await this.waitReady()
    await this.waitStable()
    await this.pageGuard()
    return this.read()
  }

  async click({ text, selector, index } = {}) {
    await this.connect()
    await this.pageGuard()
    if (index !== undefined && index !== null && index !== '') {
      const n = Number(index)
      const link = this.lastRead?.links?.[n]
      if (!link) throw new Error(`没有第 ${n} 个链接，请先 read 一次`)
      return this.open(link.href)
    }
    if (selector) {
      const r = await this.cdp.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(String(selector))});
        if (!el || el.offsetParent === null) return { ok: false, reason: '选择器没找到可见元素' };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { ok: true, tag: el.tagName, text: (el.innerText || '').slice(0, 90) };
      })()`)
      if (!r?.ok) throw new Error(r?.reason || '点击失败')
      await this.waitReady()
      await this.pageGuard()
      return this.read()
    }
    const q = String(text || '').trim()
    if (!q) throw new Error('要点击什么？给 text / selector / index 之一')
    const r = await this.cdp.eval(`(() => {
      const q = ${JSON.stringify(q)}.toLowerCase();
      let best = null, bestScore = 1e9;
      for (const el of document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"],summary')) {
        if (el.offsetParent === null) continue;
        const raw = (el.innerText || el.value || el.getAttribute('aria-label') || '') + '';
        const t = raw.replace(/\\s+/g, ' ').trim();
        if (!t) continue;
        const low = t.toLowerCase();
        let score = 1e9;
        if (low === q) score = 0;
        else if (low.startsWith(q)) score = 1 + t.length / 1000;
        else if (low.includes(q)) score = 2 + t.length / 1000;
        if (score === 1e9) continue;
        if (el.tagName === 'A' || el.tagName === 'BUTTON') score -= 0.4;
        if (score < bestScore) { bestScore = score; best = el; }
      }
      if (!best) return { ok: false, reason: '没找到包含这段文字的可点击元素，先 read 看看链接列表' };
      best.scrollIntoView({ block: 'center' });
      const label = ((best.innerText || best.value || '') + '').replace(/\\s+/g, ' ').trim();
      let navigated = false;
      try {
        const href = best.href || '';
        if (best.tagName === 'A' && /^https?:/i.test(href)
            && (best.target === '_blank' || best.getAttribute('target') === '_blank')) {
          location.href = href;
          navigated = true;
        }
      } catch (e) {}
      if (!navigated) best.click();
      return { ok: true, clicked: label.slice(0, 100), tag: best.tagName };
    })()`)
    if (!r?.ok) throw new Error(r?.reason || '点击失败')
    await this.waitReady()
    await this.pageGuard()
    return this.read()
  }

  async type(text, { selector, submit } = {}) {
    await this.connect()
    const guard = await this.pageGuard()
    if (guard.password) {
      throw new Error('安全拦截: 当前页面有密码框，可能是登录页。密码/验证码我不碰，请主人自己登录。')
    }
    const focus = await this.cdp.eval(`(() => {
      let el = ${selector ? `document.querySelector(${JSON.stringify(String(selector))})` : 'null'};
      const usable = (e) => e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable) && e.offsetParent !== null;
      if (!usable(el)) {
        const ae = document.activeElement;
        el = usable(ae) ? ae : null;
      }
      if (!el) {
        const cands = [...document.querySelectorAll('input[type="search"],input[type="text"],input:not([type]),textarea,[contenteditable="true"]')]
          .filter((e) => e.offsetParent !== null);
        el = cands.find((e) => /搜索|搜|search/i.test((e.placeholder || '') + (e.getAttribute('aria-label') || '') + (e.name || ''))) || cands[0] || null;
      }
      if (!el) return { ok: false, reason: '页面上找不到输入框' };
      el.focus();
      el.scrollIntoView({ block: 'center' });
      return { ok: true, tag: el.tagName, placeholder: el.placeholder || '' };
    })()`)
    if (!focus?.ok) throw new Error(focus?.reason || '找不到输入框')
    await this.cdp.send('Input.insertText', { text: String(text) })
    await sleep(250)
    if (submit) {
      const before = await this.cdp.eval('location.href').catch(() => '')
      const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' })
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
      await sleep(900)
      const st = await this.cdp.eval(`(() => {
        const a = document.activeElement;
        const field = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
        return { url: location.href, field: !!field, form: !!(field && a.form) };
      })()`).catch(() => ({}))
      // 有些站(如必应)回车不提交: 页面没变、焦点还在输入框, 就手动提交表单
      if (st && st.url === before && st.field && st.form) {
        await this.cdp.eval(`(() => {
          const a = document.activeElement;
          try { a.form.requestSubmit(); return; } catch (e) {}
          try { a.form.submit(); return; } catch (e) {}
          const b = a.form.querySelector('input[type="submit"],button[type="submit"]');
          if (b) b.click();
        })()`).catch(() => {})
      }
    }
    await this.waitReady(10000)
    await this.waitStable()
    await this.pageGuard()
    return this.read()
  }

  async press(key) {
    await this.connect()
    const map = {
      Enter: [13, 'Enter'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'],
      Delete: [46, 'Delete'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'],
      ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], PageUp: [33, 'PageUp'],
      PageDown: [34, 'PageDown'], Home: [36, 'Home'], End: [35, 'End'], Space: [32, 'Space'],
    }
    const name = String(key || 'Enter')
    const hit = map[name] || map[name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()]
    if (!hit) throw new Error('不支持的按键: ' + name)
    const [vk, code] = hit
    const base = { key: code, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: code === 'Enter' ? '\r' : undefined })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(350)
    await this.waitReady(10000)
    await this.pageGuard()
    return this.read()
  }

  async scroll(dy = 600) {
    await this.connect()
    const size = await this.cdp.eval('({w: window.innerWidth, h: window.innerHeight})')
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(size.w / 2), y: Math.round(size.h / 2),
      deltaX: 0, deltaY: Number(dy) || 600,
    }, 6000)
    await sleep(600)
    return this.read()
  }

  async calm({ settleMs = 1500 } = {}) {
    // 内容页停一会儿后把音视频静音/暂停: 算是"看了一会儿", 也不占 GPU、不出声
    await this.connect()
    await sleep(Math.max(0, Math.min(8000, Number(settleMs) || 1500)))
    const r = await this.cdp.eval(`(() => {
      const roots = [document];
      for (let i = 0; i < roots.length; i++) {
        for (const el of roots[i].querySelectorAll('*')) {
          if (el.shadowRoot && !roots.includes(el.shadowRoot)) roots.push(el.shadowRoot);
        }
      }
      for (const f of document.querySelectorAll('iframe')) {
        try { if (f.contentDocument) roots.push(f.contentDocument); } catch (e) {}
      }
      let media = 0, paused = 0, muted = 0;
      for (const root of roots) {
        for (const v of root.querySelectorAll('video,audio')) {
          media++;
          try { v.muted = true } catch (e) {}
          try { if (!v.paused) v.pause() } catch (e) {}
          if (v.paused) paused++;
          if (v.muted) muted++;
        }
      }
      try { if (window.player && typeof window.player.pause === 'function') window.player.pause() } catch (e) {}
      return { media, paused, muted };
    })()`).catch(() => ({}))
    return r || {}
  }

  async back() {
    await this.connect()
    await this.cdp.eval('history.back()')
    await sleep(700)
    await this.waitReady(10000)
    return this.read()
  }

  async screenshot({ outPath } = {}) {
    await this.connect()
    // 最小化/隐藏的窗口截不到图（CDP 会一直等）: 先把窗口恢复成正常状态并放到前台
    try {
      const win = await this.cdp.send('Browser.getWindowForTarget', { targetId: this.targetId }, 5000)
      if (win?.windowId) {
        if (win.bounds?.windowState && win.bounds.windowState !== 'normal') {
          await this.cdp.send('Browser.setWindowBounds',
            { windowId: win.windowId, bounds: { windowState: 'normal' } }, 5000)
          await sleep(150)
        }
      }
    } catch {}
    let r
    try {
      r = await this.cdp.send('Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false }, 8000)
    } catch {
      r = await this.cdp.send('Page.captureScreenshot',
        { format: 'png', fromSurface: false, captureBeyondViewport: false }, 15000)
    }
    fs.mkdirSync(this.cfg.shotsDir, { recursive: true })
    const file = outPath || path.join(this.cfg.shotsDir, `edge_${Date.now()}.png`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    const size = await this.cdp.eval('({w: window.innerWidth, h: window.innerHeight})').catch(() => ({}))
    return { path: file, width: size.w, height: size.h }
  }

  async status() {
    await this.connect()
    const t = await this.cdp.eval('({title: document.title || "", url: location.href, ready: document.readyState})')
    return { ...t, port: this.cfg.port, edge: findEdge(this.cfg), profile: this.cfg.profileDir }
  }

  async close() {
    try {
      if (this.cdp) await this.cdp.send('Browser.close', {}, 5000)
    } catch {}
    try { this.cdp?.close() } catch {}
    this.cdp = null
  }
}

export function edgeStatusSync(cfg = loadConfig()) {
  return { edge: findEdge(cfg), port: cfg.port, profile: cfg.profileDir, config: CONFIG_FILE }
}
