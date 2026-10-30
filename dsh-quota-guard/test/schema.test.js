import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORT_SCHEMA, REPORT_PARAMETERS } from '../index.js'
import * as store from '../lib/store.js'
import { normalizeLimits } from '../lib/config.js'

/**
 * dsh-tools 只接受一个 JSON Schema 子集（见 @deepseek-ai/dsh-tools 的 json-schema 模块）。
 * 这里按文档规则做静态体检，防止以后改动引入 $ref、数组 type 之类的关键字——
 * 那会在插件注册工具时直接抛错，而不是在测试里暴露。
 */
const ALLOWED = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'description', 'title', 'default', 'examples',
])

function walk(node, path = '$', violations = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    violations.push(`${path}: 必须是 schema 对象`)
    return violations
  }
  for (const key of Object.keys(node)) {
    if (!ALLOWED.has(key)) violations.push(`${path}: 不支持的关键字 ${key}`)
  }
  if ('type' in node) {
    if (typeof node.type !== 'string') violations.push(`${path}.type: 必须是单个字符串，不能是数组`)
    if (node.type === 'object') {
      if (!node.properties || typeof node.properties !== 'object') {
        violations.push(`${path}: object 缺少 properties`)
      } else {
        for (const [key, child] of Object.entries(node.properties)) walk(child, `${path}.properties.${key}`, violations)
      }
      for (const key of node.required || []) {
        if (!node.properties || !(key in node.properties)) violations.push(`${path}.required: ${key} 不在 properties 中`)
      }
      if ('items' in node) violations.push(`${path}: object 不能有 items`)
    }
    if (node.type === 'array') {
      if ('items' in node) walk(node.items, `${path}.items`, violations)
      if ('properties' in node) violations.push(`${path}: array 不能有 properties`)
    }
    if (node.type !== 'object' && 'properties' in node) violations.push(`${path}: 非 object 不能有 properties`)
  } else if ('items' in node || 'properties' in node) {
    violations.push(`${path}: items/properties 需要显式 type`)
  }
  if ('oneOf' in node) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) violations.push(`${path}.oneOf: 至少两个分支`)
    else node.oneOf.forEach((branch, index) => walk(branch, `${path}.oneOf[${index}]`, violations))
  }
  return violations
}

test('报告输出 schema 落在 dsh-tools 支持的子集内', () => {
  assert.deepEqual(walk(REPORT_SCHEMA), [])
})

test('工具入参 schema 是合法的 object 根 schema', () => {
  assert.equal(REPORT_PARAMETERS.type, 'object')
  assert.deepEqual(walk(REPORT_PARAMETERS), [])
})

/** 只实现本 schema 用到的关键字，校验类型、必填与多余字段。 */
function checkValue(schema, value, path = '$', errors = []) {
  if (schema.oneOf) {
    const matched = schema.oneOf.some((branch) => checkValue(branch, value, path, []).length === 0)
    if (!matched) errors.push(`${path}: 不匹配任何 oneOf 分支`)
    return errors
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: 不等于 const`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: 不在 enum 中`)

  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path}: 不是对象`)
      return errors
    }
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}: 缺少 ${key}`)
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) checkValue(schema.properties[key], child, `${path}.${key}`, errors)
      else if (schema.additionalProperties === false) errors.push(`${path}: 多出字段 ${key}`)
    }
    return errors
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: 不是数组`)
      return errors
    }
    value.forEach((item, index) => checkValue(schema.items, item, `${path}[${index}]`, errors))
    return errors
  }
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push(`${path}: 不是有限数字`)
  }
  if (schema.type === 'string' && typeof value !== 'string') errors.push(`${path}: 不是字符串`)
  if (schema.type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: 不是布尔`)
  return errors
}

test('真实快照正好满足报告 schema（必填字段不多不少）', () => {
  const state = store.emptyState()
  store.count(state, new Date('2026-10-30T12:00:00'))
  store.settle(state, {
    day: '2026-10-30', provider: 'p', model: 'm', status: 'ok', costCny: 0, latencyMs: 120,
    usage: { inputTokens: 10, outputTokens: 2 },
  })
  const report = store.snapshot(state, normalizeLimits({ dailyTokens: 1000, dailyRequests: 10 }), new Date('2026-10-30T12:00:00'), 3)
  assert.deepEqual(checkValue(REPORT_SCHEMA, report), [])
})
