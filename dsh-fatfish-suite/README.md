# dsh-fatfish-suite · 大肥鱼套装

一条命令，把大肥鱼这几天的三件能力一起装进 DSH：

| 同伴包 | 它负责什么 | 版本 |
| --- | --- | --- |
| [`dsh-fatfish`](https://www.npmjs.com/package/dsh-fatfish) | 四档人设、时段与情绪、本地记忆、只读查毒与可更新病毒库、七个小动作 | 0.5.0 |
| [`dsh-fatfish-hands`](https://www.npmjs.com/package/dsh-fatfish-hands) | 用专用 Edge 真上网：读正文、点链接、搜索、截图；另带只读电脑状态 | 0.1.3 |
| [`dsh-quota-guard`](https://www.npmjs.com/package/dsh-quota-guard) | 模型用量账本、每日/每分钟限额、免费账号轮换 | 0.1.3 |

套装本身不联网、不读聊天、不执行命令；它只做两件事：把三件挂进 DSH，以及提供两个只读工具
`fatfish_suite_status`（装齐了没）和 `fatfish_suite_guide`（怎么用、边界在哪）。

## 安装

在 DSH 插件市场搜 `fatfish`，或者：

```bash
dsh plugin --profile desktop add dsh-fatfish-suite
```

装完重启 DSH。设置 → 插件里能看到三个条目：

- **大肥鱼**：人设、记忆、查毒、动作；
- **大肥鱼之手**：首次调用会自动起一个专用 Edge 窗口；
- **额度护栏**：默认只记账，不拦请求。

> 套装和三件套**二选一**。已经单独装过其中任何一个，再装套装会出现重复挂载；
> 请先卸掉单独装的包，或者只装三件套、不装套装。

本地目录安装（还没发 npm 时）：

```bash
node scripts/install-to-dsh.mjs --suite
```

它会把套装和三个同伴复制进 `~/.dsh/profiles/desktop/node_modules/`，
只把 `dsh-fatfish-suite` 写进 profile 的 `bundles`，避免重复挂载；改之前留 `.bak-<时间戳>` 备份。

## 装完能干什么

- **聊天有性格**：好脾气 / 毒舌 / 犯困 / 自定义；按早晚调整语气，按时间算精力与心情。
- **记得住**：名字、喜好、习惯、生日记在本机 `~/.dsh/fatfish/memory.json`；能召回、能遗忘。
- **会查毒**：进程名、命令行、开机启动项、常用目录文件哈希；只报告，不删文件、不杀进程。
- **会上网**：读页面正文和链接，点编号链接、搜索、截图；不靠像素坐标猜位置。
- **看得到电脑**：内存、开机时长、CPU、最占内存的进程；只读。
- **管得住额度**：每次模型调用记 token 与耗时，可按天/按分钟设上限，免费账号之间自动切换。

## 默认免费优先

套装不配置任何付费开关，也不会自动充值或自动切到付费账号：

- 额度护栏默认所有限额为 `0`（只记账，不拦）；没配单价的模型会标 `priced: false`，
  `costCny: 0` **不代表免费**。
- 要限额，在 DSH 用户层 `cordis.patch.yml` 覆盖 `id: llm-guard`：

```yaml
- id: llm-guard
  name: dsh-quota-guard
  config:
    limits:
      dailyTokens: 2000000
      dailyRequests: 1500
      perMinuteRequests: 30
      warnAt: 0.8
      onExceed: warn        # 先用 warn 观察一周，再考虑 block
```

- 要用付费模型，必须自己改配置，并先算清楚单价与预算；套装不会替你做这个决定。

## 红线（写在各插件内核里，配置关不掉）

- **不自动回复私聊**：可以读聊天记录与通讯录，但回复必须由主人发出。
- **不代付**：支付、网购、收银台、网银页面拒绝打开、点击与输入；付款由主人完成。
- **不碰日常浏览器**：之手只使用独立配置 `~/.dsh/fatfish-hands/edge-profile`，
  不读日常 Edge 的登录态、书签、历史。
- **不下载**：默认拒绝，只允许 `http/https`，`file://` 一律拒绝。
- **不记敏感信息**：密码、验证码、证件号、银行卡、手机号、住址、API Key 一律拒收。
- **不上传**：无遥测、无云端账号；唯一外发是病毒库订阅和主人自己配置的模型调用。
- **查毒不处置**：只报告；重要场合请用专业安全软件复扫。

## 配置在哪

| 内容 | 位置 |
| --- | --- |
| 人设 / 记忆 / 查毒选项 | DSH 用户层 `cordis.patch.yml` 的 `id: dsh-fatfish` |
| Edge 选项 | `~/.dsh/fatfish-hands.config.json` |
| 额度限额与账号池 | DSH 用户层 `cordis.patch.yml` 的 `id: llm-guard` |
| 记忆与查毒缓存 | `~/.dsh/fatfish/` |
| 浏览器配置与截图 | `~/.dsh/fatfish-hands/` |
| 用量账本 | `~/.dsh/llm-guard/usage.json` |

删掉对应目录即清空那一部分数据；卸载套装不会自动删这些目录。

## 与桌面完整版的关系

电脑上的「大肥鱼陪伴」独立程序是完整版：独立窗口、桌宠气泡、聊天存档、自动备份、
加密保险库、本地 OpenAI 兼容中转。套装是 DSH 插件形态，两者不共享进程：

- 套装不会自动读独立版的记忆，也不会替它回复私聊；
- 想日常陪伴与本地中转，用独立程序；
- 想让 DSH 里的 agent 上网、查毒、管额度，用套装。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-fatfish-suite
dsh plugin --profile desktop remove dsh-fatfish dsh-fatfish-hands dsh-quota-guard
```

然后按需删 `~/.dsh/fatfish*`、`~/.dsh/llm-guard`。卸载不会删除你的聊天记录或桌面版数据。

## 开发

```bash
node dsh-fatfish-suite/test/plugin.mjs      # 套装契约：工具注册、状态、指南、卸载
node dsh-fatfish/test/plugin.mjs            # 人设契约
node dsh-fatfish-hands/test/plugin.mjs      # 之手契约（不开浏览器）
node dsh-quota-guard/test/*.test.js         # 额度护栏离线测试
```

## License

MIT
