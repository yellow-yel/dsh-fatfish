import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectTarget,
  looksValid,
  readConfig,
  writeConfig,
  heal,
  getPath,
  scanForMarker,
  defaultConfigFile,
} from '../lib/detect.js'
import * as plugin from '../lib/index.js'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'path-healer-'))
}

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'fake')
  return file
}

test('detectTarget：按 marker 在候选目录里找', () => {
  const dir = tmpdir()
  const exe = touch(path.join(dir, 'bin', 'my-tool.exe'))
  const found = detectTarget(
    { key: 'my-tool', marker: 'my-tool.exe', dirs: [path.join(dir, 'missing'), path.join(dir, 'bin')] },
    {},
  )
  assert.equal(path.resolve(found), path.resolve(exe))
})

test('looksValid：文件必须同名，目录里必须有 marker', () => {
  const dir = tmpdir()
  const target = { marker: 'python.exe' }
  assert.equal(looksValid(target, dir), false)
  const file = touch(path.join(dir, 'python.exe'))
  const wrong = touch(path.join(dir, 'python3.exe'))
  assert.equal(looksValid(target, file), true)
  assert.equal(looksValid(target, wrong), false)
  fs.unlinkSync(file)
  assert.equal(looksValid(target, dir), false)
  touch(path.join(dir, 'python.exe'))
  assert.equal(looksValid(target, dir), true)
  assert.equal(looksValid(target, path.join(dir, 'nope.exe')), false)
  assert.equal(looksValid(target, ''), false)
})

test('heal：补齐缺失项、保留原键、写前备份、不留 .tmp', () => {
  const dir = tmpdir()
  const exe = touch(path.join(dir, 'bin', 'fake-a.exe'))
  const configFile = path.join(dir, 'paths.json')
  fs.writeFileSync(configFile, JSON.stringify({ keep: 'untouched', custom: '' }, null, 2))
  const result = heal({
    configFile,
    write: true,
    targets: [{ key: 'custom', label: '自定义', marker: 'fake-a.exe', dirs: [path.join(dir, 'bin')] }],
  })
  assert.equal(result.written, true)
  assert.equal(result.changed, true)
  assert.equal(result.backup, configFile + '.bak')
  const entry = result.entries.find((e) => e.key === 'custom')
  assert.equal(entry.status, 'filled')
  assert.equal(path.resolve(entry.path), path.resolve(exe))
  const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  assert.equal(saved.keep, 'untouched')
  assert.equal(path.resolve(saved.custom), path.resolve(exe))
  assert.equal(saved._meta.tool, 'dsh-path-healer')
  assert.equal(fs.existsSync(configFile + '.tmp'), false)
  assert.equal(fs.existsSync(configFile + '.bak'), true)
})

test('heal：旧路径失效 -> moved，并写回新路径', () => {
  const dir = tmpdir()
  const exe = touch(path.join(dir, 'bin', 'fake-b.exe'))
  const configFile = path.join(dir, 'paths.json')
  fs.writeFileSync(configFile, JSON.stringify({ custom: path.join(dir, 'old', 'fake-b.exe') }))
  const result = heal({
    configFile,
    write: true,
    targets: [{ key: 'custom', label: '自定义', marker: 'fake-b.exe', dirs: [path.join(dir, 'bin')] }],
  })
  const entry = result.entries.find((e) => e.key === 'custom')
  assert.equal(entry.status, 'moved')
  assert.equal(path.resolve(entry.path), path.resolve(exe))
  assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).custom, exe)
})

test('heal：check 模式不落盘', () => {
  const dir = tmpdir()
  touch(path.join(dir, 'bin', 'fake-c.exe'))
  const configFile = path.join(dir, 'not-yet.json')
  const result = heal({
    configFile,
    write: false,
    targets: [{ key: 'custom', label: '自定义', marker: 'fake-c.exe', dirs: [path.join(dir, 'bin')] }],
  })
  assert.equal(result.changed, true)
  assert.equal(result.written, false)
  assert.equal(fs.existsSync(configFile), false)
})

