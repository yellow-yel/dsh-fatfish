/**
 * 大肥鱼记忆 · 本地事实库
 *
 * 只写本机：`~/.dsh/fatfish/memory.json`，不上传、不联网。
 * 记的是「事实」，不是聊天原文；密码、验证码、证件号、银行卡、手机号一律拒收。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const MEMORY_LIMIT_DEFAULT = 300
const TEXT_MAX = 240
const TAG_MAX = 6
const TAG_LEN = 16

const SECRET_RULES = [
  { re: /(?:密码|口令|验证码|短信码|身份证|银行卡|卡号|手机号|住址|家庭地址)\s*(?:是|为|[:：=])\s*\S+/i, why: '密码/验证码/证件/银行卡/手机号/住址' },
  { re: /\b(?:sk|ghp|gho|github_pat|npm)[_-][A-Za-z0-9]{12,}\b/, why: 'API Key / 令牌' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i, why: '登录令牌' },
  { re: /\b\d{17}[\dXx]\b/, why: '身份证号' },
  { re: /\b(?:\d[ -]?){16,19}\b/, why: '银行卡号' },
  { re: /\b1[3-9]\d{9}\b/, why: '手机号' },
  { re: /QQ\s*(?:号|号码)?\s*[:：=]?\s*\d{5,12}/i, why: 'QQ 号' },
]

export function dataDir() {
  return process.env.FATFISH_DATA || path.join(os.homedir(), '.dsh', 'fatfish')
}

export function memoryFile() {
  return path.join(dataDir(), 'memory.json')
}

function ensureDir() {
  fs.mkdirSync(dataDir(), { recursive: true })
}

export function containsSecret(text) {
  const s = String(text || '')
  for (const rule of SECRET_RULES) {
    if (rule.re.test(s)) return rule.why
  }
  return ''
}

export function loadStore() {
  try {
    const raw = fs.readFileSync(memoryFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.facts)) {
      return { version: 1, facts: parsed.facts.filter((f) => f && f.text) }
    }
  } catch {
    /* 第一次用或文件坏了：按空库处理，不覆盖原文件 */
  }
  return { version: 1, facts: [] }
}

function saveStore(store) {
  ensureDir()
  const target = memoryFile()
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, target)
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
}

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigrams(text) {
  const s = norm(text)
  const out = new Set()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  if (s.length === 1) out.add(s)
  return out
}

export function tokenize(text) {
  const out = new Set()
  const lower = String(text || '').toLowerCase()
  for (const w of lower.match(/[a-z0-9_]{2,}/g) || []) out.add(w)
  const cjk = lower.replace(/[^\u4e00-\u9fff]+/g, ' ')
  for (const seg of cjk.split(/\s+/)) {
    if (!seg) continue
    for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2))
    if (seg.length === 1) out.add(seg)
  }
  return out
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(/[,，\s]+/)
  const out = []
  for (const t of list) {
    const v = String(t || '').trim().slice(0, TAG_LEN)
    if (v && !out.includes(v)) out.push(v)
    if (out.length >= TAG_MAX) break
  }
  return out
}

