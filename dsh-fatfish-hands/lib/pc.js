/**
 * 本机状态（只读）：给「电脑现在卡不卡/还有多少内存」这类问题用。
 * 不提供结束进程、改设置、读文件等能力——需要动手的事交给主人。
 */
import os from 'node:os'
import { execFile } from 'node:child_process'

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''))
    })
  })
}

async function topProcesses(n = 5) {
  const out = []
  try {
    if (process.platform === 'win32') {
      const text = await run('tasklist', ['/fo', 'csv', '/nh'])
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([\d,]+) K"$/)
        if (!m) continue
        out.push({ name: m[1], pid: Number(m[2]), memoryMB: Math.round(Number(m[3].replace(/,/g, '')) / 1024) })
      }
    } else {
      const text = await run('ps', ['-eo', 'rss=,comm='])
      for (const line of text.split(/\r?\n/)) {
        const m = line.trim().match(/^(\d+)\s+(.+)$/)
        if (!m) continue
        out.push({ name: m[2], memoryMB: Math.round(Number(m[1]) / 1024) })
      }
    }
  } catch {}
  return out.sort((a, b) => b.memoryMB - a.memoryMB).slice(0, n)
}

export async function pcStatus() {
  const total = os.totalmem()
  const free = os.freemem()
  return {
    platform: `${os.platform()} ${os.release()}`,
    hostname: os.hostname(),
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    cpu: `${os.cpus().length} 核`,
    load: (os.loadavg?.() || []).slice(0, 1)[0] || 0,
    memoryTotalGB: Math.round((total / 1024 ** 3) * 10) / 10,
    memoryFreeGB: Math.round((free / 1024 ** 3) * 10) / 10,
    memoryUsedPercent: Math.round(((total - free) / total) * 100),
    topProcesses: await topProcesses(),
  }
}
