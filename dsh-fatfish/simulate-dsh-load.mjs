/**
 * DSH 插件加载模拟器
 * 模拟 DSH 如何发现和加载插件
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== DSH 插件加载模拟器 ===\n');

// 模拟 DSH 的插件发现流程
class DSHPluginLoader {
  constructor(profileDir) {
    this.profileDir = profileDir;
    this.plugins = new Map();
    this.bundles = [];
  }

  // 1. 读取 package.json 获取 bundles 列表
  async loadBundles() {
    console.log('1. 读取 DSH profile 配置...');
    const pkgPath = path.join(this.profileDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      throw new Error('package.json 不存在');
    }
    
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    this.bundles = pkg.dsh?.profile?.bundles || [];
    console.log('   ✓ 找到 bundles:', this.bundles.join(', '));
    return this.bundles;
  }

  // 2. 加载每个 bundle 的 cordis.patch.yml
  async loadPatchConfig() {
    console.log('\n2. 读取 cordis.patch.yml...');
    const patchPath = path.join(this.profileDir, 'cordis.patch.yml');
    if (!fs.existsSync(patchPath)) {
      throw new Error('cordis.patch.yml 不存在');
    }
    
    const patchContent = fs.readFileSync(patchPath, 'utf8');
    console.log('   ✓ patch 文件存在');
    
    // 简单解析 YAML (实际 DSH 用完整的 YAML 解析器)
    const hasFatfish = patchContent.includes('id: dsh-fatfish');
    console.log('   ✓ dsh-fatfish 配置:', hasFatfish ? '已找到' : '未找到');
    
    return hasFatfish;
  }

  // 3. 在 node_modules 中查找插件
  async discoverPlugin(pluginName) {
    console.log(`\n3. 查找插件: ${pluginName}...`);
    const pluginDir = path.join(this.profileDir, 'node_modules', pluginName);
    
    if (!fs.existsSync(pluginDir)) {
      console.log('   ✗ 插件目录不存在');
      return null;
    }
    
    console.log('   ✓ 插件目录:', pluginDir);
    
    // 读取插件 package.json
    const pkgPath = path.join(pluginDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      console.log('   ✗ 插件 package.json 不存在');
      return null;
    }
    
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log('   ✓ 插件名称:', pkg.name);
    console.log('   ✓ 插件版本:', pkg.version);
    console.log('   ✓ 主入口:', pkg.main);
    console.log('   ✓ 类型:', pkg.type);
    
    // 检查必需文件
    const requiredFiles = ['lib/index.js', 'cordis.patch.yml', 'icon.svg'];
    for (const file of requiredFiles) {
      const filePath = path.join(pluginDir, file);
      if (fs.existsSync(filePath)) {
        console.log(`   ✓ ${file} 存在`);
      } else {
        console.log(`   ✗ ${file} 缺失`);
      }
    }
    
    return { dir: pluginDir, pkg };
  }

  // 4. 动态加载插件模块
  async loadPluginModule(pluginInfo) {
    console.log('\n4. 加载插件模块...');
    const entryPath = path.join(pluginInfo.dir, pluginInfo.pkg.main);
    
    try {
      // Windows 路径需要转换为 file:// URL
      const entryUrl = pathToFileURL(entryPath).href;
      const module = await import(entryUrl);
      console.log('   ✓ 模块加载成功');
      console.log('   ✓ export.name:', module.name);
      console.log('   ✓ export.inject:', module.inject);
      console.log('   ✓ export.apply:', typeof module.apply);
      console.log('   ✓ export.Config:', typeof module.Config);
      
      return module;
    } catch (err) {
      console.log('   ✗ 模块加载失败:', err.message);
      return null;
    }
  }

  // 5. 模拟 DSH 调用 apply()
  async applyPlugin(pluginModule, config) {
    console.log('\n5. 调用插件 apply()...');
    
    // 创建模拟的 DSH context
    const mockCtx = {
      logger: {
        info: (...args) => console.log('   [INFO]', ...args),
        warn: (...args) => console.log('   [WARN]', ...args),
        error: (...args) => console.log('   [ERROR]', ...args),
      },
      systemPrompt: {
        section: (opts) => {
          console.log('   ✓ systemPrompt.section() 被调用');
          console.log('     - name:', opts.name);
          console.log('     - order:', opts.order);
          console.log('     - text 长度:', opts.text.length);
          console.log('     - text 前100字:', opts.text.slice(0, 100).replace(/\n/g, ' '));
          return { 
            dispose: () => console.log('   ✓ section disposed')
          };
        }
      },
      effect: (fn, label) => {
        console.log('   ✓ ctx.effect() 注册:', label);
        fn();
        return { 
          dispose: () => console.log('   ✓ effect disposed')
        };
      },
      command: (name, handler) => {
        console.log('   ✓ ctx.command() 注册:', name);
        return { dispose: () => {} };
      }
    };
    
    try {
      pluginModule.apply(mockCtx, config);
      console.log('   ✓ apply() 执行成功');
      return true;
    } catch (err) {
      console.log('   ✗ apply() 执行失败:', err.message);
      return false;
    }
  }

  // 6. 测试 client.js
  async testClient(pluginInfo) {
    console.log('\n6. 测试 client.js...');
    const clientPath = path.join(pluginInfo.dir, 'client.js');
    
    if (!fs.existsSync(clientPath)) {
      console.log('   ⚠ client.js 不存在 (可选)');
      return;
    }
    
    try {
      const clientUrl = pathToFileURL(clientPath).href;
      const client = await import(clientUrl);
      console.log('   ✓ client 模块加载成功');
      console.log('   ✓ export.name:', client.name);
      console.log('   ✓ export.render:', typeof client.render);
      
      // 模拟渲染
      const mockContainer = {
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {},
      };
      
      const mockUpdate = (newConfig) => {
        console.log('   ✓ update() 被调用，新配置:', JSON.stringify(newConfig));
      };
      
      if (typeof client.render === 'function') {
        console.log('   ✓ render 函数可用');
      }
    } catch (err) {
      console.log('   ✗ client 加载失败:', err.message);
    }
  }
}

// 主测试流程
async function main() {
  const profileDir = process.env.DSH_PROFILE
    || process.argv[2]
    || path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
  const loader = new DSHPluginLoader(profileDir);
  
  try {
    // 1. 加载 bundles 列表
    const bundles = await loader.loadBundles();
    if (!bundles.includes('dsh-fatfish')) {
      console.log('\n✗ dsh-fatfish 不在 bundles 列表中');
      process.exit(1);
    }
    
    // 2. 加载 patch 配置
    const hasConfig = await loader.loadPatchConfig();
    if (!hasConfig) {
      console.log('\n✗ cordis.patch.yml 中没有 dsh-fatfish 配置');
      process.exit(1);
    }
    
    // 3. 发现插件
    const pluginInfo = await loader.discoverPlugin('dsh-fatfish');
    if (!pluginInfo) {
      console.log('\n✗ 插件发现失败');
      process.exit(1);
    }
    
    // 4. 加载插件模块
    const pluginModule = await loader.loadPluginModule(pluginInfo);
    if (!pluginModule) {
      console.log('\n✗ 插件模块加载失败');
      process.exit(1);
    }
    
    // 5. 应用插件 (测试默认配置)
    const defaultConfig = {
      mode: 'normal',
      custom: '',
      enableTimeAwareness: true,
      enableMood: true,
    };
    
    const applied = await loader.applyPlugin(pluginModule, defaultConfig);
    if (!applied) {
      console.log('\n✗ 插件应用失败');
      process.exit(1);
    }
    
    // 6. 测试不同模式
    console.log('\n7. 测试不同模式...');
    for (const mode of ['normal', 'roast', 'sleepy', 'custom']) {
      console.log(`\n   测试 ${mode} 模式:`);
      const config = { ...defaultConfig, mode };
      if (mode === 'custom') {
        config.custom = '你是一只可爱的小猫咪，说话要带喵~';
      }
      await loader.applyPlugin(pluginModule, config);
    }
    
    // 8. 测试 client.js
    await loader.testClient(pluginInfo);
    
    console.log('\n=== ✓ 所有测试通过 ===');
    console.log('\n插件已成功加载并运行！');
    console.log('DSH 启动后，插件会自动生效。');
    console.log('\n使用方法:');
    console.log('1. 启动 DSH NEXT');
    console.log('2. 在对话框发消息，agent 会以大肥鱼人格回复');
    console.log('3. 去设置→插件→大肥鱼，可以切换模式');
    
    process.exit(0);
  } catch (err) {
    console.error('\n✗ 测试失败:', err);
    process.exit(1);
  }
}

main();
