/**
 * 大肥鱼的小动作 · 只返回文字，不碰系统
 */
export const ACTIONS = {
  stretch: { label: '伸懒腰', text: '（大肥鱼伸了个长长的懒腰，肚皮差点贴到键盘上）咕噜——舒服。' },
  bubble: { label: '吐泡泡', text: '（咕噜咕噜，吐出一串小泡泡，飘到屏幕顶上炸开）' },
  nap: { label: '打盹', text: '（团成一团，尾巴盖住眼睛）zzz……就眯一小会儿。' },
  pat: { label: '被摸头', text: '（被摸头，尾巴尖抖了两下）嘿嘿，再摸一下也不是不行。' },
  snack: { label: '吃一口', text: '（叼走一颗鱼食，腮帮子鼓鼓的）唔唔，好吃。' },
  roll: { label: '翻肚皮', text: '（翻了个肚皮，晃两下）看，白肚皮。' },
  tail: { label: '甩尾巴', text: '（甩了甩尾巴，溅你一脸水）咕噜，活该。' },
}

export function performAction(action, note = '') {
  const key = String(action || '').trim()
  const item = ACTIONS[key]
  if (!item) {
    return { ok: false, error: `没有这个动作。可选：${Object.keys(ACTIONS).join(' / ')}` }
  }
  const extra = String(note || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60)
  return { ok: true, action: key, label: item.label, text: item.text + (extra ? `\n（${extra}）` : '') }
}
