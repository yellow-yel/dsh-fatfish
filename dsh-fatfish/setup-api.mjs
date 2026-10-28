#!/usr/bin/env node
/**
 * 大肥鱼 API 快速配置脚本
 * 用法: node setup-api.mjs [provider] [api-key]
 * 
 * 示例:
 *   node setup-api.mjs zhipu your-api-key-here
 *   node setup-api.mjs          # 交互式配置
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'api-config.json');

const PROVIDERS = {
  zhipu: {
    name: '智谱 AI (GLM-4-Flash) - 完全免费',
    url: 'https://open.bigmodel.cn/',
    model: 'glm-4-flash',
  },
  qwen: {
    name: '阿里云通义千问 - 每月免费',
    url: 'https://dashscope.console.aliyun.com/',
    model: 'qwen-turbo',
  },
  deepseek: {
    name: 'DeepSeek - 注册送额度',
    url: 'https://platform.deepseek.com/',
    model: 'deepseek-chat',
  },
  baidu: {
    name: '百度文心一言 - 免费试用',
    url: 'https://cloud.baidu.com/product/wenxinworkshop',
    model: 'ernie-bot-turbo',
  },
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      provider: 'zhipu',
      apiKey: '',
      model: 'glm-4-flash',
      enabled: false,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { provider: 'zhipu', apiKey: '', model: 'glm-4-flash', enabled: false };
  }
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

async function interactiveSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise((resolve) => {
    rl.question(prompt, resolve);
  });

  console.log('\n🐟 大肥鱼 API 配置向导\n');
  console.log('支持的免费 API 提供商:\n');
  
  const providerKeys = Object.keys(PROVIDERS);
  providerKeys.forEach((key, i) => {
    const p = PROVIDERS[key];
    console.log(`  ${i + 1}. ${p.name}`);
    console.log(`     注册: ${p.url}`);
    console.log(`     默认模型: ${p.model}\n`);
  });

  const providerChoice = await question('选择提供商 (输入数字 1-4, 默认 1): ');
  const providerIndex = parseInt(providerChoice) - 1;
  const provider = providerKeys[providerIndex] || 'zhipu';
  
  console.log(`\n✓ 已选择: ${PROVIDERS[provider].name}`);
  console.log(`  注册地址: ${PROVIDERS[provider].url}\n`);

  const apiKey = await question('输入你的 API Key (留空跳过): ');
  
  const customModel = await question(`使用模型 (默认 ${PROVIDERS[provider].model}): `);
  const model = customModel || PROVIDERS[provider].model;

  const enableNow = await question('立即启用? (y/n, 默认 y): ');
  const enabled = enableNow.toLowerCase() !== 'n';

  const config = {
    provider,
    apiKey: apiKey.trim(),
    model,
    enabled,
  };

  saveConfig(config);

  console.log('\n✅ 配置已保存!');
  console.log(`   文件: ${CONFIG_FILE}`);
  console.log(`   提供商: ${provider}`);
  console.log(`   模型: ${model}`);
  console.log(`   状态: ${enabled ? '已启用' : '未启用'}`);
  console.log(`   API Key: ${apiKey ? '已配置' : '未配置'}\n`);

  if (!apiKey) {
    console.log('⚠️  警告: 未配置 API Key，请先注册获取');
    console.log(`   ${PROVIDERS[provider].url}\n`);
  }

  if (enabled && apiKey) {
    console.log('🎉 配置完成！现在可以在 DSH 中使用大肥鱼了');
    console.log('   启动 DSH 后，在对话框输入: /fatfish.chat 你好呀\n');
  }

  rl.close();
}

function quickSetup(provider, apiKey) {
  if (!PROVIDERS[provider]) {
    console.error(`❌ 不支持的提供商: ${provider}`);
    console.error(`   支持的: ${Object.keys(PROVIDERS).join(', ')}`);
    process.exit(1);
  }

  const config = {
    provider,
    apiKey: apiKey || '',
    model: PROVIDERS[provider].model,
    enabled: !!apiKey,
  };

  saveConfig(config);

  console.log('\n✅ 快速配置完成!');
  console.log(`   提供商: ${PROVIDERS[provider].name}`);
  console.log(`   模型: ${config.model}`);
  console.log(`   状态: ${config.enabled ? '已启用' : '未启用 (缺少 API Key)'}`);
  console.log(`   文件: ${CONFIG_FILE}\n`);

  if (!apiKey) {
    console.log('⚠️  请配置 API Key:');
    console.log(`   1. 访问 ${PROVIDERS[provider].url}`);
    console.log('   2. 注册并获取 API Key');
    console.log(`   3. 运行: node setup-api.mjs ${provider} your-api-key\n`);
  }
}

// 主程序
const args = process.argv.slice(2);

if (args.length === 0) {
  interactiveSetup();
} else if (args.length >= 1) {
  const provider = args[0];
  const apiKey = args[1] || '';
  quickSetup(provider, apiKey);
}
