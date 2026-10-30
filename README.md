# 大肥鱼 · DSH 插件市场版

住在电脑里的鱼，现在是一套：人格、手、额度护栏，外加路径自愈、脚本体检和一次装齐的套装。

| 包 | 一句话 | 版本 |
| --- | --- | --- |
| [`dsh-fatfish-suite`](dsh-fatfish-suite/) | **套装**：一次装齐下面三件，并带两个只读工具看状态与边界 | 0.1.0 |
| [`dsh-fatfish`](dsh-fatfish/) | 大肥鱼：四档人设 + 时段/情绪，本地记忆，只读查毒与可更新病毒库，七个小动作 | 0.5.0 |
| [`dsh-fatfish-hands`](dsh-fatfish-hands/) | 大肥鱼之手：让 agent 用你电脑上的 Edge 真上网——读正文、点链接、搜索、截图；支付/网银/下载硬拦截 | 0.1.3 |
| [`dsh-quota-guard`](dsh-quota-guard/) | 额度护栏：模型用量账本、每日/每分钟限额、免费账号轮换 | 0.1.3 |
| [`dsh-path-healer`](dsh-path-healer/) | 路径自愈：换电脑/换盘符后找回 Node、Python、Git、Edge、DSH、NapCat 的路径，写回 JSON 配置 | 0.1.1 |
| [`dsh-batch-doctor`](dsh-batch-doctor/) | 脚本体检：查/修 bat、cmd、ps1 的中文编码、CRLF、chcp、BOM 和写死路径 | 0.1.1 |

零依赖，只用 Node 22+ 内置能力。本地运行，不上传聊天内容，也不上传文件。
默认免费优先：套装不配置任何付费开关，也不自动充值；没配单价的模型会明确标成 `priced=false`。

