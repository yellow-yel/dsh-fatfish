# 安全说明

## 报告问题

发现安全问题请**不要**公开开 issue。发邮件到仓库维护者（GitHub 主页可见），
写清楚：复现步骤、影响版本、可能的后果。48 小时内回复。

## 威胁模型

插件运行在**你自己的电脑**上，被 DSH 里的 agent 调用。要防的不是「远程黑客」，
而是三类事：

1. **agent 被网页内容带偏**（提示注入），去做不该做的事；
2. **误操作**：点到付款、下单、下载、登录；
3. **越界**：读到日常浏览器的登录态、书签、历史。

## 内核里的硬边界（不依赖提示词）

| 能力 | 限制 | 实现位置 |
| --- | --- | --- |
| 打开网址 | 只允许 `http` / `https` | `EdgeSession.assertUrl` |
| 支付/网购/银行 | 域名黑名单，直接抛错 | `denyHosts` + `assertUrl` |
| 收银台/验证码页 | 标题或 URL 命中词表 → 只读，不点不输入 | `pageGuard` |
| 下载 | CDP `Browser.setDownloadBehavior=deny` | `EdgeSession.connect` |
| 密码输入 | 页面有 `input[type=password]` → 输入工具报错 | `EdgeSession.type` |
| 用户数据 | 独立 `--user-data-dir`，不读日常 Edge | `ensureEdge` |
| 调试端口 | 只听 `127.0.0.1` | `ensureEdge` |
| JavaScript 弹窗 | 默认 `cancel`，不替用户点确定 | `CDP._onMessage` |

插件**不提供**的能力：读剪贴板、读本地文件、执行任意 shell、发消息、结束进程、
修改系统设置。`fatfish_pc_status` 只读。

## 数据落在哪

| 内容 | 路径 |
| --- | --- |
| 专用浏览器配置 | `~/.dsh/fatfish-hands/edge-profile` |
| 截图 | `~/.dsh/fatfish-hands/shots` |
| 配置 | `~/.dsh/fatfish-hands.config.json` |

没有遥测，没有网络上报，没有云端账号。删掉目录即彻底清除。

## 已知限制

- 页面内容可能包含诱导性文字（提示注入）。模型层面的防护不可靠，因此关键动作
  （付款、登录、下载、发送消息）**在工具层直接拒绝**，而不是靠模型自觉。
- 域名黑名单是子串匹配，可能有漏网之鱼。发现新的支付/金融域名请提 issue。
- 无头模式（`headless: true`）下用户看不到页面在做什么，建议只在受控环境使用。

## 支持的版本

只对最新发布版本提供安全修复。
