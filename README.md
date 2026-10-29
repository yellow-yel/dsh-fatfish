# 大肥鱼 · DSH 插件市场版

两条住在电脑里的鱼，两个 DSH 插件，一个可以直接上架的目录。

| 包 | 一句话 | 版本 |
| --- | --- | --- |
| [`dsh-fatfish`](dsh-fatfish/) | 大肥鱼：四档人设 + 时段/情绪，本地记忆，只读查毒与可更新病毒库，七个小动作 | 0.5.0 |
| [`dsh-fatfish-hands`](dsh-fatfish-hands/) | 大肥鱼之手：让 agent 用你电脑上的 Edge 真上网——读正文、点链接、搜索、截图；支付/网银/下载硬拦截 | 0.1.3 |

零依赖，只用 Node 22+ 内置能力。本地运行，不上传聊天内容，也不上传文件。

仓库：[GitHub](https://github.com/yellow-yel/dsh-fatfish) ｜ 国内镜像：[Gitee](https://gitee.com/akiba-yuzuki_0/dsh-fatfish)
npm：[dsh-fatfish](https://www.npmjs.com/package/dsh-fatfish) ｜ [dsh-fatfish-hands](https://www.npmjs.com/package/dsh-fatfish-hands)

DSH 的市场是**索引源**制：设置 → 插件 → Discover → Index sources。本仓库根目录的 [`market-index.json`](market-index.json) 就是一份可直接填进去的 format-1 索引；社区索引（dshfind / awesome-dsh-plugin）按仓库的 `dsh-plugin` topic 抓，收录细节见 [上架说明](上架说明.md)。

## 安装

在 DSH 的插件市场搜 `fatfish`，或者命令行：

```bash
dsh plugin --profile desktop add dsh-fatfish
dsh plugin --profile desktop add dsh-fatfish-hands
```

装完重启 DSH，在 **设置 → 插件** 里调人设、记忆、查毒和 Edge 选项。

没有 npm 包时也可以直接挂本地目录（改完重启生效）：

```bash
dsh plugin --profile desktop add "link:<这个目录>/dsh-fatfish"
```

本目录还提供了 `装到DSH.bat`：把两个插件复制进 `~/.dsh/profiles/desktop`，顺带写好 `bundles` 和 `cordis.patch.yml`，改之前都留备份；`--remove` 还原。

## 大肥鱼能干什么

- **人设**：好脾气 / 毒舌 / 犯困 / 自定义，四档；按早晚调整语气，按时间算精力与心情。
- **记忆**：`~/.dsh/fatfish/memory.json` 本地事实库，对话里自动抽取名字、喜好、习惯、生日；可召回、可遗忘。
- **查毒**：只读检查可疑进程、开机启动项、常用目录里的可执行文件（进程名 + 命令行特征 + SHA-256）。**不删文件、不杀进程、不改注册表。**
- **病毒库**：内置规则 + HTTPS 订阅（默认每 12 小时检查），订阅文件就是本仓库根目录的 [`signatures.json`](signatures.json)。
- **动作**：伸懒腰 / 吐泡泡 / 打盹 / 被摸头 / 吃一口 / 翻肚皮 / 甩尾巴。

工具与配置项的完整表格见 [dsh-fatfish/README.md](dsh-fatfish/README.md)。

## 红线（写死在代码里，配置关不掉）

- 支付、网购、收银台、网银：拒绝打开、拒绝点击、拒绝输入。
- 页面里有密码框：拒绝输入；浏览器只走专用配置，不碰你日常 Edge 的登录态、书签、历史。
- 下载默认拒绝；只允许 `http/https`，`file://` 等一律拒绝。
- 记忆拒收密码、验证码、证件号、银行卡、手机号、住址、API Key。
- 查毒只报告不处置；它不是完整杀毒软件，重要场合请用专业安全软件复扫。
- 无遥测、无云端账号；唯一的外发请求是病毒库更新和可选的独立 API 调用。

## 开发

```bash
node dsh-fatfish/test/plugin.mjs        # 人设：DSH 契约 + 工具闭环
node dsh-fatfish/test/smoke.mjs         # 人设：记忆/人设/动作/病毒库
node dsh-fatfish/test/privacy.mjs       # 人设：发布隐私扫描 + 打包白名单
node dsh-fatfish-hands/test/plugin.mjs  # 手：契约检查（不开浏览器）
node dsh-fatfish-hands/test/smoke.mjs   # 手：真 Edge 跑本地离线页面（会弹一个窗口）
```

本机没装 Node 时用 DSH 自带的：`~/.dsh/dsh-runtimes/*/dependencies/node/bin/node.exe`。

## 上架

改完代码想发新版本，看 [上架说明.md](上架说明.md)。四个入口：

| 顺序 | 双击 | 做什么 |
| --- | --- | --- |
| 1 | `一键自检.bat` | 三套测试 + 隐私扫描 + 版本/索引/元数据一致性 + `npm pack` 白名单实测 |
| 2 | `一键上架.bat` | 对齐市场索引 → 提交打标签 → 推 Gitee 与 GitHub → 打包到 `dist/` |
| 3 | `发npm.bat` | 你亲自确认后才 `npm publish`（脚本不会自动发） |
| 0 | `装到DSH.bat` | 装进本机 DSH 验证，`--remove` 卸载 |

## License

MIT
