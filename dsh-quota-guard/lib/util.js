import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 与 DSH 其他插件一致：优先 DSH_HOME，否则用户主目录下的 .dsh。 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(process.env.USERPROFILE || os.homedir(), '.dsh')
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地时区的日期键；跨天判断必须与用户看到的日历一致。 */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function minuteKey(date = new Date()) {
  return `${dayKey(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}

/** 写临时文件再改名，避免进程中断留下半截 JSON。 */
export function writeAtomic(file, text) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

export function asInt(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export function asNum(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function round(value, digits = 6) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const f = 10 ** digits
  return Math.round(n * f) / f
}
