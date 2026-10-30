import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  decodeBuffer,
  analyzeBuffer,
  lintDir,
  fixFile,
  fixDir,
  encodeGbk,
  IS_WIN,
} from '../lib/lint.js'
import * as plugin from '../lib/index.js'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'batch-doctor-'))
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  return file
}

function codes(report) {
  return report.issues.map((i) => i.code)
}

const GBK_ZHONGWEN = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]) // 中文

test('decodeBuffer：ASCII / UTF-8 / BOM / GBK / 二进制', () => {
  assert.equal(decodeBuffer(Buffer.from('@echo off\r\n')).encoding, 'ascii')
  const utf8 = decodeBuffer(Buffer.from('echo 你好\r\n', 'utf8'))
  assert.equal(utf8.encoding, 'utf8')
  assert.equal(utf8.text, 'echo 你好\r\n')
  const bom = decodeBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('echo 你好', 'utf8')]))
  assert.equal(bom.bom, true)
  assert.equal(bom.text, 'echo 你好')
  const gbk = decodeBuffer(GBK_ZHONGWEN)
  assert.equal(gbk.encoding, 'gbk')
  assert.equal(gbk.text, '中文')
  assert.equal(decodeBuffer(Buffer.from([0x61, 0x00, 0x62])).encoding, 'binary')
  assert.equal(decodeBuffer(Buffer.alloc(0)).encoding, 'empty')
})

test('体检：中文 UTF-8 批处理 -> bat-utf8', () => {
  const text = '@echo off\r\nchcp 65001 >nul\r\necho 你好\r\n'
  const report = analyzeBuffer('run.bat', Buffer.from(text, 'utf8'), { rel: 'run.bat' })
  assert.equal(report.encoding, 'utf8')
  assert.ok(codes(report).includes('bat-utf8'))
})

test('体检：GBK 文件配 chcp 65001 -> chcp-mismatch', () => {
  const buf = Buffer.concat([
    Buffer.from('@echo off\r\nchcp 65001 >nul\r\necho ', 'ascii'),
    GBK_ZHONGWEN,
    Buffer.from('\r\n', 'ascii'),
  ])
  const report = analyzeBuffer('run.cmd', buf, { rel: 'run.cmd' })
  assert.equal(report.encoding, 'gbk')
  assert.ok(codes(report).includes('chcp-mismatch'))
})

test('体检：中文 ps1 没有 BOM -> ps1-bom', () => {
  const report = analyzeBuffer('setup.ps1', Buffer.from('Write-Host "你好"\r\n', 'utf8'))
  assert.ok(codes(report).includes('ps1-bom'))
})

test('体检：LF 行尾 -> line-endings', () => {
  const report = analyzeBuffer('run.bat', Buffer.from('@echo off\nchcp 936 >nul\necho hi\n', 'utf8'))
  assert.ok(codes(report).includes('line-endings'))
})

test('体检：块内 echo 裸括号', () => {
  const text = '@echo off\r\nif exist x (\r\n  echo hello (world)\r\n)\r\n'
  const report = analyzeBuffer('run.bat', Buffer.from(text, 'utf8'))
  assert.ok(codes(report).includes('naked-paren'))
})

test('体检：可配置的写死路径', () => {
  const text = '@echo off\r\nset ROOT=F:\\111\\fish\r\n'
  const report = analyzeBuffer('run.bat', Buffer.from(text, 'utf8'), { stalePaths: ['F:\\\\111'] })
  assert.ok(codes(report).includes('stale-path'))
})

test('lintDir：跳过 node_modules 和非脚本', () => {
  const dir = tmpdir()
  write(path.join(dir, 'a.bat'), Buffer.from('@echo off\r\nchcp 65001 >nul\r\necho 你好\r\n', 'utf8'))
  write(path.join(dir, 'node_modules', 'bad.bat'), Buffer.from('echo 你好\r\n', 'utf8'))
  write(path.join(dir, 'readme.txt'), 'echo 你好')
  const result = lintDir(dir)
  assert.equal(result.scanned, 1)
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].rel, 'a.bat')
})

test('fixFile：预演不写盘', () => {
  const dir = tmpdir()
  const file = write(path.join(dir, 'run.bat'), Buffer.from('@echo off\r\nchcp 65001 >nul\r\necho 你好\r\n', 'utf8'))
  const before = fs.readFileSync(file)
  const result = fixFile(file, { mode: 'gbk', write: false, backup: true })
  assert.equal(result.changed, true)
  assert.equal(result.written, false)
  assert.deepEqual(fs.readFileSync(file), before)
  assert.equal(fs.existsSync(file + '.bak'), false)
})

