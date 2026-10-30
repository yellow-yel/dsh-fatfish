import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * devDependency 与宿主自带的 @deepseek-ai/dsh-llm 不一定导出同一批名字
 * （0.1.1 就是因为导入了宿主没有的 CallId 而装不上）。设置 DSH_HOST_LLM
 * 指向宿主的 lib/index.js 后，这个测试会按源码里真实的 import 名单核对。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles() {
  const lib = path.join(ROOT, 'lib')
  return [
    path.join(ROOT, 'index.js'),
    ...fs.readdirSync(lib).filter((name) => name.endsWith('.js')).map((name) => path.join(lib, name)),
  ]
}

function importedFromLlm() {
  const names = new Set()
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8')
    const re = /import\s*\{([^}]+)\}\s*from\s*['"]@deepseek-ai\/dsh-llm['"]/g
    let match
    while ((match = re.exec(text))) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim()
        if (name) names.add(name)
      }
    }
  }
  return [...names].sort()
}

test('插件用到的 dsh-llm 导出在宿主 bundle 里都存在', async (t) => {
  const names = importedFromLlm()
  assert.ok(names.length > 0, '没有解析到任何 import，正则可能已过期')

  const hostEntry = process.env.DSH_HOST_LLM
  if (!hostEntry) {
    t.skip('未设置 DSH_HOST_LLM=<宿主 dsh-llm/lib/index.js>，跳过宿主导出核对')
    return
  }

  const host = await import(pathToFileURL(path.resolve(hostEntry)).href)
  const missing = names.filter((name) => !(name in host))
  t.diagnostic(`宿主 ${hostEntry} 缺少：${missing.join(', ') || '(无)'}`)
  assert.deepEqual(missing, [])
})
