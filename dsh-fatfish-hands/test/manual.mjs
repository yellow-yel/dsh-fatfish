/**
 * 手工冒烟：node test/manual.mjs [url]
 * 默认打开 B 站首页，读页面、按标题点第一个视频、再读、截图。
 */
import { EdgeSession, loadConfig, findEdge } from '../lib/edge.js'

const url = process.argv[2] || 'https://www.bilibili.com'
const cfg = loadConfig({ headless: process.env.FATFISH_HEADLESS === '1' })
console.log('edge:', findEdge(cfg), 'port:', cfg.port)
const s = new EdgeSession(cfg)
try {
  const page = await s.open(url)
  console.log('TITLE:', page.title)
  console.log('URL:', page.url)
  console.log('TEXT:', page.text.slice(0, 300).replace(/\n/g, ' | '))
  console.log('LINKS:')
  for (const l of page.links.slice(0, 25)) console.log(` ${l.i}. ${l.text} -> ${l.href.slice(0, 100)}`)
  const shot = await s.screenshot()
  console.log('SHOT:', shot.path, shot.width + 'x' + shot.height)
  const video = page.links.find((l) => /\/video\/BV/.test(l.href))
  if (video) {
    console.log('\nCLICK LINK', video.i, video.text)
    const p2 = await s.click({ index: video.i })
    console.log('AFTER TITLE:', p2.title)
    console.log('AFTER TEXT:', p2.text.slice(0, 400).replace(/\n/g, ' | '))
    const shot2 = await s.screenshot()
    console.log('SHOT2:', shot2.path)
  }
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
}
process.exit(process.exitCode || 0)
