# dsh-fatfish · 大肥鱼

给 DSH（DeepSeek Harness）的 agent 套上一条胖乎乎的大肥鱼：**会聊、会记事、会查毒、会卖萌**。

零依赖，只用 Node 22+ 内置能力；本地运行，不上传聊天和文件。

## 它能干什么

| 能力 | 说明 |
| --- | --- |
| 人设 | 好脾气 / 毒舌 / 犯困 / 自定义，四种模式；时段感知 + 情绪状态 |
| 红线 | 隐私、钱、家人、人身攻击四条线写死，任何模式都关不掉 |
| 记忆 | 本地事实库；对话里自动抽取名字、喜好、习惯、生日；可召回、可遗忘 |
| 查毒 | 只读检查可疑进程、开机启动项、常用目录里的可执行文件；进程名 + 命令行 + 文件哈希 |
| 病毒库 | 内置规则 + HTTPS 订阅，默认每 12 小时检查一次，可手动更新 |
| 动作 | 伸懒腰 / 吐泡泡 / 打盹 / 被摸头 / 吃一口 / 翻肚皮 / 甩尾巴 |
| 独立 API | 可选接智谱 / 通义 / DeepSeek，不依赖 DSH 自身的模型 |

## 安装

在 DSH 的插件市场搜索 **dsh-fatfish**，或命令行：

```bash
dsh plugin --profile desktop add dsh-fatfish
```

本地开发：

```bash
dsh plugin --profile desktop add "link:C:\path\to\dsh-fatfish"
```

装完重启 DSH，在 **设置 → 插件 → 大肥鱼** 里调模式、记忆和查毒选项。

## agent 会用的工具

| 工具 | 用途 |
| --- | --- |
| `fatfish_memory_save` | 记一条长期事实（密码/验证码/证件/银行卡会被拒收） |
| `fatfish_memory_recall` | 按关键词找记忆；留空则列最近几条 |
| `fatfish_memory_forget` | 按 id 或描述删记忆，没有「清空全部」 |
| `fatfish_security_status` | 看病毒库版本、规则数量、上次扫描 |
| `fatfish_security_update` | 从 https 订阅地址更新病毒库 |
| `fatfish_security_scan` | 查进程 / 启动项 / 指定目录，只报告不处置 |
| `fatfish_act` | 做一个动作并说一句符合人设的话 |

命令面板里还有：`fatfish.remember`、`fatfish.recall`、`fatfish.scan`、`fatfish.act`；启用独立 API 后多一个 `fatfish.chat`。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `normal` | `normal` / `roast` / `sleepy` / `custom` |
| `custom` | `""` | 自定义人设，仅 `mode: custom` 时生效，最多 600 字 |
| `enableTimeAwareness` | `true` | 按早上/中午/晚上/深夜调整语气 |
| `enableMood` | `true` | 按时间计算精力，影响心情和话量 |
| `memory.enabled` | `true` | 本地记忆开关 |
| `memory.autoCapture` | `true` | 从对话里自动抽取事实 |
| `memory.maxFacts` | `300` | 记忆上限，50–1000 |
| `security.enabled` | `true` | 本地安全检查开关 |
| `security.feedUrl` | 官方 Gitee 源 | 病毒库 HTTPS 订阅地址；留空只用内置库 |
| `security.autoUpdate` | `true` | 自动更新病毒库 |
| `security.updateHours` | `12` | 自动更新间隔，1–168 小时 |
| `api.enabled` | `false` | 启用独立 API 聊天命令 |
| `api.provider` | `zhipu` | `zhipu` / `qwen` / `deepseek` |
| `api.apiKey` | `""` | 对应平台的 Key，只存本地 |
| `api.model` | 按平台 | 例如 `glm-4-flash`、`qwen-turbo`、`deepseek-chat` |

改配置可以走设置页，也可以编辑用户层 `cordis.patch.yml`：

```yaml
- id: dsh-fatfish
  name: dsh-fatfish
  config:
    mode: roast
    memory:
      enabled: true
    security:
      autoUpdate: true
```

## 记忆

- 存在 `~/.dsh/fatfish/memory.json`，只写本机。
- agent 听到「我叫…」「我的生日是…」「我喜欢…」「我每天…」这类长期事实，会按人设调用 `fatfish_memory_save` 记下；独立 API 的 `fatfish.chat` 命令还会用规则自动抽取。
- 密码、验证码、身份证、银行卡、手机号、住址、API Key 一律拒收。
- 召回只返回相关几条，不会把整库倒给模型。
- 遗忘需要明确指令；不给 id 时至少给两个字。

## 查毒

- 只读：**不删文件、不杀进程、不改注册表**。发现可疑项会说明原因，处置由你自己决定。
- 检查范围：进程名、命令行特征（如编码 PowerShell、`certutil` 下载）、启动项、下载/桌面/临时目录里的可执行文件，以及 SHA-256 哈希。
- 病毒库结构：`processes` / `commandPatterns` / `fileNames` / `hashes`，内置库与在线库合并使用。
- 官方订阅文件在仓库根目录 `signatures.json`；自建源只要是 https 的同样结构 JSON 即可。
- **它不是完整杀毒软件**：基于特征匹配，可能漏报，也可能把同名工具当成可疑项。重要场合请用专业安全软件复扫。

## 隐私

- 没有遥测、没有云端账号、不上传文件。
- 唯一的网络请求：可选的病毒库更新、可选的独立 API 调用。
- 删除 `~/.dsh/fatfish` 即清空记忆和查毒缓存。

## 卸载

设置 → 插件里移除 `dsh-fatfish`，或：

```bash
dsh plugin --profile desktop remove dsh-fatfish
```

## 开发

```bash
node test/plugin.mjs    # DSH 契约 + 工具闭环
node test/smoke.mjs     # 记忆/人设/动作/病毒库
node test/privacy.mjs   # 发布隐私扫描 + 打包白名单
```

只依赖 Node 22+，不需要 `npm install`。

## License

MIT
