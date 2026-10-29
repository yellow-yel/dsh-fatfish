/**
 * dsh-fatfish client — DSH 设置页 UI
 *
 * 提供毛玻璃风格的设置界面:
 * - 模式切换: normal / roast / sleepy / custom
 * - 自定义人设文本输入
 * - 时段感知和情绪状态开关
 * - API 配置 (免费模型)
 * - 红线说明
 */

const MODES = {
  normal: { label: '好脾气', emoji: '🐟', desc: '温和接地气, 咕噜咕噜吐泡泡' },
  roast: { label: '毒舌', emoji: '🔥', desc: '嘴硬心软的损友, 怼完留台阶' },
  sleepy: { label: '犯困', emoji: '😴', desc: '懒洋洋, 能少说就少说' },
  custom: { label: '自定义', emoji: '✏️', desc: '正常人设 + 主人写的附加人设' },
}

const API_PROVIDERS = {
  zhipu: { 
    label: '智谱 AI (推荐)', 
    emoji: '🧠',
    free: '完全免费',
    model: 'glm-4-flash',
    url: 'https://open.bigmodel.cn/',
  },
  qwen: { 
    label: '通义千问', 
    emoji: '☁️',
    free: '每月免费',
    model: 'qwen-turbo',
    url: 'https://dashscope.console.aliyun.com/',
  },
  deepseek: { 
    label: 'DeepSeek', 
    emoji: '🔍',
    free: '注册送额度',
    model: 'deepseek-chat',
    url: 'https://platform.deepseek.com/',
  },
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

export function render(ctx, config, update) {
  const mode = config?.mode || 'normal'
  const custom = config?.custom || ''
  const enableTime = config?.enableTimeAwareness !== false
  const enableMood = config?.enableMood !== false
  const apiEnabled = config?.api?.enabled || false
  const apiProvider = config?.api?.provider || 'zhipu'
  const apiKey = config?.api?.apiKey || ''
  const apiModel = config?.api?.model || 'glm-4-flash'
  const memoryEnabled = config?.memory?.enabled !== false
  const memoryMax = Math.max(50, Math.min(1000, Number(config?.memory?.maxFacts) || 300))
  const securityEnabled = config?.security?.enabled !== false
  const autoUpdate = config?.security?.autoUpdate !== false
  const feedUrl = config?.security?.feedUrl ?? 'https://gitee.com/akiba-yuzuki_0/dsh-fatfish/raw/master/signatures.json'
  const providerInfo = API_PROVIDERS[apiProvider] || API_PROVIDERS.zhipu

  const container = document.createElement('div')
  container.className = 'fatfish-settings'
  container.innerHTML = `
    <style>
      .fatfish-settings {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 650px;
        margin: 0 auto;
        padding: 20px;
        color: var(--text-primary, #e8eaf0);
      }
      .fatfish-header {
        text-align: center;
        margin-bottom: 24px;
      }
      .fatfish-header h2 {
        font-size: 24px;
        margin: 0 0 8px 0;
      }
      .fatfish-header p {
        font-size: 14px;
        color: var(--text-secondary, #8b93a7);
        margin: 0;
      }
      .fatfish-section {
        background: var(--bg-secondary, rgba(255,255,255,0.05));
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
        backdrop-filter: blur(10px);
      }
      .fatfish-section h3 {
        font-size: 16px;
        margin: 0 0 12px 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .fatfish-modes {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }
      .fatfish-mode-card {
        background: var(--bg-tertiary, rgba(255,255,255,0.03));
        border: 2px solid transparent;
        border-radius: 8px;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .fatfish-mode-card:hover {
        background: var(--bg-hover, rgba(255,255,255,0.08));
      }
      .fatfish-mode-card.active {
        border-color: var(--accent, #4a7dff);
        background: var(--bg-active, rgba(74,125,255,0.1));
      }
      .fatfish-mode-emoji {
        font-size: 24px;
        margin-bottom: 4px;
      }
      .fatfish-mode-label {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .fatfish-mode-desc {
        font-size: 12px;
        color: var(--text-secondary, #8b93a7);
      }
      .fatfish-field {
        margin-bottom: 12px;
      }
      .fatfish-field label {
        display: block;
        font-size: 14px;
        margin-bottom: 6px;
        font-weight: 500;
      }
      .fatfish-field textarea,
      .fatfish-field input,
      .fatfish-field select {
        width: 100%;
        padding: 8px;
        border: 1px solid var(--border, rgba(255,255,255,0.1));
        border-radius: 6px;
        background: var(--bg-input, rgba(0,0,0,0.2));
        color: var(--text-primary, #e8eaf0);
        font-family: inherit;
        font-size: 13px;
      }
      .fatfish-field textarea {
        min-height: 100px;
        resize: vertical;
      }
      .fatfish-field textarea:focus,
      .fatfish-field input:focus,
      .fatfish-field select:focus {
        outline: none;
        border-color: var(--accent, #4a7dff);
      }
      .fatfish-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
      }
      .fatfish-toggle label {
        font-size: 14px;
      }
      .fatfish-toggle input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }
      .fatfish-api-providers {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
        margin-bottom: 12px;
      }
      .fatfish-api-card {
        background: var(--bg-tertiary, rgba(255,255,255,0.03));
        border: 2px solid transparent;
        border-radius: 8px;
        padding: 10px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .fatfish-api-card:hover {
        background: var(--bg-hover, rgba(255,255,255,0.08));
      }
      .fatfish-api-card.active {
        border-color: var(--accent, #4a7dff);
        background: var(--bg-active, rgba(74,125,255,0.1));
      }
      .fatfish-api-card-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
      }
      .fatfish-api-card-emoji {
        font-size: 20px;
      }
      .fatfish-api-card-label {
        font-size: 13px;
        font-weight: 600;
      }
      .fatfish-api-card-free {
        font-size: 11px;
        color: var(--success, #35c96b);
        margin-bottom: 2px;
      }
      .fatfish-api-card-model {
        font-size: 11px;
        color: var(--text-secondary, #8b93a7);
      }
      .fatfish-api-link {
        display: inline-block;
        margin-top: 8px;
        color: var(--accent, #4a7dff);
        text-decoration: none;
        font-size: 12px;
      }
      .fatfish-api-link:hover {
        text-decoration: underline;
      }
      .fatfish-redlines {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-secondary, #8b93a7);
      }
      .fatfish-redlines ul {
        margin: 8px 0 0 0;
        padding-left: 20px;
      }
      .fatfish-redlines li {
        margin-bottom: 4px;
      }
      .fatfish-hint {
        font-size: 12px;
        line-height: 1.5;
        color: var(--text-secondary, #8b93a7);
        margin: 8px 0 0;
      }
      .fatfish-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        background: var(--success, #35c96b);
        color: white;
      }
    </style>

    <div class="fatfish-header">
      <h2>🐟 大肥鱼</h2>
      <p>会聊天、会记事、会查毒，还会卖萌</p>
    </div>

    <div class="fatfish-section">
      <h3>模式选择</h3>
      <div class="fatfish-modes">
        ${Object.entries(MODES).map(([key, { label, emoji, desc }]) => `
          <div class="fatfish-mode-card ${mode === key ? 'active' : ''}" data-mode="${key}">
            <div class="fatfish-mode-emoji">${emoji}</div>
            <div class="fatfish-mode-label">${label}</div>
            <div class="fatfish-mode-desc">${desc}</div>
          </div>
        `).join('')}
      </div>
    </div>

    ${mode === 'custom' ? `
      <div class="fatfish-section">
        <h3>自定义人设</h3>
        <div class="fatfish-field">
          <label>附加人设文本 (最多600字)</label>
          <textarea class="fatfish-custom-input" placeholder="在这里写你想让鱼额外扮演的性格特点...">${esc(custom)}</textarea>
        </div>
      </div>
    ` : ''}

    <div class="fatfish-section">
      <h3>高级选项</h3>
      <div class="fatfish-toggle">
        <label>时段感知</label>
        <input type="checkbox" class="fatfish-time-toggle" ${enableTime ? 'checked' : ''}>
      </div>
      <div class="fatfish-toggle">
        <label>情绪状态</label>
        <input type="checkbox" class="fatfish-mood-toggle" ${enableMood ? 'checked' : ''}>
      </div>
    </div>

    <div class="fatfish-section">
      <h3>🧠 记忆</h3>
      <div class="fatfish-toggle">
        <label>启用本地记忆</label>
        <input type="checkbox" class="fatfish-memory-toggle" ${memoryEnabled ? 'checked' : ''}>
      </div>
      <div class="fatfish-field">
        <label>最多记多少条</label>
        <input type="number" class="fatfish-memory-max" min="50" max="1000" value="${memoryMax}">
      </div>
      <p class="fatfish-hint">只存在本机 ~/.dsh/fatfish。说「记住…」就记下；说「忘掉…」才删。密码、验证码、证件号、银行卡不会入库。</p>
    </div>

    <div class="fatfish-section">
      <h3>🛡 安全检查</h3>
      <div class="fatfish-toggle">
        <label>启用本地查杀</label>
        <input type="checkbox" class="fatfish-security-toggle" ${securityEnabled ? 'checked' : ''}>
      </div>
      <div class="fatfish-toggle">
        <label>自动更新病毒库</label>
        <input type="checkbox" class="fatfish-security-update" ${autoUpdate ? 'checked' : ''}>
      </div>
      <div class="fatfish-field">
        <label>病毒库地址（HTTPS）</label>
        <input type="text" class="fatfish-security-feed" value="${esc(feedUrl)}" placeholder="https://.../signatures.json">
      </div>
      <p class="fatfish-hint">只读检查：可疑进程、开机启动项、下载/桌面/临时目录里的可执行文件。不删文件、不杀进程；病毒库只下载规则，不上传本机数据。</p>
    </div>

    <div class="fatfish-section">
      <h3>🔌 API 配置 <span class="fatfish-badge">免费</span></h3>
      <div class="fatfish-toggle">
        <label>启用独立 API (不依赖 DSH 的 LLM)</label>
        <input type="checkbox" class="fatfish-api-toggle" ${apiEnabled ? 'checked' : ''}>
      </div>
      
      ${apiEnabled ? `
        <div class="fatfish-api-providers">
          ${Object.entries(API_PROVIDERS).map(([key, { label, emoji, free, model }]) => `
            <div class="fatfish-api-card ${apiProvider === key ? 'active' : ''}" data-provider="${key}">
              <div class="fatfish-api-card-header">
                <span class="fatfish-api-card-emoji">${emoji}</span>
                <span class="fatfish-api-card-label">${label}</span>
              </div>
              <div class="fatfish-api-card-free">${free}</div>
              <div class="fatfish-api-card-model">模型: ${model}</div>
            </div>
          `).join('')}
        </div>

        <div class="fatfish-field">
          <label>API Key</label>
          <input type="password" class="fatfish-api-key" value="${esc(apiKey)}" placeholder="输入你的 API Key">
          <a href="${providerInfo.url}" target="_blank" rel="noopener" class="fatfish-api-link">
            点我注册获取免费 API Key →
          </a>
        </div>

        <div class="fatfish-field">
          <label>模型名称</label>
          <input type="text" class="fatfish-api-model" value="${esc(apiModel)}" placeholder="例如: glm-4-flash">
        </div>
      ` : ''}
    </div>

    <div class="fatfish-section">
      <h3>🔒 红线 (写死, 不可关闭)</h3>
      <div class="fatfish-redlines">
        以下规则任何模式下都生效:
        <ul>
          <li>不打听、不透露隐私 (余额/密码/住址等)</li>
          <li>不谈钱 (不代付/不转账/不推荐理财)</li>
          <li>不问候家人/不人身攻击/不带脏字</li>
          <li>不知道的事就说不记得, 不编造</li>
        </ul>
      </div>
    </div>
  `

  // 模式切换
  container.querySelectorAll('.fatfish-mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const newMode = card.dataset.mode
      update({ ...config, mode: newMode })
    })
  })

  // 自定义文本
  const customInput = container.querySelector('.fatfish-custom-input')
  if (customInput) {
    let debounceTimer
    customInput.addEventListener('input', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        update({ ...config, custom: customInput.value.slice(0, 600) })
      }, 300)
    })
  }

  // 时段感知开关
  const timeToggle = container.querySelector('.fatfish-time-toggle')
  if (timeToggle) {
    timeToggle.addEventListener('change', () => {
      update({ ...config, enableTimeAwareness: timeToggle.checked })
    })
  }

  // 情绪状态开关
  const moodToggle = container.querySelector('.fatfish-mood-toggle')
  if (moodToggle) {
    moodToggle.addEventListener('change', () => {
      update({ ...config, enableMood: moodToggle.checked })
    })
  }

  // 记忆开关
  const memoryToggle = container.querySelector('.fatfish-memory-toggle')
  if (memoryToggle) {
    memoryToggle.addEventListener('change', () => {
      update({ ...config, memory: { ...(config?.memory || {}), enabled: memoryToggle.checked } })
    })
  }

  // 记忆条数上限
  const memoryMaxInput = container.querySelector('.fatfish-memory-max')
  if (memoryMaxInput) {
    memoryMaxInput.addEventListener('change', () => {
      const n = Math.max(50, Math.min(1000, Number(memoryMaxInput.value) || 300))
      update({ ...config, memory: { ...(config?.memory || {}), maxFacts: n } })
    })
  }

  // 安全检查开关
  const securityToggle = container.querySelector('.fatfish-security-toggle')
  if (securityToggle) {
    securityToggle.addEventListener('change', () => {
      update({ ...config, security: { ...(config?.security || {}), enabled: securityToggle.checked } })
    })
  }

  // 病毒库自动更新开关
  const securityUpdate = container.querySelector('.fatfish-security-update')
  if (securityUpdate) {
    securityUpdate.addEventListener('change', () => {
      update({ ...config, security: { ...(config?.security || {}), autoUpdate: securityUpdate.checked } })
    })
  }

  // 病毒库地址
  const securityFeed = container.querySelector('.fatfish-security-feed')
  if (securityFeed) {
    let debounceTimer
    securityFeed.addEventListener('input', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        update({ ...config, security: { ...(config?.security || {}), feedUrl: securityFeed.value.trim() } })
      }, 500)
    })
  }

  // API 开关
  const apiToggle = container.querySelector('.fatfish-api-toggle')
  if (apiToggle) {
    apiToggle.addEventListener('change', () => {
      const api = config?.api || {}
      update({ 
        ...config, 
        api: { 
          ...api, 
          enabled: apiToggle.checked,
          provider: api.provider || 'zhipu',
          apiKey: api.apiKey || '',
          model: api.model || 'glm-4-flash',
        }
      })
    })
  }

  // API 提供商选择
  container.querySelectorAll('.fatfish-api-card').forEach(card => {
    card.addEventListener('click', () => {
      const provider = card.dataset.provider
      const api = config?.api || {}
      update({ 
        ...config, 
        api: { 
          ...api, 
          provider,
          model: API_PROVIDERS[provider].model,
        }
      })
    })
  })

  // API Key
  const apiKeyInput = container.querySelector('.fatfish-api-key')
  if (apiKeyInput) {
    let debounceTimer
    apiKeyInput.addEventListener('input', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const api = config?.api || {}
        update({ ...config, api: { ...api, apiKey: apiKeyInput.value } })
      }, 500)
    })
  }

  // API Model
  const apiModelInput = container.querySelector('.fatfish-api-model')
  if (apiModelInput) {
    let debounceTimer
    apiModelInput.addEventListener('input', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const api = config?.api || {}
        update({ ...config, api: { ...api, model: apiModelInput.value } })
      }, 500)
    })
  }

  return container
}

export const name = 'fatfish'
