/**
 * 上架前自检：node scripts/preflight.mjs [--offline] [--with-browser] [--skip-tests]
 *
 * 全绿才允许进下一步。--offline 跳过联网的两项（npm 版本占用、订阅地址可达）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  bundleRoot, config, pluginPackages, rel, run, runGit, runNpm, npmLauncher, parseJsonLoose,
  PACK_EXCLUDES, nodeMajor, dshRuntime,
} from './lib.mjs'

const argv = process.argv.slice(2)
const OFFLINE = argv.includes('--offline')
const WITH_BROWSER = argv.includes('--with-browser')
const SKIP_TESTS = argv.includes('--skip-tests')
const STRICT_FEEDS = argv.includes('--strict-feeds')
let pendingFeeds = 0

let pass = 0
const failures = []

async function check(title, fn) {
  try {
    const note = await fn()
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${title}${note ? ` — ${note}` : ''}`)
  } catch (err) {
    failures.push({ title, reason: err.message })
    console.log(`  \x1b[31m✘\x1b[0m ${title} — ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const pkgs = pluginPackages()

// 规则本身拆成片段写，免得扫到自己
const LEAKS = [
  { id: 'QQ 群号/个人 QQ', re: new RegExp(`\\b(?:${['1737', '55494'].join('')}|${['2411', '173159'].join('')})\\b`) },
  { id: '本机个人路径', re: /[A-Z]:[\\/](?:Users[\\/]lenovo|Users[\\/]HASEE)/i },
  { id: '写死的 U 盘路径', re: /[A-Z]:[\\/]大肥鱼/i },
  { id: 'npm 令牌', re: /\bnpm_[A-Za-z0-9]{20,}/ },
  { id: 'API Key / 平台令牌', re: /\b(?:sk|ghp|gho|github_pat)[-_][A-Za-z0-9]{20,}/ },
  { id: '手机号', re: /\b1[3-9]\d{9}\b/ },
  { id: '银行卡号', re: /\b\d{16,19}\b/ },
  { id: '身份证号', re: /\b\d{17}[\dXx]\b/ },
  { id: '个人邮箱', re: /\b[\w.+-]+@(?:qq|163|126|sina|gmail|outlook)\.com\b/i },
]

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (['node_modules', '.git', 'dist', '__pycache__'].includes(ent.name)) continue
      walk(full, out)
    } else if (ent.isFile()) out.push(full)
  }
  return out
}

console.log(`\n大肥鱼 · 上架自检\n目录：${bundleRoot}\n`)
await check('运行环境', () => {
  assert(nodeMajor() >= 22, `需要 Node 22+，当前 ${process.versions.node}`)
  const l = npmLauncher()
  assert(l, '找不到 npm，无法打包/发布')
  return `Node ${process.versions.node} · npm ${l.cli ? '随 node' : l.cmd}`
})

await check('插件目录齐全', () => {
  const need = ['package.json', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE']
  for (const { dir } of pkgs) {
    for (const f of need) {
      const full = path.join(bundleRoot, dir, f)
      assert(fs.existsSync(full), `${dir} 缺 ${f}`)
      if (f.endsWith('.md') || f === 'LICENSE') assert(fs.statSync(full).size > 20, `${dir}/${f} 内容过少`)
    }
  }
  return `${pkgs.length} 个包：${pkgs.map((p) => `${p.name}@${p.version}`).join(' · ')}`
})

await check('patch 声明与包名一致', () => {
  const bad = []
  for (const { dir, name } of pkgs) {
    const yml = fs.readFileSync(path.join(bundleRoot, dir, 'cordis.patch.yml'), 'utf8')
    const ids = [...yml.matchAll(/^\s*-\s*id:\s*['"]?([^'"\s#]+)/gm)].map((m) => m[1])
    const names = [...yml.matchAll(/^\s+name:\s*['"]?([^'"\s#]+)/gm)].map((m) => m[1])
    if (!ids.includes(name) || !names.includes(name)) bad.push(`${dir}: id=${ids} name=${names}`)
  }
  assert(!bad.length, bad.join(' | '))
  return 'DSH 装完能挂上'
})

await check('市场元数据完整', () => {
  const bad = []
  for (const { dir, pkg } of pkgs) {
    const repo = pkg.repository && pkg.repository.url || ''
    if (!/^git\+https:\/\//.test(repo)) bad.push(`${dir}: repository.url`)
    if ((pkg.repository || {}).directory !== dir) bad.push(`${dir}: repository.directory`)
    if (!/^https:\/\/github\.com\//.test(pkg.homepage || '')) bad.push(`${dir}: homepage`)
    if (!/^https:\/\/github\.com\/.*\/issues$/.test((pkg.bugs || {}).url || '')) bad.push(`${dir}: bugs.url`)
    if ((pkg.publishConfig || {}).access !== 'public') bad.push(`${dir}: publishConfig.access`)
    if (pkg.private) bad.push(`${dir}: private=true 会被 npm 拒绝`)
    if (pkg.license !== 'MIT') bad.push(`${dir}: license=${pkg.license}`)
    const patch = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch
    if (!patch) bad.push(`${dir}: 缺 dsh.bundle.patch，DSH 的 dsh plugin add 不认这个包`)
    else if (!fs.existsSync(path.join(bundleRoot, dir, patch))) bad.push(`${dir}: dsh.bundle.patch 指向的 ${patch} 不存在`)
  }
  assert(!bad.length, bad.join(' | '))
  return 'npm 页面能显示仓库/问题入口'
})

await check('打包白名单不含敏感内容', () => {
  const bad = []
  for (const { dir, pkg } of pkgs) {
    for (const item of PACK_EXCLUDES) {
      if (pkg.files.some((f) => f === item || f.startsWith(`${item}/`))) bad.push(`${dir}: files 含 ${item}`)
    }
    for (const need of ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
      if (!pkg.files.includes(need)) bad.push(`${dir}: files 缺 ${need}`)
    }
    assert(!fs.existsSync(path.join(bundleRoot, dir, '.npmrc')), `${dir} 里有 .npmrc`)
    assert(!fs.existsSync(path.join(bundleRoot, dir, '.env')), `${dir} 里有 .env`)
  }
  assert(!fs.existsSync(path.join(bundleRoot, '.npmrc')), '市场版根目录有 .npmrc，会跟着拷来拷去')
  assert(!bad.length, bad.join(' | '))
  return 'config / test / 令牌都不在包里'
})

await check('CHANGELOG 与版本号对齐', () => {
  const bad = []
  for (const { dir, version } of pkgs) {
    const head = fs.readFileSync(path.join(bundleRoot, dir, 'CHANGELOG.md'), 'utf8').match(/^##\s*(\d+\.\d+\.\d+)/m)
    if (!head || head[1] !== version) bad.push(`${dir}: CHANGELOG=${head && head[1]} package=${version}`)
  }
  assert(!bad.length, bad.join(' | '))
  return pkgs.map((p) => `${p.name}@${p.version}`).join(' · ')
})

await check('市场索引与包版本一致', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'market-index.json'), 'utf8'))
  assert(idx.format === 1, `format=${idx.format}，应为 1`)
  const bad = []
  for (const { name, version } of pkgs) {
    const entry = (idx.plugins || []).find((p) => p.name === name)
    if (!entry) { bad.push(`索引缺 ${name}`); continue }
    const v = entry.versions || []
    const latest = v[v.length - 1]
    if (!latest || latest.version !== version) bad.push(`${name}: 索引=${latest && latest.version} 包=${version}`)
    if (!latest || !latest.source || latest.source.type !== 'npm') bad.push(`${name}: source.type 应为 npm`)
    if (!latest || !Number.isInteger(latest.publishTimestamp)) bad.push(`${name}: publishTimestamp 缺失`)
  }
  for (const entry of idx.plugins || []) {
    if (!pkgs.some((p) => p.name === entry.name)) bad.push(`索引里有多余的 ${entry.name}`)
    if (!entry.repository || !/^https:\/\/github\.com\//.test(entry.repository.url || '')) bad.push(`${entry.name}: repository.url`)
    if (!/^https:\/\//.test(entry.homepage || '')) bad.push(`${entry.name}: homepage`)
    const cat = entry.metadata && entry.metadata.category
    if (!cat) bad.push(`${entry.name}: metadata.category 缺失`)
    if (cat && !((idx.metadata || {}).categories || {})[cat]) bad.push(`${entry.name}: 分类 ${cat} 没在顶层 metadata.categories 里声明`)
  }
  assert(idx.title && idx.title.zh && idx.title.en, '顶层 title 要中英都有')
  assert(idx.description && idx.description.zh && idx.description.en, '顶层 description 要中英都有')
  assert(idx.metadata && idx.metadata.categories && Object.keys(idx.metadata.categories).length, '顶层 metadata.categories 缺失，DSH 的分类页会是空的')
  for (const { name } of pkgs) {
    const entry = (idx.plugins || []).find((p) => p.name === name)
    if (entry) for (const k of ['title', 'description']) {
      if (!entry[k] || !entry[k].zh || !entry[k].en) bad.push(`${name}: ${k} 要中英都有`)
    }
  }
  assert(!bad.length, bad.join(' | '))
  return `${(idx.plugins || []).length} 个条目`
})

await check('病毒库订阅文件合法且两份一致', async () => {
  const { _internal } = await import(pathToFileURL(path.join(bundleRoot, 'dsh-fatfish', 'lib', 'security.js')).href)
  const root = path.join(bundleRoot, 'signatures.json')
  assert(fs.existsSync(root), '根目录缺 signatures.json（上架后订阅源要放在仓库根）')
  const db = _internal.normalizeDb(JSON.parse(fs.readFileSync(root, 'utf8')))
  assert(db.processes.length >= 30 && db.commandPatterns.length >= 15 && db.fileNames.length >= 10 && db.hashes.length >= 1,
    `规则数不足：${db.processes.length}/${db.commandPatterns.length}/${db.fileNames.length}/${db.hashes.length}`)
  const inPlugin = path.join(bundleRoot, 'dsh-fatfish', 'signatures.json')
  if (fs.existsSync(inPlugin)) {
    assert(fs.readFileSync(inPlugin, 'utf8') === fs.readFileSync(root, 'utf8'), '插件目录内与根目录的 signatures.json 不一致')
  }
  return `规则 ${db.processes.length + db.commandPatterns.length + db.fileNames.length + db.hashes.length} 条，版本 ${db.version}`
})

await check('默认订阅地址与配置一致', () => {
  const src = fs.readFileSync(path.join(bundleRoot, 'dsh-fatfish', 'lib', 'index.js'), 'utf8')
  const def = (src.match(/DEFAULT_FEED\s*=\s*'([^']+)'/) || [])[1]
  assert(def, 'lib/index.js 里找不到 DEFAULT_FEED')
  assert(/^https:\/\//.test(def), `DEFAULT_FEED 不是 https：${def}`)
  const yml = fs.readFileSync(path.join(bundleRoot, 'dsh-fatfish', 'cordis.patch.yml'), 'utf8')
  assert(yml.includes(def), `cordis.patch.yml 的 feedUrl 和 DEFAULT_FEED 不一致`)
  return def
})

await check('隐私扫描（待提交内容）', () => {
  const listed = runGit(['ls-files', '--cached', '--others', '--exclude-standard'])
  const fromGit = listed.code === 0 ? listed.stdout.split(/\r?\n/).filter(Boolean) : []
  const targets = (fromGit.length ? fromGit : walk(bundleRoot).map((f) => rel(f))).map((f) => path.join(bundleRoot, f))
  const hits = []
  for (const file of targets) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue
    if (path.basename(file) === '.npmrc' || file.endsWith('.token')) hits.push(`${rel(file)} → 凭据文件本体`)
    const buf = fs.readFileSync(file)
    if (buf.includes(0)) continue
    const text = buf.toString('utf8')
    for (const rule of LEAKS) if (rule.re.test(text)) hits.push(`${rel(file)} → ${rule.id}`)
  }
  assert(!hits.length, hits.join('\n     '))
  return `${targets.length} 个待提交文件，无 QQ 号/令牌/手机号/本机路径`
})

const historyLeaks = []
await check('隐私扫描（git 历史，警告级）', () => {
  const res = runGit(['log', '--all', '-p'])
  assert(res.code === 0, `git log 读取失败：${res.stderr.slice(0, 120) || res.error}`)
  const text = res.stdout.slice(0, 8_000_000)
  for (const rule of LEAKS) if (rule.re.test(text)) historyLeaks.push(rule.id)
  if (historyLeaks.length) {
    console.log(`  \x1b[33m!\x1b[0m 公开仓库的旧提交里仍能翻到：${historyLeaks.join(' / ')}`)
    console.log('      本次提交不会让它更糟；要彻底抹掉得改写历史并强推（git filter-repo + push --force），')
    console.log('      那是不可逆操作，需要你另外确认，脚本不会自动做。')
  }
  return historyLeaks.length ? `${historyLeaks.length} 项旧痕迹（警告）` : '历史也干净'
})

await check('git 仓库与远端就绪', () => {
  assert(fs.existsSync(path.join(bundleRoot, '.git')), '缺 .git，先跑 scripts/release.mjs 会自动初始化')
  assert(runGit(['rev-parse', '--git-dir']).code === 0, '当前目录不是合法 git 仓库')
  const remotes = runGit(['remote']).stdout.trim().split(/\r?\n/).filter(Boolean)
  const bad = []
  for (const [name, url] of Object.entries(config.remotes)) {
    if (!remotes.includes(name)) { bad.push(`缺远端 ${name}`); continue }
    const got = runGit(['remote', 'get-url', name]).stdout.trim()
    if (got.replace(/\/\/[^@]*@/, '//') !== url.replace(/\/\/[^@]*@/, '//')) bad.push(`远端 ${name} 指向 ${got}`)
  }
  assert(!bad.length, bad.join(' | '))
  return `分支 ${runGit(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()} · 远端 ${remotes.join('/')}`
})

if (!SKIP_TESTS) {
  const suites = [
    ['dsh-fatfish 契约', 'dsh-fatfish', 'test/plugin.mjs'],
    ['dsh-fatfish 冒烟', 'dsh-fatfish', 'test/smoke.mjs'],
    ['dsh-fatfish 隐私', 'dsh-fatfish', 'test/privacy.mjs'],
    ['dsh-fatfish-hands 契约', 'dsh-fatfish-hands', 'test/plugin.mjs'],
  ]
  if (WITH_BROWSER) suites.push(['dsh-fatfish-hands 浏览器冒烟', 'dsh-fatfish-hands', 'test/smoke.mjs'])
  for (const [title, dir, script] of suites) {
    await check(title, () => {
      const res = run(process.execPath, [script], { cwd: path.join(bundleRoot, dir) })
      assert(res.code === 0, `${script} 失败：${res.all.trim().split('\n').filter((l) => l.includes('✘') || l.includes('Error')).slice(0, 3).join(' / ') || res.all.slice(-200)}`)
      return '通过'
    })
  }
} else {
  console.log('  \x1b[33m!\x1b[0m 已跳过测试（--skip-tests）')
}

await check('DSH 自带 node 加载插件入口', () => {
  const rt = dshRuntime()
  if (!rt) return '本机没装 DSH，跳过（系统 node 已跑过四套测试）'
  const entries = pkgs.map(({ dir, name }) => ({
    name,
    url: pathToFileURL(path.join(bundleRoot, dir, 'lib', 'index.js')).href,
  }))
  const probe = path.join(os.tmpdir(), `fatfish-host-probe-${process.pid}.mjs`)
  fs.writeFileSync(probe, `
const entries = ${JSON.stringify(entries)}
const out = []
for (const e of entries) {
  const m = await import(e.url)
  const shape = typeof m.apply === 'function' ? 'named' : (m.default && typeof m.default.apply === 'function' ? 'default' : 'none')
  out.push({ name: e.name, shape, inject: (shape === 'default' ? m.default.inject : m.inject) || null })
}
console.log(JSON.stringify(out))
`, 'utf8')
  const res = run(rt.node, [probe], { cwd: bundleRoot })
  fs.rmSync(probe, { force: true })
  assert(res.code === 0, `用 DSH 的 node ${rt.version} 加载失败：${res.stderr.trim().split('\n').slice(-2).join(' ') || res.all.slice(-200)}`)
  const loaded = parseJsonLoose(res.stdout)
  const bad = loaded.filter((m) => m.shape === 'none')
  assert(!bad.length, `${bad.map((m) => m.name).join('/')} 导出的不是 cordis 插件形态`)
  return `Node ${rt.version} · ${loaded.map((m) => `${m.name}:${m.shape}`).join(' · ')}`
})

await check('npm pack 白名单实测', () => {
  const launcher = npmLauncher()
  if (!launcher) return 'npm 不可用，跳过'
  const notes = []
  for (const { dir, name, version } of pkgs) {
    const res = runNpm(['pack', '--dry-run', '--json'], { cwd: path.join(bundleRoot, dir) })
    assert(res.code === 0, `${dir}: npm pack 失败 ${res.stderr.slice(0, 150) || res.stdout.slice(0, 150)}`)
    let json = parseJsonLoose(res.stdout)
    if (Array.isArray(json)) json = json[0]
    if (!json || !Array.isArray(json.files)) {
      const inner = Object.values(json || {}).find((v) => v && Array.isArray(v.files))
      assert(inner, `${dir}: 没解析出打包清单，npm 输出开头：${res.stdout.slice(0, 120).replace(/\s+/g, ' ')}`)
      json = inner
    }
    const listed = (json.files || []).map((f) => f.path)
    assert(listed.length > 0, `${dir}: 没解析出打包清单`)
    const leaked = listed.filter((f) => PACK_EXCLUDES.some((x) => f === x || f.startsWith(`${x}/`)))
    assert(!leaked.length, `${dir} 会夹带 ${leaked.join('/')}`)
    notes.push(`${name}@${version} ${listed.length} 文件/${(json.size / 1024).toFixed(1)} kB`)
  }
  return notes.join(' · ')
})

if (!OFFLINE) {
  await check('npm 版本号未被占用', () => {
    const taken = []
    for (const { name, version } of pkgs) {
      const res = runNpm(['view', `${name}@${version}`, 'version', '--registry', config.npmRegistry])
      const out = res.stdout.trim()
      if (res.code === 0 && out && out.includes(version)) taken.push(`${name}@${version} 已在 npm 上`)
    }
    assert(!taken.length, `${taken.join('；')} —— 版本号只能往前走，改 package.json 再自检`)
    return '两个号都能发'
  })

  await check('订阅地址状态', () => {
    const probe = path.join(os.tmpdir(), 'fatfish-feed-probe.json')
    const dead = []
    const pending = []
    const ok = []
    for (const url of config.feeds) {
      const res = run('curl', ['-sL', '--max-time', '25', '-o', probe, '-w', '%{http_code}', url])
      const code = res.stdout.trim()
      let good = code === '200'
      if (good && url.endsWith('signatures.json')) {
        try {
          const db = JSON.parse(fs.readFileSync(probe, 'utf8'))
          good = Boolean(db.processes && db.commandPatterns)
        } catch { good = false }
      }
      if (good) ok.push(url)
      else if (code === '404') pending.push(url)
      else dead.push(`${code || '无响应'} ${url}`)
    }
    fs.rmSync(probe, { force: true })
    assert(!dead.length, dead.join('\n     '))
    if (pending.length) {
      console.log(`  \x1b[33m!\x1b[0m 这几个源还是 404（还没推上仓库）：${pending.join(' ')}`)
      console.log('      推上去就好了 —— 一键上架结束时会自动复查，或加 --strict-feeds 再自检一次。')
      pendingFeeds = pending.length
      return `${ok.length} 个已通，${pending.length} 个待推（警告）`
    }
    return `${ok.length} 个源都通`
  })
} else {
  console.log('  \x1b[33m!\x1b[0m 已跳过联网检查（--offline）')
}

if (STRICT_FEEDS && pendingFeeds) {
  failures.push({ title: '订阅地址', reason: `还有 ${pendingFeeds} 个源是 404（--strict-feeds 视为不合格）` })
}

console.log('')
if (failures.length) {
  console.log(`\x1b[31m自检未通过：${failures.length} 项\x1b[0m`)
  for (const f of failures) console.log(`  · ${f.title}：${f.reason}`)
  console.log('\n修完再跑一次；上架脚本只在全绿时继续。')
  process.exit(1)
}
console.log(`\x1b[32m自检全绿（${pass} 项）\x1b[0m —— 可以跑 一键上架.bat`)