仓库：[GitHub](https://github.com/yellow-yel/dsh-fatfish) ｜ 国内镜像：[Gitee](https://gitee.com/akiba-yuzuki_0/dsh-fatfish)
npm：[suite](https://www.npmjs.com/package/dsh-fatfish-suite) ｜ [fatfish](https://www.npmjs.com/package/dsh-fatfish) ｜ [hands](https://www.npmjs.com/package/dsh-fatfish-hands) ｜ [quota-guard](https://www.npmjs.com/package/dsh-quota-guard) ｜ [path-healer](https://www.npmjs.com/package/dsh-path-healer) ｜ [batch-doctor](https://www.npmjs.com/package/dsh-batch-doctor)

DSH 的市场是**索引源**制：设置 → 插件 → Discover → Index sources。本仓库根目录的 [`market-index.json`](market-index.json) 就是一份可直接填进去的 format-1 索引；社区索引（dshfind / awesome-dsh-plugin）按仓库的 `dsh-plugin` topic 抓，收录细节见 [上架说明](上架说明.md)。

## 安装

**推荐：只装套装**，一次挂上三件：

```bash
dsh plugin --profile desktop add dsh-fatfish-suite
```

也可以按需单独装：

```bash
dsh plugin --profile desktop add dsh-fatfish
dsh plugin --profile desktop add dsh-fatfish-hands
dsh plugin --profile desktop add dsh-quota-guard
dsh plugin --profile desktop add dsh-path-healer
dsh plugin --profile desktop add dsh-batch-doctor
```

> 套装和三件套**二选一**。已经单独装过其中任何一个，再装套装会出现重复挂载。

装完重启 DSH，在 **设置 → 插件** 里调人设、记忆、查毒和额度选项。

没有 npm 包时也可以直接挂本地目录（改完重启生效）：

```bash
dsh plugin --profile desktop add "link:<这个目录>/dsh-fatfish"
```

本目录还提供了 `装到DSH.bat`：默认把三个同伴复制进 `~/.dsh/profiles/desktop` 并各挂各的；
加 `--suite` 则四个目录都复制、只挂 `dsh-fatfish-suite`，避免重复。改之前都留备份；
`--remove` 还原。

## 这一套装能干什么

- **人设**：好脾气 / 毒舌 / 犯困 / 自定义，四档；按早晚调整语气，按时间算精力与心情。
- **记忆**：`~/.dsh/fatfish/memory.json` 本地事实库，对话里自动抽取名字、喜好、习惯、生日；可召回、可遗忘。
- **查毒**：只读检查可疑进程、开机启动项、常用目录里的可执行文件（进程名 + 命令行特征 + SHA-256）。**不删文件、不杀进程、不改注册表。**
- **病毒库**：内置规则 + HTTPS 订阅（默认每 12 小时检查），订阅文件就是本仓库根目录的 [`signatures.json`](signatures.json)。
- **动作**：伸懒腰 / 吐泡泡 / 打盹 / 被摸头 / 吃一口 / 翻肚皮 / 甩尾巴。
- **上网**：专用 Edge 配置读页面正文与链接、点编号链接、搜索、截图；不碰日常浏览器的登录态、书签、历史。
- **看电脑**：内存、开机时长、CPU、最占内存的进程；只读。
- **管额度**：每次模型调用记 token 与耗时；可按天/按分钟限额；免费账号之间自动轮换。
- **修路径**：`/pathhealer.check` 体检 Node/Python/Git/Edge/DSH/NapCat 路径，`/pathhealer.repair` 找回并写回 JSON 配置；写前 `.bak`，不联网、不执行命令。
- **查脚本**：`/batchdoctor.lint` 查中文 bat 的 UTF-8 串行、ps1 缺 BOM、chcp 不匹配、LF 行尾；`/batchdoctor.fix` 转码并统一 CRLF，写前 `.bak`。
- **套装自检**：`fatfish_suite_status` 看三件是否装齐、挂载、版本一致；`fatfish_suite_guide` 查各主题的用法与边界。

## 红线（写死在代码里，配置关不掉）

- 支付、网购、收银台、网银：拒绝打开、拒绝点击、拒绝输入；付款由主人完成。
- 不自动回复私聊：可以读聊天记录与通讯录，但回复必须由主人发出。
- 页面里有密码框：拒绝输入；浏览器只走专用配置，不碰你日常 Edge 的登录态、书签、历史。
- 下载默认拒绝；只允许 `http/https`，`file://` 等一律拒绝。
- 记忆拒收密码、验证码、证件号、银行卡、手机号、住址、API Key。
- 查毒只报告不处置；它不是完整杀毒软件，重要场合请用专业安全软件复扫。
- 无遥测、无云端账号；唯一的外发请求是病毒库更新和可选的模型调用。
- 额度护栏默认只记账；要用付费模型，必须自己改配置并先算清单价与预算。

## 开发

```bash
node dsh-fatfish/test/plugin.mjs        # 人设：DSH 契约 + 工具闭环
node dsh-fatfish/test/smoke.mjs         # 人设：记忆/人设/动作/病毒库
node dsh-fatfish/test/privacy.mjs       # 人设：发布隐私扫描 + 打包白名单
node dsh-fatfish-hands/test/plugin.mjs  # 手：契约检查（不开浏览器）
node dsh-fatfish-hands/test/smoke.mjs   # 手：真 Edge 跑本地离线页面（会弹一个窗口）
node --test dsh-quota-guard/test/*.test.js   # 额度护栏：30 项离线测试
node dsh-fatfish-suite/test/plugin.mjs  # 套装：工具注册、状态、指南、卸载
```

本机没装 Node 时用 DSH 自带的：`~/.dsh/dsh-runtimes/*/dependencies/node/bin/node.exe`。

## 上架

改完代码想发新版本，看 [上架说明.md](上架说明.md)。四个入口：

| 顺序 | 双击 | 做什么 |
| --- | --- | --- |
| 1 | `一键自检.bat` | 四套测试 + 隐私扫描 + 版本/索引/元数据一致性 + `npm pack` 白名单实测 |
| 2 | `一键上架.bat` | 对齐市场索引 → 提交打标签 → 推 Gitee 与 GitHub → 打包到 `dist/` |
| 3 | `发npm.bat` | 你亲自确认后才 `npm publish`（脚本不会自动发） |
| 0 | `装到DSH.bat` | 装进本机 DSH 验证，`--suite` 装套装，`--remove` 卸载 |

发布顺序必须是：先 `dsh-fatfish`、`dsh-fatfish-hands`、`dsh-quota-guard`，最后 `dsh-fatfish-suite`；
套装依赖这三个版本，前三个没上 npm 时套装装不上。

## License

MIT