function newId() {
  return `m_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

export function saveFact({ text, tags = [], source = 'chat', maxFacts = MEMORY_LIMIT_DEFAULT } = {}) {
  const value = cleanText(text)
  if (value.length < 2) throw new Error('至少要记两个字')
  const secret = containsSecret(value)
  if (secret) throw new Error(`这条像${secret}，不能写进记忆`)

  const store = loadStore()
  const clean = cleanTags(tags)
  const n = norm(value)
  const grams = bigrams(value)

  for (const fact of store.facts) {
    if (norm(fact.text) === n || jaccard(bigrams(fact.text), grams) >= 0.85) {
      fact.tags = Array.from(new Set([...(fact.tags || []), ...clean])).slice(0, TAG_MAX)
      fact.updatedAt = new Date().toISOString()
      saveStore(store)
      return { created: false, fact, total: store.facts.length }
    }
  }

  const fact = {
    id: newId(),
    text: value,
    tags: clean,
    source: String(source || 'chat').slice(0, 32),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hits: 0,
    lastUsedAt: '',
  }
  store.facts.push(fact)

  const cap = Math.max(50, Math.min(1000, Number(maxFacts) || MEMORY_LIMIT_DEFAULT))
  if (store.facts.length > cap) {
    store.facts.sort((a, b) => String(b.lastUsedAt || b.updatedAt).localeCompare(String(a.lastUsedAt || a.updatedAt)))
    store.facts = store.facts.slice(0, cap)
  }

  saveStore(store)
  return { created: true, fact, total: store.facts.length }
}

export function recallFacts(query, { limit = 5 } = {}) {
  const q = String(query || '').trim()
  const max = Math.max(1, Math.min(20, Number(limit) || 5))
  const store = loadStore()
  const now = new Date().toISOString()

  let picked
  if (!q) {
    picked = [...store.facts]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, max)
      .map((f) => ({ ...f, score: 0 }))
  } else {
    const qTokens = tokenize(q)
    const qNorm = norm(q)
    picked = []
    for (const fact of store.facts) {
      const fTokens = tokenize(`${fact.text} ${(fact.tags || []).join(' ')}`)
      let score = qTokens.size ? [...qTokens].filter((t) => fTokens.has(t)).length / qTokens.size : 0
      if (qNorm && norm(fact.text).includes(qNorm)) score += 0.6
      if (score > 0) picked.push({ ...fact, score })
    }
    picked.sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    picked = picked.slice(0, max)
  }

  if (picked.length) {
    const ids = new Set(picked.map((f) => f.id))
    for (const fact of store.facts) {
      if (ids.has(fact.id)) {
        fact.hits = (fact.hits || 0) + 1
        fact.lastUsedAt = now
      }
    }
    saveStore(store)
  }
  return picked
}

export function forgetFacts({ id, query } = {}) {
  const store = loadStore()
  let removed = []
  if (id) {
    removed = store.facts.filter((f) => f.id === String(id))
  } else {
    const q = String(query || '').trim()
    const qNorm = norm(q)
    if (qNorm.length < 2) throw new Error('给一个记忆 id，或者至少两个字的查询')
    const qTokens = tokenize(q)
    removed = store.facts.filter((f) => {
      if (norm(f.text).includes(qNorm)) return true
      return jaccard(tokenize(`${f.text} ${(f.tags || []).join(' ')}`), qTokens) >= 0.6
    })
  }
  if (!removed.length) return { removed: [], total: store.facts.length }
  const ids = new Set(removed.map((f) => f.id))
  store.facts = store.facts.filter((f) => !ids.has(f.id))
  saveStore(store)
  return { removed, total: store.facts.length }
}

export function listFacts(limit = 10) {
  return [...loadStore().facts]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)))
}

export function memoryStats() {
  const store = loadStore()
  return { total: store.facts.length, file: memoryFile() }
}

const EXTRACT_RULES = [
  { re: /(?:记住|记一下|帮我记|记着)[：:，,\s]*(.{2,80})/, tag: '记住' },
  { re: /我叫([^\s，。,.!！?？]{1,20})/, tag: '名字', make: (m) => `主人叫${m[1]}` },
  { re: /我的生日(?:是|在|[:：])?\s*([0-9]{1,2}月[0-9]{1,2}[日号]?)/, tag: '生日', make: (m) => `主人生日：${m[1]}` },
  { re: /我(?:最|很|特别)?喜欢(?:吃|玩|听|看|做)?([^\n，。,.!！?？]{1,40})/, tag: '喜欢', make: (m) => `主人喜欢${m[1]}` },
  { re: /我(?:最|很|特别)?(?:讨厌|不喜欢)([^\n，。,.!！?？]{1,40})/, tag: '讨厌', make: (m) => `主人讨厌${m[1]}` },
  { re: /我(?:每天|通常|一般)([^\n，。,.!！?？]{2,40})/, tag: '习惯', make: (m) => `主人习惯${m[1]}` },
]

export function autoExtract(message) {
  const text = String(message || '').trim()
  if (text.length < 4 || text.length > 800) return []
  const out = []
  const seen = new Set()
  for (const rule of EXTRACT_RULES) {
    const m = text.match(rule.re)
    if (!m) continue
    const value = rule.make ? rule.make(m) : m[1]
    const clean = cleanText(value)
    if (clean.length < 2) continue
    const key = norm(clean)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ text: clean, tags: [rule.tag, '自动'] })
  }
  return out
}

export function autoCapture(message, { maxFacts = MEMORY_LIMIT_DEFAULT } = {}) {
  const saved = []
  for (const item of autoExtract(message)) {
    try {
      const r = saveFact({ ...item, source: 'auto', maxFacts })
      saved.push(r.fact)
    } catch {
      /* 像密码的内容直接跳过 */
    }
  }
  return saved
}

export const _internal = { norm, bigrams, jaccard, cleanText, cleanTags, SECRET_RULES }
