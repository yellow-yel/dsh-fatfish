/**
 * 一键上架：自检 → 对齐市场索引 → 提交打标签 → 推 Gitee+GitHub → 打包到 dist/
 * 结束时打印 npm publish 命令，发布这一步留给你手动确认。
 *
 *   node scripts/release.mjs [--dry-run] [--skip-check] [--yes] [--message "..."]
 *                            [--no-push] [--topics]
 *
 * 边界：脚本只推 上架配置.json 里写明的两个远端，绝不执行 npm publish，
 * 也绝不改写 git 历史或强推。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import {
  bundleRoot, config, pluginPackages, readJson, writeJson, rel,
  run, runGit, runNpm, tokenFor, urlWithToken, redact,
} from './lib.mjs'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const SKIP_CHECK = argv.includes('--skip-check')
const ASSUME_YES = argv.includes('--yes')
const NO_PUSH = argv.includes('--no-push')
const WANT_TOPICS = argv.includes('--topics')
const msgIndex = argv.indexOf('--message')
const CUSTOM_MSG = msgIndex >= 0 ? argv[msgIndex + 1] : ''

const rl = ASSUME_YES || DRY ? null : readline.createInterface({ input: process.stdin, output: process.stdout })
async function ask(question) {
  if (ASSUME_YES) return 'y'
  if (!rl) { console.log(`  ${question} [非交互模式，跳过]`); return 'n' }
  const answer = (await rl.question(`  ${question} [y/N] `)).trim().toLowerCase()
  return answer === 'y' || answer === 'yes' ? 'y' : 'n'
}

const say = (...lines) => console.log(...lines)
function die(msg) {
  console.log(`\n\x1b[31m停下：\x1b[0m${msg}`)
  rl?.close()
  process.exit(1)
}

const pkgs = pluginPackages()
const branch = config.branch || 'master'
say(`\n大肥鱼 · 一键上架${DRY ? '（预演，不写不外发）' : ''}\n目录：${bundleRoot}`)
for (const p of pkgs) say(`  · ${p.name}@${p.version}`)

// 1. 自检
if (!SKIP_CHECK) {
  say('\n[1/6] 上架自检')
  const res = run(process.execPath, ['scripts/preflight.mjs', ...(DRY ? ['--offline'] : [])], { cwd: bundleRoot })
  process.stdout.write(res.all)
  if (res.code !== 0) die('自检没过。修完再跑，或加 --skip-check 强行跳过（不建议）。')
} else {
  say('\n[1/6] 自检已跳过（--skip-check）')
}

// 2. 市场索引对齐包版本
say('\n[2/6] 对齐 market-index.json')
{
  const file = path.join(bundleRoot, 'market-index.json')
  const idx = readJson(file)
  const stamp = Math.floor(Date.now() / 1000)
  const changes = []
  for (const { name, version } of pkgs) {
    const entry = idx.plugins.find((p) => p.name === name)
    if (!entry) { changes.push(`补条目 ${name}@${version}`); idx.plugins.push({ name, title: { en: name, zh: name }, description: { en: '', zh: '' }, homepage: config.feeds[0] ? config.feeds[0].replace(/\/[^/]*$/, '') : '', repository: { url: (config.remotes.github || '').replace(/\.git$/, '') }, metadata: { category: 'fun', keywords: [], labels: {}, sortKeys: {} }, versions: [{ version, publishTimestamp: stamp, source: { type: 'npm' }, engines: {} }] }); continue }
    const current = entry.versions.find((v) => v.version === version)
    if (!current) {
      entry.versions = [{ version, publishTimestamp: stamp, source: { type: 'npm' }, engines: {} }]
      changes.push(`${name} → ${version}`)
    } else if (entry.versions.length > 1 || current.publishTimestamp !== stamp) {
      entry.versions = [current]
      current.publishTimestamp = stamp
      changes.push(`${name}@${version} 时间戳刷新`)
    }
  }
  say(changes.length ? `  ${changes.join(' · ')}` : '  已经一致，不用动')
  if (changes.length && !DRY) writeJson(file, idx)
  else if (changes.length) say('  （预演模式，没写文件）')
}

// 3. git 仓库
say('\n[3/6] git 提交与标签')
if (!fs.existsSync(path.join(bundleRoot, '.git'))) {
  say('  没有 .git —— 初始化并挂上远端')
  if (DRY) { say('  （预演模式，跳过初始化）') } else {
    runGit(['init', '-b', branch])
    for (const [name, url] of Object.entries(config.remotes)) runGit(['remote', 'add', name, url])
  }
}
for (const [name, url] of Object.entries(config.remotes)) {
  const have = runGit(['remote', 'get-url', name])
  if (have.code !== 0) {
    if (DRY) { say(`  会新增远端 ${name}`); continue }
    runGit(['remote', 'add', name, url])
    say(`  已新增远端 ${name}`)
  } else {
    const clean = (s) => s.replace(/\/\/[^@/]*@/, '//')
    if (clean(have.stdout.trim()) !== clean(url)) say(`  \x1b[33m!\x1b[0m 远端 ${name} 指向 ${have.stdout.trim()}，与配置里的 ${url} 不同 —— 保持不动，你自己确认哪个对`)
  }
}

if (runGit(['rev-parse', '--git-dir']).code !== 0) die('当前目录还不是 git 仓库，无法提交。')

const identity = runGit(['config', 'user.name'])
if (identity.code !== 0 || !identity.stdout.trim()) {
  die('仓库没配提交身份。先跑：\n  git -c safe.directory=<市场版路径> config user.name "你的名字"\n  git -c safe.directory=<市场版路径> config user.email "你的noreply邮箱"')
}
say(`  提交身份：${runGit(['config', 'user.name']).stdout.trim()} <${runGit(['config', 'user.email']).stdout.trim()}>`)

runGit(['add', '-A'])
const staged = runGit(['diff', '--cached', '--name-status']).stdout.split(/\r?\n/).filter(Boolean)
const shortStatus = runGit(['status', '--short']).stdout.split(/\r?\n/).filter(Boolean)
say(`  待提交 ${staged.length} 项变更`)
for (const line of staged.slice(0, 12)) say(`    ${line}`)
if (staged.length > 12) say(`    … 其余 ${staged.length - 12} 项`)
const deletes = shortStatus.filter((l) => l.startsWith(' D') || l.startsWith('D '))
if (deletes.length) say(`  \x1b[33m!\x1b[0m 有 ${deletes.length} 个删除：${deletes.map((d) => d.slice(2).trim().replace(/^"|"$/g, '')).join(', ')}`)

const defaultMessage = `release: ${pkgs.map((p) => `${p.name} v${p.version}`).join(' · ')}（市场版打包，自检全绿）`
const message = CUSTOM_MSG || defaultMessage
if (DRY) {
  say(`  会提交：${message}`)
  if (deletes.length) say('  预演模式不会真提交，正式跑之前请先看上面这份删除清单。')
} else if (staged.length) {
  if (!ASSUME_YES) {
    const ok = await ask(`确认提交这 ${staged.length} 项变更？`)
    if (ok !== 'y') die('你取消了提交。')
  }
  const commit = runGit(['commit', '-m', message])
  if (commit.code !== 0) die(`提交失败：${redact(commit.all, secrets()).slice(-400)}`)
  say(`  已提交 ${runGit(['rev-parse', '--short', 'HEAD']).stdout.trim()}`)
} else {
  say('  工作树与 HEAD 一致，跳过提交（只补标签和推送）')
}

function secrets() {
  return Object.keys(config.remotes).map((r) => tokenFor(r)?.value).filter(Boolean)
}

// 4. 标签
say('\n[4/6] 标签')
const tags = pkgs.map((p) => `${p.name}-v${p.version}`)
for (const tag of tags) {
  const exists = runGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`])
  const head = runGit(['rev-parse', 'HEAD']).stdout.trim()
  if (exists.code === 0 && exists.stdout.trim() !== head) {
    say(`  \x1b[33m!\x1b[0m ${tag} 已指向别的提交，不动它（版本号请往前走吧）`)
  } else if (exists.code === 0) {
    say(`  ${tag} 已在当前提交`)
  } else if (DRY) {
    say(`  会打标签 ${tag}`)
  } else {
    const res = runGit(['tag', '-a', tag, '-m', `${tag}`])
    say(res.code === 0 ? `  已打标签 ${tag}` : `  \x1b[31m✘\x1b[0m ${tag} 失败：${res.stderr.slice(0, 120)}`)
  }
}

// 5. 推送
say('\n[5/6] 推送到远端')
if (NO_PUSH) {
  say('  已按 --no-push 跳过')
} else {
  for (const name of config.pushOrder || Object.keys(config.remotes)) {
    const url = config.remotes[name]
    if (!url) { say(`  \x1b[33m!\x1b[0m 配置里没有远端 ${name}，跳过`); continue }
    if (DRY) {
      say(`  会执行：git push ${name} ${branch} --follow-tags → ${url.replace(/\/\/[^@/]*@/, '//<凭据>@')}`)
      continue
    }
    let res = runGit(['push', name, branch, '--follow-tags'])
    const needAuth = res.code !== 0 && /authentication|could not read Username|403|401|permission/i.test(res.stderr + res.stdout)
    const tk = needAuth ? tokenFor(name) : null
    if (tk) {
      say(`  直推失败，改用本地令牌文件 ${tk.from}（只用于本次命令，不落盘、不打印）`)
      res = runGit(['push', urlWithToken(url, tk.value), branch, '--follow-tags'])
    }
    const shown = redact(res.all, [tk?.value, ...secrets()])
    if (res.code === 0) say(`  \x1b[32m✓\x1b[0m ${name} 推好了`)
    else say(`  \x1b[31m✘\x1b[0m ${name} 推送失败：\n${shown.split('\n').slice(-6).join('\n')}`)
    if (res.code !== 0 && !tk) say('    提示：可以设环境变量 GITEE_TOKEN / GITHUB_TOKEN，或确认 上架配置.json 的 tokenFiles 路径')
  }
  if (!DRY) verifyFeeds()
}

// 6. 打包产物
say('\n[6/6] npm 打包产物')
const dist = path.join(bundleRoot, 'dist')
if (!DRY) fs.mkdirSync(dist, { recursive: true })
const artifacts = []
for (const p of pkgs) {
  if (DRY) { say(`  会执行：npm pack --pack-destination dist（${p.dir}）`); continue }
  const res = runNpm(['pack', '--pack-destination', dist], { cwd: path.join(bundleRoot, p.dir) })
  const file = (res.stdout.match(/(\S+\.tgz)/) || [])[1]
  if (res.code === 0 && file) { artifacts.push(path.join(dist, path.basename(file))); say(`  \x1b[32m✓\x1b[0m ${rel(path.join(dist, path.basename(file)))}`) }
  else say(`  \x1b[31m✘\x1b[0m ${p.name} 打包失败：${res.all.slice(-200)}`)
}

if (WANT_TOPICS) await setTopics()

say('\n' + '='.repeat(64))
say('准备就绪。发布 npm 由你自己按下一键，脚本不会替你发：')
say('')
for (const p of pkgs) {
  const tgz = artifacts.find((a) => path.basename(a).startsWith(`${p.name}-`))
  say(`  npm publish --access public${tgz ? ` "${tgz}"` : `  # ${p.name}@${p.version}`}`)
}
say('')
say('  或者直接双击 发npm.bat（它会先查版本号有没有被占用，再问你要 6 位动态码）。')
say('')
say('  发布规矩（踩过坑的）：')
say('   · npm 的令牌不要勾「绕过 2FA」，否则发布先进待批准队列（0.0.0-stage），同版本号重发会 409。')
say('   · 已发出去的版本号不能重用，改代码先 bump 版本。')
say('   · GitHub 网页偶尔抽风，api.github.com 一般还通；推送失败先看这个。')
say('   · 病毒库订阅地址必须是 https 且返回 200，别人 updateSignatures 才拿得到。')
say('='.repeat(64))
rl?.close()

function verifyFeeds() {
  say('\n  复查订阅地址（推上去之后应当全是 200）：')
  const probe = path.join(os.tmpdir(), 'fatfish-feed-check.json')
  for (const url of config.feeds || []) {
    const res = run('curl', ['-sL', '--max-time', '25', '-o', probe, '-w', '%{http_code}', url])
    const code = res.stdout.trim()
    say(`    ${code === '200' ? '\x1b[32m200\x1b[0m' : `\x1b[31m${code || '无响应'}\x1b[0m`} ${url}`)
  }
  fs.rmSync(probe, { force: true })
}

async function setTopics() {
  const tk = tokenFor('github')
  if (!tk) { say('\n  设置 GitHub topic 需要令牌（环境变量 GITHUB_TOKEN 或配置里的令牌文件）'); return }
  const repo = (config.remotes.github || '').match(/github\.com\/([^/]+\/[^/.]+)/)?.[1]
  if (!repo) { say('\n  配置里没有 GitHub 仓库地址，跳过 topic 设置'); return }
  say(`\n  DSH 市场按 topic 收录，当前配置：${(config.githubTopics || []).join(', ')}`)
  const ok = await ask(`要把这些 topic 写到 ${repo} 上吗？（会改公开仓库的元信息）`)
  if (ok !== 'y') { say('  已跳过，你可以手动在 GitHub → Settings → Topics 加 dsh-plugin'); return }
  const res = run('curl', [
    '-s', '-X', 'PUT', `https://api.github.com/repos/${repo}/topics`,
    '-H', `Authorization: Bearer ${tk.value}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify(config.githubTopics || []),
  ])
  const out = redact(res.stdout, [tk.value])
  say(out.trim() ? `  ${out.trim().split('\n')[0].slice(0, 200)}` : '  已提交')
}
