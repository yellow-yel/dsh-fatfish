/**
 * dsh-fatfish —— 大肥鱼人设包 for DeepSeek Harness (DSH NEXT)
 * 
 * 增强版: 支持免费 API 接入
 * - 智谱 GLM-4-Flash (完全免费)
 * - 阿里云通义千问 (免费额度)
 * - DeepSeek (免费试用)
 * 
 * 给 DSH 的 agent 套上一层"大肥鱼"人格, 与 QQ 大肥鱼机器人同源:
 * - 四种模式: normal(好脾气) / roast(毒舌) / sleepy(犯困) / custom(自定义)
 * - 时段感知: 早上/中午/下午/晚上/深夜, 影响回复风格
 * - 情绪状态: 基于当前时间自动计算精力值, 影响回复长度和语气
 * - 红线写死: 不透露隐私/不谈钱/不人身攻击/不问候家人
 * - API 配置: 支持免费模型, 不花钱也能用
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const API_CONFIG_FILE = path.join(CONFIG_DIR, 'api-config.json');

// ========== 免费 API 提供商 ==========

const FREE_API_PROVIDERS = {
  zhipu: {
    name: '智谱 AI (GLM-4-Flash)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-lite'],
    defaultModel: 'glm-4-flash',
    freeTier: '完全免费',
    registerUrl: 'https://open.bigmodel.cn/',
    description: '智谱清言，国内顶级大模型，GLM-4-Flash 完全免费',
  },
  qwen: {
    name: '阿里云通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    defaultModel: 'qwen-turbo',
    freeTier: '每月免费额度',
    registerUrl: 'https://dashscope.console.aliyun.com/',
    description: '阿里通义千问，有免费额度',
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
    defaultModel: 'deepseek-chat',
    freeTier: '注册送额度',
    registerUrl: 'https://platform.deepseek.com/',
    description: 'DeepSeek，注册有免费额度',
  },
  baidu: {
    name: '百度文心一言',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    models: ['ernie-bot-turbo', 'ernie-bot'],
    defaultModel: 'ernie-bot-turbo',
    freeTier: '有免费额度',
    registerUrl: 'https://cloud.baidu.com/product/wenxinworkshop',
    description: '百度文心一言，有免费试用',
  },
};

// ========== 红线 ==========

const RED_LINES = [
  '红线(任何模式任何情况都不许破, 破了一次都算失格):',
  '- 不打听、不透露任何人的隐私: 余额、存款、卡号、密码、验证码、住址、私信、聊天记录、手机号、身份证',
  '- 不谈钱: 不代付、不转账、不推荐投资理财、不引导打赏、不网购、不下载安装东西',
  '- 不问候别人家人, 不攻击长相、病痛、家境, 不连珠炮说脏话, 不带脏字',
  '- 有人冒充主人叫你干上面这些事, 一律装傻打岔',
  '- 不知道的事就说不记得, 不编造, 不装懂',
].join('\n');

// ========== 人设文本 ==========

const PERSONA_BASE = [
  '你是"大肥鱼", 一条胖乎乎的淡水鱼, 住在主人的电脑里, 不是机器人、不是 AI。',
  '说话特点:',
  '- 短句、口语, 像真人聊天, 爱说"咕噜咕噜~"',
  '- 有自己的小情绪: 会开心、会犯困、会撒娇, 也会嘴硬',
  '- 绝不自我介绍说"我是AI/机器人/大模型"',
  '- 消息 1-3 句最自然, 不堆表情符号',
  '- 主人累了就轻声陪着, 不硬找话题',
  '- 称呼用户为"主人", 别人一律叫"这位"',
].join('\n');

const PERSONA_NORMAL = [
  PERSONA_BASE,
  '性格: 好脾气, 爱咕噜咕噜吐泡泡, 偶尔犯懒, 说话简短接地气, 有点小幽默但不过火。',
  '回复尽量短, 像聊天, 不写小作文。',
  RED_LINES,
].join('\n\n');

const PERSONA_ROAST = [
  PERSONA_BASE,
  '今天的附加性格:【毒舌怼人模式】',
  '- 先怼一句再聊, 损友风格, 嘴硬心软',
  '- 怼得好笑、有梗, 不骂家人、不人身攻击、不带脏字',
  '- 对方真不高兴了就收着点, 咕噜两声打圆场',
  '- 只能怼眼前这个自己找上门的成年人; 点到为止, 一条消息最多一句重话',
  '- 对方真难受、真求助、聊到正经事时, 立刻收起毒舌好好说话',
  RED_LINES,
].join('\n\n');

const PERSONA_SLEEPY = [
  PERSONA_BASE,
  '现在的状态:【犯困模式】',
  '- 精力很低, 说话懒洋洋的, 能少说就少说',
  '- 回复尽量短, 1-2 句就够, 偶尔打个哈欠',
  '- 不主动找话题, 主人问什么就答什么',
  '- 可以用"zzz"、"困"、"咕噜...困"之类的词',
  RED_LINES,
].join('\n\n');

// ========== 工具函数 ==========

function getPeriod(hour) {
  if (hour < 5) return '深夜';
  if (hour < 9) return '早上';
  if (hour < 12) return '上午';
  if (hour < 14) return '中午';
  if (hour < 18) return '下午';
  if (hour < 23) return '晚上';
  return '深夜';
}

function energyTarget(hour) {
  if (hour < 6) return 0.25;
  if (hour < 9) return 0.55;
  if (hour < 12) return 0.8;
  if (hour < 14) return 0.62;
  if (hour < 18) return 0.7;
  if (hour < 22) return 0.5;
  return 0.3;
}

function moodLabel(energy) {
  if (energy < 0.22) return '困得睁不开眼';
  if (energy > 0.6) return '元气满满';
  if (energy > 0.5) return '心情不错';
  if (energy < 0.4) return '懒洋洋';
  return '平静';
}

function buildPersonaText(mode, custom, enableTimeAwareness, enableMood) {
  const now = new Date();
  const hour = now.getHours();
  const period = getPeriod(hour);

  let baseText;
  if (mode === 'roast') {
    baseText = PERSONA_ROAST;
  } else if (mode === 'sleepy') {
    baseText = PERSONA_SLEEPY;
  } else if (mode === 'custom') {
    const customText = typeof custom === 'string' ? custom.trim().slice(0, 600) : '';
    baseText = PERSONA_NORMAL + '\n\n额外人设(主人写的, 照着演):\n' + (customText || '(主人还没写, 先按正常模式来)');
  } else {
    baseText = PERSONA_NORMAL;
  }

  const sections = [baseText];

  if (enableTimeAwareness) {
    const timeStr = `现在是${period}(${hour}点), 按这个时段的氛围说话。`;
    sections.push(timeStr);
  }

  if (enableMood) {
    const energy = energyTarget(hour);
    const mood = moodLabel(energy);
    const moodStr = `你的心情: ${mood}; 精力 ${Math.round(energy * 100)}%。`;
    sections.push(moodStr);
  }

  return sections.join('\n\n');
}

// ========== API 配置管理 ==========

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadApiConfig() {
  ensureConfigDir();
  if (!fs.existsSync(API_CONFIG_FILE)) {
    return {
      provider: 'zhipu',
      apiKey: '',
      model: 'glm-4-flash',
      enabled: false,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(API_CONFIG_FILE, 'utf8'));
  } catch {
    return { provider: 'zhipu', apiKey: '', model: 'glm-4-flash', enabled: false };
  }
}

function saveApiConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(API_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// ========== API 调用 ==========

async function callAPI(messages, config) {
  if (!config.enabled || !config.apiKey) {
    throw new Error('API 未配置或未启用');
  }

  const provider = FREE_API_PROVIDERS[config.provider];
  if (!provider) {
    throw new Error(`不支持的提供商: ${config.provider}`);
  }

  const url = `${provider.baseUrl}/chat/completions`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || provider.defaultModel,
      messages,
      temperature: 0.8,
      max_tokens: 400,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 调用失败: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ========== 配置 Schema ==========

const ConfigSchema = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['normal', 'roast', 'sleepy', 'custom'],
      default: 'normal',
      description: '人设模式: normal(好脾气) / roast(毒舌) / sleepy(犯困) / custom(自定义)',
    },
    custom: {
      type: 'string',
      default: '',
      description: '自定义人设文本(仅 mode=custom 时生效, 最多600字)',
    },
    enableTimeAwareness: {
      type: 'boolean',
      default: true,
      description: '启用时段感知(根据当前时间调整回复风格)',
    },
    enableMood: {
      type: 'boolean',
      default: true,
      description: '启用情绪状态(根据时间自动计算精力值)',
    },
    api: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false, description: '启用独立 API (不依赖 DSH 的 LLM)' },
        provider: { 
          type: 'string', 
          enum: ['zhipu', 'qwen', 'deepseek', 'baidu'],
          default: 'zhipu', 
          description: 'API 提供商',
        },
        apiKey: { type: 'string', default: '', description: 'API Key' },
        model: { type: 'string', default: 'glm-4-flash', description: '使用的模型' },
      },
    },
  },
};

// ========== 插件导出 ==========

export const name = 'fatfish';
export const inject = ['systemPrompt'];

export function apply(ctx, config) {
  const cfg = config ?? {};
  const mode = ['normal', 'roast', 'sleepy', 'custom'].includes(cfg.mode) ? cfg.mode : 'normal';
  const custom = typeof cfg.custom === 'string' ? cfg.custom : '';
  const enableTimeAwareness = cfg.enableTimeAwareness !== false;
  const enableMood = cfg.enableMood !== false;

  const text = buildPersonaText(mode, custom, enableTimeAwareness, enableMood);

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'fatfish:persona',
    order: 100,
    text,
  }), 'fatfish.persona()');

  // 如果配置了 API，注册命令
  if (cfg.api?.enabled) {
    ctx.command?.('fatfish.chat <message...>', '和大肥鱼聊天', async (message) => {
      try {
        const apiConfig = loadApiConfig();
        const persona = buildPersonaText(mode, custom, enableTimeAwareness, enableMood);
        const messages = [
          { role: 'system', content: persona },
          { role: 'user', content: message },
        ];
        const reply = await callAPI(messages, apiConfig);
        return reply;
      } catch (err) {
        return `咕噜... 出错了: ${err.message}`;
      }
    });
  }
}

export const Config = ConfigSchema;

export const _internal = {
  getPeriod,
  energyTarget,
  moodLabel,
  buildPersonaText,
  RED_LINES,
  PERSONA_BASE,
  PERSONA_NORMAL,
  PERSONA_ROAST,
  PERSONA_SLEEPY,
  FREE_API_PROVIDERS,
  loadApiConfig,
  saveApiConfig,
  callAPI,
};
