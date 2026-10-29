# 安全说明

## 报告问题

发现安全问题**不要**公开开 issue。用仓库的 GitHub Security Advisories 私下报告，
或直接联系维护者。写清楚：复现步骤、影响版本、可能后果。48 小时内回复。

## 威胁模型

插件跑在**你自己的电脑**上，被 DSH 里的 agent 调用。要防的是：

1. agent 被网页或聊天内容带偏，去记不该记的东西、做越界操作；
2. 误操作：删记忆、删文件、杀进程、把 Key 写进记忆；
3. 越界：把本机文件或聊天内容上传到外部。

## 硬边界（不依赖提示词）

| 能力 | 限制 | 实现位置 |
| --- | --- | --- |
| 记忆写入 | 密码/验证码/证件/银行卡/手机号/住址/API Key → 直接报错 | `memory.containsSecret` |
| 记忆清空 | 没有「清空全部」；遗忘必须给 id 或至少两个字的描述 | `forgetFacts` |
| 文件删除 | 不提供任何删除文件能力 | 内核无 `unlink` / `rm` |
| 进程处置 | 只读枚举，不杀进程 | `security.listProcesses` |
| 注册表 | 只读启动项，不写不删 | `security.listStartup` |
| 病毒库下载 | 只接受 `https://`，限制 2 MB，拒绝跳转到 http，原子写入 | `updateSignatures` |
| API Key 输出 | 工具返回和日志都不回显 Key | `persona` / `index` |
| 网络 | 只有病毒库订阅和可选的 API 调用；无遥测 | `security` / `persona` |
| 数据位置 | 记忆和查毒缓存只写 `~/.dsh/fatfish` | `memory.dataDir` |

**不提供**：执行 shell、读任意文件内容、读剪贴板、发消息、改系统设置、自动更新插件本身。

## 数据落在哪

| 内容 | 路径 |
| --- | --- |
| 记忆事实 | `~/.dsh/fatfish/memory.json` |
| 病毒库缓存 / 扫描状态 | `~/.dsh/fatfish/security/` |
| 插件配置（含可选 API Key） | DSH 用户层 `cordis.patch.yml` |

没有遥测，没有云端账号。删掉 `~/.dsh/fatfish` 即清空记忆与查毒缓存。

## 已知限制

- 查毒是**特征匹配**，不是完整杀毒引擎：可能漏报，也可能把同名工具误报为可疑。
- 命令行检查依赖 PowerShell；CIM 不可用时退回 `Get-Process` / `tasklist`，此时拿不到完整命令行。
- 记忆抽取是规则匹配，可能把玩笑话记成事实；主人可以用 `fatfish_memory_forget` 删掉。
- 提示注入可能让 agent 尝试调用工具，但写记忆有隐私闸门，查毒只报告不处置。
- 官方订阅源和 API 都走公网；网络被劫持的风险由 HTTPS 承担，插件不做证书 pinning。

## 支持版本

只对最新发布版本提供安全修复。
