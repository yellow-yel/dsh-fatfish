/**
 * 手动发布 npm：node scripts/publish-npm.mjs [--skip-check] [--only <包名>]
 *
 * 这一步是不可撤回的（版本号发出去就占住了），所以脚本要求你打「发布」两个字确认，
 * 并且绝不替你决定版本号。
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { bundleRoot, config, pluginPackages, run, runNpm, redact, rel } from './lib.mjs'

const argv = process.argv.slice(2)
const SKIP_CHECK = argv.includes('--skip-check')
const onlyIndex = argv.indexOf('--only')
const ONLY = onlyIndex >= 0 ? argv[onlyIndex + 1] : ''

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => rl.question(q)

const authFile = config.npmAuthFile ? path.resolve(bundleRoot, config.npmAuthFile) : ''
const hasEnvToken = Boolean(process.env.NPM_TOKEN || process.env.npm_config__authToken)
const authArgs = authFile && fs.existsSync(authFile) ? ['--userconfig', authFile] : []

console.log(`\n大肥鱼 · 发布到 npm\n`)
if (!SKIP_CHECK) {
  const res = run(process.execPath, ['scripts/preflight.mjs'], { cwd: bundleRoot })
  process.stdout.write(res.all)
  if (res.code !== 0) { console.log('\n\x1b[31m自检没过，先不发。\x1b[0m'); rl.close(); process.exit(1) }
}

if (authArgs.length) console.log(`\n  登录凭据：${rel(authFile)}（文件在市场版目录外，不会进仓库）`)
else if (!hasEnvToken) console.log('\n  \x1b[33m!\x1b[0m 没找到 npm 令牌文件，也没有 NPM_TOKEN。发布前要么设环境变量，要么把令牌写进 上架配置.json 的 npmAuthFile 指向的文件。')

const pkgs = pluginPackages().filter((p) => !ONLY || p.name === ONLY)
const plan = []
for (const p of pkgs) {
  const probe = runNpm(['view', `${p.name}@${p.version}`, 'version', '--registry', config.npmRegistry], { cwd: bundleRoot })
  if (probe.code === 0 && probe.stdout.trim().includes(p.version)) {
    console.log(`  \x1b[33m!\x1b[0m ${p.name}@${p.version} 已经在 npm 上了 —— 跳过（版本号不能重用，要发改 package.json）`)
    continue
  }
  const tgz = path.join(bundleRoot, 'dist', `${p.name}-${p.version}.tgz`)
  if (!fs.existsSync(tgz)) {
    console.log(`  \x1b[33m!\x1b[0m 缺 ${rel(tgz)} —— 先跑 一键上架.bat（或 node scripts/release.mjs）生成产物`)
    continue
  }
  plan.push({ ...p, tgz })
  console.log(`  待发：${p.name}@${p.version} ← ${rel(tgz)}`)
}

if (!plan.length) { console.log('\n没有可发布的内容。'); rl.close(); process.exit(0) }

const otp = (process.env.NPM_OTP || '').trim() || (await ask('  npm 动态验证码（6 位，直接回车跳过）：')).trim()
const typed = await ask(`\n  确认发布 ${plan.map((p) => `${p.name}@${p.version}`).join(' + ')}？输入「发布」继续：`)
if (typed.trim() !== '发布') { console.log('\n  已取消，什么都没发。'); rl.close(); process.exit(0) }

let failed = 0
for (const p of plan) {
  const args = ['publish', p.tgz, '--access', 'public', '--registry', config.npmRegistry, ...authArgs]
  if (otp) args.push('--otp', otp)
  const res = runNpm(args, { cwd: bundleRoot })
  if (res.code === 0) {
    console.log(`  \x1b[32m✓\x1b[0m ${p.name}@${p.version} 已发布 → https://www.npmjs.com/package/${p.name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✘\x1b[0m ${p.name} 发布失败：\n${redact(res.all, [process.env.NPM_TOKEN, otp]).split('\n').slice(-8).join('\n')}`)
    if (/EOTP|two-factor|otp/i.test(res.all)) console.log('    （npm 要动态码：设 NPM_OTP 或重跑并输入 6 位码）')
    if (/403/.test(res.all)) console.log('    （403：令牌权限不够，或这个版本号已被待批准流程占住）')
    if (/Cannot publish over|409/.test(res.all)) console.log('    （409：同号已被占住，只能往前 bump 版本）')
  }
}
rl.close()
console.log(failed ? `\n${failed} 个没发出去，见上面原因。\n` : '\n发布完成。DSH 里 dsh plugin add <包名> 就能装了。\n')
process.exit(failed ? 1 : 0)