test('fixFile：UTF-8 -> GBK，改 chcp、统一 CRLF、留备份', { skip: !IS_WIN }, () => {
  const dir = tmpdir()
  const file = write(path.join(dir, 'run.bat'), Buffer.from('@echo off\nchcp 65001 >nul\necho 你好\n', 'utf8'))
  const before = fs.readFileSync(file)
  const result = fixFile(file, { mode: 'gbk', write: true, backup: true })
  assert.equal(result.changed, true)
  assert.equal(result.written, true)
  const after = fs.readFileSync(file)
  const decoded = decodeBuffer(after)
  assert.equal(decoded.encoding, 'gbk')
  assert.match(decoded.text, /chcp 936/)
  assert.match(decoded.text, /echo 你好/)
  const lfOnly = (after.toString('latin1').match(/(?<!\r)\n/g) || []).length
  assert.equal(lfOnly, 0)
  assert.deepEqual(fs.readFileSync(file + '.bak'), before)
  assert.equal(fs.existsSync(file + '.tmp'), false)
})

test('fixFile：ps1 补 BOM', () => {
  const dir = tmpdir()
  const file = write(path.join(dir, 'setup.ps1'), Buffer.from('Write-Host "你好"\r\n', 'utf8'))
  const result = fixFile(file, { mode: 'utf8', write: true, backup: false })
  assert.equal(result.changed, true)
  const after = fs.readFileSync(file)
  assert.deepEqual([...after.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.match(after.subarray(3).toString('utf8'), /你好/)
})

test('fixDir：预演报告与写盘计数', { skip: !IS_WIN }, () => {
  const dir = tmpdir()
  write(path.join(dir, 'a.bat'), Buffer.from('@echo off\r\nchcp 65001 >nul\r\necho 你好\r\n', 'utf8'))
  write(path.join(dir, 'b.ps1'), Buffer.from('Write-Host "你好"\r\n', 'utf8'))
  const dry = fixDir(dir, { mode: 'gbk', write: false })
  assert.equal(dry.scanned, 2)
  assert.equal(dry.changed, 2)
  assert.equal(dry.written, 0)
  const real = fixDir(dir, { mode: 'gbk', write: true, backup: true })
  assert.equal(real.written, 2)
  assert.ok(fs.existsSync(path.join(dir, 'a.bat.bak')))
})

test('encodeGbk：中文往返', { skip: !IS_WIN }, () => {
  const out = encodeGbk('中文测试\r\n')
  assert.equal(decodeBuffer(out).text, '中文测试\r\n')
})

test('插件生命周期：注册工具与命令', async () => {
  const tools = new Map()
  const commands = new Map()
  const ctx = {
    command(name, desc, handler) {
      commands.set(name, handler)
      return () => {}
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => {}
      },
    },
    effect(fn) {
      fn()
      return () => {}
    },
    logger: () => ({ log() {} }),
  }
  plugin.apply(ctx, { mode: 'gbk' })
  assert.equal(tools.has('batch_doctor'), true)
  assert.equal(commands.has('batchdoctor.lint [dir]'), true)
  assert.equal(commands.has('batchdoctor.fix [dir]'), true)

  const dir = tmpdir()
  write(path.join(dir, 'run.bat'), Buffer.from('@echo off\r\nchcp 65001 >nul\r\necho 你好\r\n', 'utf8'))
  const tool = tools.get('batch_doctor')
  const lint = await tool.execute({ action: 'lint', dir })
  assert.equal(lint.action, 'lint')
  assert.ok(lint.errors >= 1)
  assert.match(lint.text, /run\.bat/)
  assert.deepEqual(tool.output.render({}, lint), [{ type: 'text', text: lint.text }])

  const dry = await tool.execute({ action: 'fix', dir, mode: 'gbk', write: false })
  assert.equal(dry.written, 0)
  const real = await tool.execute({ action: 'fix', dir, mode: 'gbk', write: true, backup: true })
  assert.equal(real.written, 1)
  assert.match(real.text, /实际写盘 1/)

  const check = await commands.get('batchdoctor.lint [dir]')(dir)
  assert.match(check, /脚本体检/)
})
