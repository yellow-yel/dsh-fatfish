# dsh-fatfish

两条住在电脑里的鱼，两个 DSH 插件。

| 包 | 一句话 | 版本 |
| --- | --- | --- |
| [`dsh-fatfish`](dsh-fatfish/) | 大肥鱼人设：短句、口语、有情绪，四档可切换（日常 / 毒舌 / 犯困 / 自定义） | 0.4.0 |
| [`dsh-fatfish-hands`](dsh-fatfish-hands/) | 让 agent 用你电脑上的 Edge 真上网：读正文、点链接、搜索、截图；支付/登录/下载硬拦截 | 0.1.0 |

配套的桌面陪伴终端见 [docs/](docs/)（测试报告、发布清单）。

仓库：[GitHub](https://github.com/yellow-yel/dsh-fatfish) ｜ 国内镜像：[Gitee](https://gitee.com/akiba-yuzuki_0/dsh-fatfish)。插件市场按 `dsh-plugin` topic 收录本仓库，安装与升级都以这里的发布包为准。

## 安装

```bash
dsh plugin --profile desktop add dsh-fatfish
dsh plugin --profile desktop add dsh-fatfish-hands
```

装完重启 DSH。

- 人设设置：设置 → 插件 → 大肥鱼人设
- 手的设置：设置 → 插件 → 大肥鱼之手（Edge 路径、端口、窗口大小）
- 手的体检：在对话里让 agent 调用 `fatfish_doctor`

## 红线（写死在代码里）

- 支付、网购、收银台、网银：拒绝打开、拒绝点击、拒绝输入
- 页面里有密码框：拒绝输入
- 只允许 `http/https`，`file://` 等一律拒绝
- 下载默认拒绝（`Browser.setDownloadBehavior = deny`）
- 用专用 Edge 配置（`~/.dsh/fatfish-hands/edge-profile`），不碰你日常浏览器的登录态、书签、历史

## 开发

```bash
# 契约检查（不开浏览器、不联网）
node dsh-fatfish-hands/test/plugin.mjs

# 浏览器冒烟（会开一个 1440x900 的 Edge 窗口，本地离线页面）
node dsh-fatfish-hands/test/smoke.mjs

# 人设插件：模拟 DSH 加载
node dsh-fatfish/simulate-dsh-load.mjs

# 人设插件：/fatfish.chat 命令
node dsh-fatfish/test-chat-command.mjs
```

本机没有 Node 时，用 DSH 自带的：`~/.dsh/dsh-runtimes/*/dependencies/node/bin/node.exe`。

## 测试状态

2026-10-28：

- 契约检查：12 个工具全注册、卸载全注销、schema / render 齐全
- 浏览器冒烟：11/11（连跑两遍）
- 人设：四档文本长度 509 / 605 / 557 / 545 字，设置页可渲染
- 详见 [docs/测试报告.md](docs/测试报告.md)

## License

MIT
