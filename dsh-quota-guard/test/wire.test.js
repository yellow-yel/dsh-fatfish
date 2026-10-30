import test from 'node:test'
import assert from 'node:assert/strict'
import { toWireMessages, buildBody, mapUsage, mapFinish, StreamAssembler, readSSE } from '../lib/wire.js'

const message = (role, content, source = { kind: 'user' }) => ({ id: 'm', role, content, source })

test('toWireMessages 保留 system、工具调用与工具结果', () => {
  const wire = toWireMessages({
    system: '你是助手',
    messages: [
      message('user', [{ type: 'text', text: '读文件' }]),
      message('assistant', [
        { type: 'text', text: '好的' },
        { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"path":"a"}' },
      ], { kind: 'model' }),
      message('user', [
        { type: 'tool-result', toolCallId: 'call_1', content: [{ type: 'text', text: '内容' }] },
      ], { kind: 'tool', callId: 'call_1' }),
    ],
  })
  assert.deepEqual(wire, [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '读文件' },
    {
      role: 'assistant',
      content: '好的',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '内容' },
  ])
})

test('纯工具调用的 assistant 消息 content 为 null', () => {
  const wire = toWireMessages({
    messages: [message('assistant', [
      { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{}' },
    ], { kind: 'model' })],
  })
  assert.equal(wire[0].content, null)
  assert.equal(wire[0].tool_calls.length, 1)
})

test('图片输入明确拒绝而不是悄悄丢掉', () => {
  assert.throws(
    () => toWireMessages({ messages: [message('user', [{ type: 'image', attachment: {} }])] }),
    (error) => error.code === 'UNSUPPORTED_OPTION',
  )
})

test('buildBody 只在有工具时带 tools', () => {
  const plain = buildBody({ messages: [] }, 'qwen-flash')
  assert.equal(plain.model, 'qwen-flash')
  assert.equal(plain.stream, true)
  assert.deepEqual(plain.stream_options, { include_usage: true })
  assert.equal(plain.tools, undefined)

  const withTool = buildBody({
    messages: [],
    temperature: 0.2,
    maxTokens: 128,
    stop: ['<end>'],
    tools: [{ name: 'read', description: '读', parameters: { type: 'object' } }],
  }, 'qwen-flash')
  assert.equal(withTool.temperature, 0.2)
  assert.equal(withTool.max_tokens, 128)
  assert.deepEqual(withTool.stop, ['<end>'])
  assert.equal(withTool.tools[0].function.name, 'read')
  assert.equal(withTool.tool_choice, 'auto')
})

test('mapUsage 把缓存 token 从输入里扣掉，保持互斥计数', () => {
  const usage = mapUsage({
    prompt_tokens: 100,
    completion_tokens: 40,
    prompt_tokens_details: { cached_tokens: 30 },
    completion_tokens_details: { reasoning_tokens: 12 },
  })
  assert.deepEqual(usage, {
    inputTokens: 70,
    outputTokens: 40,
    cacheReadTokens: 30,
    reasoningTokens: 12,
  })
  assert.equal(mapUsage({}), null)
})

test('mapFinish 覆盖常见结束原因', () => {
  assert.deepEqual(mapFinish('length', false), { kind: 'max-tokens' })
  assert.deepEqual(mapFinish('tool_calls', false), { kind: 'tool-calls' })
  assert.deepEqual(mapFinish(null, true), { kind: 'tool-calls' })
  assert.deepEqual(mapFinish('stop', false), { kind: 'stop' })
})

test('StreamAssembler 组装文本与多个并行工具调用', () => {
  const asm = new StreamAssembler()
  const chunks = []
  chunks.push(...asm.text('你'))
  chunks.push(...asm.text('好'))
  chunks.push(...asm.toolCall({ index: 0, id: 'call_a', function: { name: 'read', arguments: '{"pa' } }))
  chunks.push(...asm.toolCall({ index: 1, id: 'call_b', function: { name: 'list', arguments: '{}' } }))
  chunks.push(...asm.toolCall({ index: 0, function: { arguments: 'th":"x"}' } }))
  chunks.push(...asm.close())

  const ends = chunks.filter((chunk) => chunk.type === 'block-end')
  assert.equal(ends.length, 3)
  assert.deepEqual(ends[0].block, { type: 'text', text: '你好' })
  assert.equal(ends[1].block.name, 'read')
  assert.equal(ends[1].block.arguments, '{"path":"x"}')
  assert.equal(ends[2].block.name, 'list')

  const starts = chunks.filter((chunk) => chunk.type === 'block-start').map((chunk) => chunk.blockType)
  assert.deepEqual(starts, ['text', 'tool-call', 'tool-call'])
})

test('readSSE 解析 data 行、忽略注释并正确处理 [DONE]', async () => {
  const payload = [
    ': keep-alive',
    'data: {"a":1}',
    '',
    'event: message',
    'data: {"b":2}',
    '',
    'data: [DONE]',
    '',
    '',
  ].join('\n')
  const body = new Response(payload).body
  const events = []
  for await (const event of readSSE(body)) events.push(event)
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }])
})
