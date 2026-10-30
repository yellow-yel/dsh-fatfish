import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { PoolAdapter } from '../lib/adapter.js'
import { normalizeConfig } from '../lib/config.js'

process.env.TEST_POOL_KEY = 'sk-test-key'

function startServer(handle) {
  const calls = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {}
      calls.push({ url: req.url, body: parsed })
      handle(req, res, parsed, calls.length)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, calls, base: `http://127.0.0.1:${port}` })
    })
  })
}

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

function adapterFor(pool, extra = {}) {
  const cfg = normalizeConfig({ pool })
  return new PoolAdapter({ ...cfg.pool, ...extra })
}

const userMessage = (text) => ({
  id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' },
})

test('首个账号限流时自动切到下一个账号并正常输出', async () => {
  const { server, calls, base } = await startServer((req, res) => {
    if (req.url.startsWith('/a/')) {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'rate limited', code: '429' } }))
      return
    }
    sse(res, [
      { choices: [{ delta: { content: '你' } }] },
      { choices: [{ delta: { content: '好' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } },
      },
    ])
  })

  const switched = []
  const adapter = adapterFor({
    provider: 'guard-pool',
    accounts: [
      { id: 'a', baseURL: `${base}/a`, apiKeyEnv: 'TEST_POOL_KEY', models: ['qwen-flash'] },
      { id: 'b', baseURL: `${base}/b`, apiKeyEnv: 'TEST_POOL_KEY', models: ['qwen-flash'] },
    ],
  }, { onSwitch: (from, to) => switched.push({ from, to }) })

  const chunks = []
  try {
    for await (const chunk of adapter.stream({
      provider: 'guard-pool', model: 'qwen-flash', messages: [userMessage('hi')],
    })) chunks.push(chunk)
  } finally {
    server.close()
  }

  const text = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
  assert.equal(text, '你好')
  const usage = chunks.find((c) => c.type === 'usage')
  assert.deepEqual(usage.usage, { inputTokens: 6, outputTokens: 2, cacheReadTokens: 4 })
  const finish = chunks.find((c) => c.type === 'finish')
  assert.deepEqual(finish.reason, { kind: 'stop' })

  assert.equal(calls.length, 2)
  assert.equal(calls[1].body.stream, true)
  assert.deepEqual(calls[1].body.stream_options, { include_usage: true })
  assert.equal(switched.length, 1)
  assert.match(switched[0].from, /^a\/qwen-flash/)
  assert.equal(switched[0].to, 'b/qwen-flash')
})

test('账号返回工具调用分片时组装成 tool-call 块', async () => {
  const { server, base } = await startServer((req, res) => {
    sse(res, [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read', arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"x"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])
  })

  const adapter = adapterFor({
    provider: 'guard-pool',
    accounts: [{ id: 'only', baseURL: `${base}/p`, apiKeyEnv: 'TEST_POOL_KEY', models: ['qwen-flash'] }],
  })

  const chunks = []
  try {
    for await (const chunk of adapter.stream({
      provider: 'guard-pool', model: 'qwen-flash', messages: [userMessage('读文件')],
      tools: [{ name: 'read', description: '读', parameters: { type: 'object' } }],
    })) chunks.push(chunk)
  } finally {
    server.close()
  }

  const end = chunks.find((c) => c.type === 'block-end')
  assert.deepEqual(end.block, { type: 'tool-call', id: 'call_a', name: 'read', arguments: '{"path":"x"}' })
  assert.deepEqual(chunks.at(-1).reason, { kind: 'tool-calls' })
})

test('全部账号失败时抛出带尝试明细的错误', async () => {
  const { server, base } = await startServer((req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'quota exceeded', code: '429' } }))
  })

  const adapter = adapterFor({
    provider: 'guard-pool',
    accounts: [
      { id: 'a', baseURL: `${base}/a`, apiKeyEnv: 'TEST_POOL_KEY', models: ['qwen-flash'] },
      { id: 'c', baseURL: `${base}/c`, apiKeyEnv: 'TEST_POOL_KEY', models: ['qwen-flash'] },
    ],
    maxAttempts: 2,
  })

  try {
    await assert.rejects(async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.stream({
        provider: 'guard-pool', model: 'qwen-flash', messages: [userMessage('hi')],
      })) { /* 不会产出 */ }
    }, (error) => {
      assert.equal(error.code, 'GUARD_POOL_EXHAUSTED')
      assert.match(error.message, /a\/qwen-flash/)
      assert.match(error.message, /c\/qwen-flash/)
      return true
    })
  } finally {
    server.close()
  }
})

test('池里没有该模型时明确报错而不是乱换模型', async () => {
  const adapter = adapterFor({
    provider: 'guard-pool',
    accounts: [{ id: 'a', baseURL: 'http://127.0.0.1:9/a', apiKeyEnv: 'TEST_POOL_KEY', models: ['qwen-flash'] }],
  })
  await assert.rejects(async () => {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of adapter.stream({
      provider: 'guard-pool', model: 'qwen-max', messages: [userMessage('hi')],
    })) { /* 不会产出 */ }
  }, (error) => error.code === 'GUARD_POOL_NO_MODEL')
})

test('fallback 链只在显式配置时生效', async () => {
  const { server, calls, base } = await startServer((req, res, body) => {
    if (body.model === 'qwen-max') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'model not found', code: 'model_not_found' } }))
      return
    }
    sse(res, [{ choices: [{ delta: { content: 'ok' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }])
  })

  const adapter = adapterFor({
    provider: 'guard-pool',
    accounts: [{ id: 'a', baseURL: `${base}/a`, apiKeyEnv: 'TEST_POOL_KEY', models: ['qwen-max', 'qwen-flash'] }],
    fallback: { 'qwen-max': ['qwen-flash'] },
  })

  const chunks = []
  try {
    for await (const chunk of adapter.stream({
      provider: 'guard-pool', model: 'qwen-max', messages: [userMessage('hi')],
    })) chunks.push(chunk)
  } finally {
    server.close()
  }

  assert.equal(chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), 'ok')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].body.model, 'qwen-flash')
})
