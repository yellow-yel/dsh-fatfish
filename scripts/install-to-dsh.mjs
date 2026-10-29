/**
 * 本地安装 / 卸载到 DSH，用于装好后立刻在真机上验证。
 *
 *   node scripts/install-to-dsh.mjs [profile路径]     安装（自动找 ~/.dsh/profiles/desktop）
 *   node scripts/install-to-dsh.mjs --remove          卸载（还原 package.json 与 patch，备份保留）
 *
 * 只动 DSH 配置目录里的大肥鱼相关内容，改之前都会留 .bak-<时间戳>。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bundleRoot, pluginPackages } from './lib.mjs'

const argv = process.argv.slice(2)
const REMOVE = argv.includes('--remove')
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

function fail(msg) {
  console.error(`\n[失败] ${msg}`)
  process.exit(1)
}

function hasProfile(dir) {
  return fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'cordis.patch.yml'))
}

function findProfile() {
  const given = argv.find((a) => !a.startsWith('--'))
  if (given) {
    const dir = path.resolve(given)
    if (!hasProfile(dir)) fail(`指定的 DSH 配置目录里没有 package.json 也没有 cordis.patch.yml：${dir}`)
    return dir
  }
  const root = path.join(os.homedir(), '.dsh', 'profiles')
  const desktop = path.join(root, 'desktop')
  if (hasProfile(desktop)) return desktop
  if (fs.existsSync(root)) {
    const found = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && hasProfile(path.join(root, d.name)))
      .map((d) => path.join(root, d.name))
    if (found.length === 1) return found[0]
    if (found.length > 1) fail(`找到多个 DSH 配置，请把其中一个作为参数传进来：\n${found.join('\n')}`)
  }
  fail('没找到 DSH 配置目录。先启动一次 DSH，或把 profile 路径当参数传进来。')
}

function backup(file) {
  if (!fs.existsSync(file)) return null
  const target = `${file}.bak-${stamp}`
  fs.copyFileSync(file, target)
  console.log(`  已备份 ${path.basename(file)} → ${path.basename(target)}`)
  return target
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    fail(`${file} 不是合法 JSON：${err.message}`)
  }
}

const COPY_SKIP = /(^|[\\/])(node_modules|\.git|test|config|dist|__pycache__)([\\/]|$)/
const SECRET_FILES = /(^|[\\/])(\.env|\.npmrc)$/

const profile = findProfile()
const pkgs = pluginPackages()
const pkgFile = path.join(profile, 'package.json')
const patchFile = path.join(profile, 'cordis.patch.yml')
const pnpmManaged = fs.existsSync(path.join(profile, 'node_modules', '.modules.yaml'))
console.log(`\nDSH 配置目录：${profile}`)

/** profile 里缺的文件按 DSH 的骨架补上；DSH 自己在首次启动时会写全基础 bundle */
function ensureProfileFiles() {
  if (!fs.existsSync(pkgFile)) {
    fs.writeFileSync(pkgFile, `${JSON.stringify({
      name: `dsh-profile-${path.basename(profile)}`,
      private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }, null, 2)}\n`, 'utf8')
    console.log('  profile 里还没有 package.json（DSH 没在这里完整启动过）→ 已按 DSH 骨架新建（bundles 含 dsh-base）')
  }
  if (!fs.existsSync(patchFile)) {
    fs.writeFileSync(patchFile, '', 'utf8')
    console.log('  profile 里还没有 cordis.patch.yml → 已新建空文件')
  }
}

