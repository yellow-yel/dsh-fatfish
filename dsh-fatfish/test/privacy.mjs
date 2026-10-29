/**
 * 发布隐私检查：node test/privacy.mjs
 *
 * 扫发布目录里的隐私残留（QQ 号、个人路径、令牌、手机号、证件号、银行卡），
 * 并校验 npm 打包白名单不夹带 config / .env / .npmrc。
 * 只读，不发网络请求。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _internal as securityInternal } from '../lib/security.js'
import { _internal } from '../lib/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skipDirs = new Set(['node_modules', '.git', 'config'])

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (skipDirs.has(ent.name)) continue
      walk(full, out)
    } else if (ent.isFile()) {
      out.push(full)
    }
  }
  return out
}

const files = walk(root)

function feedPath() {
  for (const p of [path.join(root, 'signatures.json'), path.join(root, '..', 'signatures.json')]) {
    if (fs.existsSync(p)) return p
  }
  return ''
}

const LEAKS = [
  { id: 'QQ 群号', re: new RegExp(['1737', '55494'].join('')) },
  { id: '主人 QQ', re: new RegExp(['2411', '173159'].join('')) },
  { id: '个人盘符/用户名路径', re: /[A-Z]:[\\/](?:大肥鱼|Users[\\/]lenovo)/i },
  { id: 'npm 令牌', re: /\bnpm_[A-Za-z0-9]{20,}/ },
  { id: 'API Key', re: /\b(?:sk|ghp|gho|github_pat)[-_][A-Za-z0-9]{20,}/ },
  { id: '手机号', re: /\b1[3-9]\d{9}\b/ },
  { id: '银行卡号', re: /\b\d{16,19}\b/ },
  { id: '身份证号', re: /\b\d{17}[\dXx]\b/ },
  { id: '个人邮箱', re: /\b[\w.+-]+@(?:qq|163|126|sina|gmail|outlook)\.com\b/i },
]

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log('  ✓', name)
  } catch (e) {
    failed++
    console.error('  ✘', name, '—', e.message)
  }
}

check(`隐私扫描（${files.length} 个文件）`, () => {
  const hits = []
  for (const file of files) {
    const buf = fs.readFileSync(file)
    if (buf.includes(0)) continue
    const text = buf.toString('utf8')
    for (const rule of LEAKS) {
      if (rule.re.test(text)) {
        hits.push(`${path.relative(root, file)} → ${rule.id}`)
      }
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'))
})

check('打包白名单不夹带密钥/配置', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-fatfish')
  assert.equal(pkg.version, '0.5.0')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.license, 'MIT')
  const wanted = ['lib', 'client.js', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE']
  for (const item of wanted) assert.ok(pkg.files.includes(item), `files 缺 ${item}`)
  for (const bad of ['config', 'config/api-config.json', 'test', '.env', '.npmrc', 'api-config.json']) {
    assert.ok(!pkg.files.some((f) => f === bad || f.startsWith(`${bad}/`)), `files 不应包含 ${bad}`)
  }
})

check('发布文档齐全', () => {
  for (const name of ['README.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE', 'cordis.patch.yml']) {
    const full = path.join(root, name)
    assert.ok(fs.existsSync(full), `缺 ${name}`)
    assert.ok(fs.statSync(full).size > 20, `${name} 内容过少`)
  }
  assert.ok(feedPath(), '缺 signatures.json（插件目录或仓库根目录）')
})

check('病毒库订阅文件合法', () => {
  const db = securityInternal.normalizeDb(JSON.parse(fs.readFileSync(feedPath(), 'utf8')))
  assert.ok(db.version)
  assert.ok(db.processes.length >= 30)
  assert.ok(db.commandPatterns.length >= 15)
  assert.ok(db.fileNames.length >= 10)
  assert.ok(db.hashes.length >= 1)
})

check('默认订阅地址是 https 官方源', () => {
  assert.match(_internal.DEFAULT_FEED, /^https:\/\/gitee\.com\//)
  assert.doesNotMatch(_internal.DEFAULT_FEED, /localhost|127\.0\.0\.1/)
})

check('内核只连白名单 https 域名', () => {
  const allowed = new Set([
    'gitee.com',
    'open.bigmodel.cn',
    'dashscope.aliyuncs.com',
    'dashscope.console.aliyun.com',
    'api.deepseek.com',
    'platform.deepseek.com',
  ])
  const libDir = path.join(root, 'lib')
  const bad = []
  for (const name of fs.readdirSync(libDir)) {
    if (!name.endsWith('.js')) continue
    const text = fs.readFileSync(path.join(libDir, name), 'utf8')
    if (/\bhttp:\/\//.test(text)) bad.push(`${name} 含 http://`)
    for (const m of text.matchAll(/https:\/\/([^/'"`\s]+)/g)) {
      if (!allowed.has(m[1])) bad.push(`${name} → ${m[1]}`)
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'))
})

check('不提供删文件/杀进程/执行命令能力', () => {
  const forbidden = [
    'rmSync(', 'unlinkSync(', 'unlink(', 'rmdirSync(', 'execSync(', 'spawnSync(',
    'taskkill', 'Stop-Process', 'Remove-Item',
  ]
  const bad = []
  for (const name of fs.readdirSync(path.join(root, 'lib'))) {
    if (!name.endsWith('.js')) continue
    const text = fs.readFileSync(path.join(root, 'lib', name), 'utf8')
    for (const token of forbidden) {
      if (text.includes(token)) bad.push(`${name} 含 ${token}`)
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'))
})

if (failed) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n隐私检查通过')