test('heal：找不到就 missing，ok=false', () => {
  const dir = tmpdir()
  const configFile = path.join(dir, 'paths.json')
  const result = heal({
    configFile,
    write: true,
    targets: [{ key: 'ghost', label: '幽灵', marker: 'ghost-tool-xyz.exe', dirs: [dir] }],
  })
  const entry = result.entries.find((e) => e.key === 'ghost')
  assert.equal(entry.status, 'missing')
  assert.equal(result.ok, false)
  assert.equal(result.written, false)
})

test('配置文件：嵌套结构原样保留', () => {
  const dir = tmpdir()
  const exe = touch(path.join(dir, 'bin', 'fake-d.exe'))
  const configFile = path.join(dir, 'nested.json')
  fs.writeFileSync(configFile, JSON.stringify({
    version: 2,
    paths: { custom: '' },
    other: { a: 1 },
  }))
  const cfg = readConfig(configFile)
  assert.equal(cfg.nested, true)
  writeConfig(configFile, cfg, { custom: exe })
  const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  assert.equal(saved.version, 2)
  assert.deepEqual(saved.other, { a: 1 })
  assert.equal(saved.paths.custom, exe)
  assert.equal(saved.custom, undefined)
})

test('配置文件：坏 JSON 不崩，按空配置处理', () => {
  const dir = tmpdir()
  const configFile = path.join(dir, 'broken.json')
  fs.writeFileSync(configFile, '{not json')
  const cfg = readConfig(configFile)
  assert.deepEqual(cfg.paths, {})
  assert.equal(cfg.nested, false)
})

test('scanForMarker：尊重最大深度', () => {
  const root = tmpdir()
  touch(path.join(root, 'a', 'b', 'c', 'deep-tool.exe'))
  assert.equal(scanForMarker('deep-tool.exe', { roots: [root], maxDepth: 1 }), '')
  const found = scanForMarker('deep-tool.exe', { roots: [root], maxDepth: 4 })
  assert.equal(path.basename(found), 'deep-tool.exe')
})

test('getPath：只查不写', () => {
  const dir = tmpdir()
  touch(path.join(dir, 'bin', 'fake-e.exe'))
  const configFile = path.join(dir, 'paths.json')
  const found = getPath('custom', {
    configFile,
    targets: [{ key: 'custom', label: '自定义', marker: 'fake-e.exe', dirs: [path.join(dir, 'bin')] }],
  })
  assert.equal(path.basename(found), 'fake-e.exe')
  assert.equal(fs.existsSync(configFile), false)
})

test('默认配置文件在 ~/.dsh 下（遵守 DSH_HOME）', () => {
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = path.join(os.tmpdir(), 'dsh-home-test')
  try {
    assert.equal(defaultConfigFile(), path.join(process.env.DSH_HOME, 'path-healer.json'))
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
  }
})

test('插件生命周期：注册 1 个工具 + 3 个命令', async () => {
  const tools = new Map()
  const commands = new Map()
  const disposers = []
  const ctx = {
    command(name, desc, handler) {
      commands.set(name, handler)
      return () => commands.delete(name)
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
      return () => {}
    },
    logger: () => ({ log() {} }),
  }
  const dir = tmpdir()
  const configFile = path.join(dir, 'paths.json')
  plugin.apply(ctx, { configFile })
  assert.equal(tools.has('path_healer'), true)
  assert.equal(commands.has('pathhealer.check'), true)
  assert.equal(commands.has('pathhealer.repair'), true)
  assert.equal(commands.has('pathhealer.get <key>'), true)

  const tool = tools.get('path_healer')
  const result = await tool.execute({ action: 'get', key: 'node' })
  assert.equal(typeof result.text, 'string')
  assert.match(result.text, /node:/)
  assert.deepEqual(tool.output.render({}, result), [{ type: 'text', text: result.text }])

  const check = await commands.get('pathhealer.check')()
  assert.match(check, /环境路径体检/)
  assert.equal(fs.existsSync(configFile), false)
  for (const d of disposers) d()
  assert.equal(tools.size, 0)
})