if (REMOVE) {
  console.log('\n卸载大肥鱼插件')
  const profilePkg = fs.existsSync(pkgFile) ? readJson(pkgFile) : { dsh: { profile: { bundles: [] } } }
  const bundles = Array.isArray(profilePkg?.dsh?.profile?.bundles) ? profilePkg.dsh.profile.bundles : []
  let changed = false
  for (const { name } of pkgs) {
    const dest = path.join(profile, 'node_modules', name)
    if (fs.existsSync(dest)) {
      const trash = `${dest}.removed-${stamp}`
      fs.renameSync(dest, trash)
      console.log(`  已挪走 ${name} → ${path.basename(trash)}`)
    }
    const at = bundles.indexOf(name)
    if (at >= 0) { bundles.splice(at, 1); changed = true }
  }
  if (changed) {
    backup(pkgFile)
    profilePkg.dsh.profile.bundles = bundles
    fs.writeFileSync(pkgFile, JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
    console.log('  已从 bundles 列表移除')
  }
  if (fs.existsSync(patchFile)) {
    const markers = fs.readFileSync(patchFile, 'utf8').split(/\r?\n/)
      .map((line, i) => ({ line, i })).filter(({ line }) => /^#\s*dsh-fatfish(?:-hands)?\s+\(added/.test(line))
    if (markers.length) {
      console.log(`  \x1b[33m!\x1b[0m patch 里还留着 ${markers.length} 段大肥鱼配置（行 ${markers.map((m) => m.i + 1).join('/')}）`)
      console.log('     每个人对 patch 的改法不一样，脚本不猜——请手动删掉对应的 - insert: 段（已备份 .bak- 文件，改坏可还原）')
    } else {
      console.log('  patch 里没有脚本写进去的大肥鱼段')
    }
  }
  console.log('\n[完成] 重启 DSH 生效。记忆和缓存还在 ~/.dsh/fatfish* 里，想清空自己删目录。')
  process.exit(0)
}

ensureProfileFiles()

const installed = []
for (const { dir, name, version } of pkgs) {
  const src = path.join(bundleRoot, dir)
  if (!fs.existsSync(path.join(src, 'cordis.patch.yml'))) fail(`${dir} 缺 cordis.patch.yml`)
  const dest = path.join(profile, 'node_modules', name)
  if (fs.existsSync(dest)) {
    const old = `${dest}.bak-${stamp}`
    try {
      fs.renameSync(dest, old)
      console.log(`  已挪走旧版 ${name} → ${path.basename(old)}`)
    } catch {
      fs.rmSync(dest, { recursive: true, force: true })
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true, filter: (s) => !COPY_SKIP.test(s) && !SECRET_FILES.test(s) })
  if (!fs.existsSync(path.join(dest, 'package.json'))) fail(`${name} 复制后校验失败`)
  installed.push({ name, version, dest, src })
  console.log(`  已复制 ${name} ${version} → ${dest}`)
}

const profilePkg = readJson(pkgFile)
profilePkg.dsh = profilePkg.dsh || {}
profilePkg.dsh.profile = profilePkg.dsh.profile || {}
const bundles = Array.isArray(profilePkg.dsh.profile.bundles) ? profilePkg.dsh.profile.bundles : []
let pkgChanged = false
for (const { name } of installed) {
  if (!bundles.includes(name)) { bundles.push(name); pkgChanged = true }
}
profilePkg.dsh.profile.bundles = bundles
if (pkgChanged) {
  backup(pkgFile)
  fs.writeFileSync(pkgFile, JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
  console.log('  已写入 profile 的 bundles 列表')
} else {
  console.log('  bundles 已包含这两个插件')
}

let patch = fs.readFileSync(patchFile, 'utf8')
if (!patch.endsWith('\n')) patch += '\n'
let patchChanged = false
for (const { name, src } of installed) {
  const idRe = new RegExp(`^\\s*-\\s*id:\\s*['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm')
  if (idRe.test(patch)) { console.log(`  patch 已有 ${name}，跳过`); continue }
  const block = fs.readFileSync(path.join(src, 'cordis.patch.yml'), 'utf8')
  const at = block.indexOf('- insert:')
  if (at < 0) fail(`${name} 的 cordis.patch.yml 没有 insert 段`)
  patch += `\n# ${name} (added ${stamp})\n${block.slice(at).trim()}\n`
  patchChanged = true
  console.log(`  已追加 ${name} 的 insert 配置`)
}
if (patchChanged) {
  backup(patchFile)
  fs.writeFileSync(patchFile, patch, 'utf8')
}

console.log('\n[完成] 插件已装进 DSH 配置。')
if (pnpmManaged) {
  console.log('  \x1b[33m!\x1b[0m 这个 profile 的 node_modules 由 pnpm 托管，下次跑 pnpm install 会把直接拷进去的目录清掉。')
  console.log('    长期用法：发布后在 DSH 里 `dsh plugin --profile desktop add dsh-fatfish`，或走市场安装。')
}
console.log('  1. 重启 DSH（或往 cordis.patch.yml 追加一行 "# reload" 触发热重载）')
console.log('  2. 设置 → 插件 → 大肥鱼 / 大肥鱼之手 调选项')
console.log('  3. 卸载：node scripts/install-to-dsh.mjs --remove')
