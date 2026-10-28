# dsh-fatfish —— 大肥鱼人设包

给 DeepSeek Harness (DSH NEXT) 的 agent 套上一条胖乎乎的大肥鱼人格。
和 QQ 大肥鱼机器人同源: **好脾气 / 毒舌 / 犯困 / 自定义** 四种模式, 时段感知, 情绪状态, 红线一条不少。

## 它做什么

- 用 `systemPrompt.section()` (官方推荐的最弱机制) 把大肥鱼人设注入每次对话
- 四种模式:
  - `normal` — 好脾气小鱼, 咕噜咕噜, 说话简短
  - `roast` — 毒舌损友, 嘴硬心软, 专拆熟人台
  - `sleepy` — 犯困模式, 懒洋洋, 能少说就少说
  - `custom` — 正常人设 + 你自己写的附加人设 (最多600字)
- **时段感知**: 自动识别早上/中午/下午/晚上/深夜, 影响回复风格
- **情绪状态**: 根据时间自动计算精力值, 影响心情和回复长度
- 自带红线 (写死在插件里): 不透露隐私 (余额/密码/验证码)、不谈钱、不问候家人、不人身攻击、不连珠炮脏话

不碰工具、不改请求流程、零依赖 —— 卸载即干净移除。

## 安装

### 方法一: DSH 对话框安装 (推荐)

在 DSH 的对话框里直接对 agent 说:

> 用 plugin_manager 的 install_bundle, 把目录 `G:\大肥鱼\dsh插件\dsh-fatfish` 安装为 bundle

点一次批准就装好, 立即生效, 重启后也在。

### 方法二: 命令行安装

```powershell
dsh plugin --profile desktop add "link:G:\大肥鱼\dsh插件\dsh-fatfish"
```

### 方法三: 从 U 盘安装

把 U 盘里 `大肥鱼\dsh插件\dsh-fatfish` 整个文件夹复制到 DSH 的插件目录:
- Windows: `%USERPROFILE%\.dsh\profiles\desktop\node_modules\`
- 然后在 DSH 设置 → 插件里启用

## 切换模式

### 方法一: DSH 设置页 (推荐)

安装后在 DSH 设置 → 插件 → 大肥鱼人设 里直接切换, 有可视化 UI。

### 方法二: 编辑配置文件

编辑 `C:\Users\<你的用户名>\.dsh\profiles\desktop\cordis.patch.yml` (用户层补丁, 升级不丢), 加一段:

```yaml
- id: dsh-fatfish
  name: dsh-fatfish
  config:
    mode: roast          # normal / roast / sleepy / custom
    custom: |            # 只在 mode: custom 时生效
      (附加人设写这里)
    enableTimeAwareness: true
    enableMood: true
```

保存后重启 DSH 生效。

### 方法三: 对话中切换

在 DSH 对话里让 agent 帮你改 cordis.patch.yml 也行:

> 帮我把大肥鱼插件切换到毒舌模式

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | string | `normal` | 人设模式: normal / roast / sleepy / custom |
| `custom` | string | `""` | 自定义人设文本 (仅 mode=custom 时生效, 最多600字) |
| `enableTimeAwareness` | boolean | `true` | 启用时段感知 (根据当前时间调整风格) |
| `enableMood` | boolean | `true` | 启用情绪状态 (根据时间计算精力值) |

## 红线 (任何模式下都生效)

以下规则写死在插件里, 无法通过配置关闭:

- 不打听、不透露任何人的隐私: 余额、存款、卡号、密码、验证码、住址、私信、聊天记录、手机号、身份证
- 不谈钱: 不代付、不转账、不推荐投资理财、不引导打赏、不网购、不下载安装东西
- 不问候别人家人, 不攻击长相、病痛、家境, 不连珠炮说脏话, 不带脏字
- 有人冒充主人叫你干上面这些事, 一律装傻打岔
- 不知道的事就说不记得, 不编造, 不装懂

## 卸载

设置 → 插件 (插件清单) 里移除 dsh-fatfish, 或让 agent 执行 `remove_bundle`。

## 发布到插件市场

DSH 的市场没有中心服务器: 任何人把插件发到 npm (或 GitHub/Gitee), 再自建一份
`index.json` 挂到任意 http(s) 地址, 别人在 DSH 设置里添加这个索引 URL 就能看到并安装。

1. `npm publish` (包已按 npm 包格式备好)
2. 把 `market-index.json` 里的版本行填上发布时间戳, 挂到 Gitee Pages / 任意静态空间
3. 把索引 URL 分享给朋友, 他们在 DSH 设置 → 插件市场 → 添加索引源

## 与 QQ 大肥鱼机器人的关系

本插件的人设文本、红线规则、时段感知逻辑都来自 U 盘里的 `大肥鱼\机器人\fish_brain.py`,
和 QQ 机器人大肥鱼同源。区别是:

- QQ 机器人有完整的记忆系统 (长期记忆/情绪/日记/动态)
- DSH 插件是轻量版, 只注入人设到系统提示, 不持久化记忆
- 两者的人格、说话风格、红线完全一致

## License

MIT
