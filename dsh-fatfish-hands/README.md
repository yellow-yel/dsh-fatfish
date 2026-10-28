# dsh-fatfish-hands · 大肥鱼之手

给 DSH（DeepSeek Harness）里的 agent 一双手：**用你电脑上已装的 Microsoft Edge 真上网**。

不是截图猜坐标那套。它直接读页面的标题、正文和链接，再按编号去点——所以能真的逛 B 站、搜新闻、翻文章、填搜索框，而不是对着像素碰运气。

```
你：去 B 站逛逛，挑两个视频看看，回来告诉我看了什么
它：open → read → click [9] → 记下标题和简介 → click [20] → 一句话总结
```

- **零安装浏览器**：用系统自带 Edge，不下载 Chromium。
- **不碰你的日常浏览器**：独立配置目录，没有你的登录态、书签、历史。
- **有硬边界**：支付/网购/银行站点拒绝访问，下载一律拒绝，密码框禁止输入。
- **无第三方依赖**：只用 Node 22+ 内置的 WebSocket 说 CDP。

---

## 安装

### 从 DSH 插件市场

在 DSH 里搜索 **dsh-fatfish-hands** 安装，或命令行：

```bash
dsh plugin --profile desktop add dsh-fatfish-hands
```

### 本地源码（开发/试用）

```bash
git clone <本仓库>
dsh plugin --profile desktop add "link:C:\path\to\dsh-fatfish-hands"
```

装完**重启 DSH**，然后在对话里说一句「用 fatfish_doctor 体检一下」。

> `cordis.patch.yml` 里的 `name:` 必须和包名完全一致（`dsh-fatfish-hands`），否则会出现「装上了但工具不出现」。

---

## 工具一览

| 工具 | 作用 |
| --- | --- |
| `fatfish_edge_status` | 当前页面、调试端口、配置目录（第一次调用会启动 Edge） |
| `fatfish_edge_open` | 打开 http/https 网址，返回标题 + 链接 + 正文 |
| `fatfish_edge_read` | 重新读当前页（标题 / 带编号的链接 / 正文节选） |
| `fatfish_edge_click` | 按 `index`（最近一次 read 的编号）/ 可见文字 / CSS 选择器点击 |
| `fatfish_edge_type` | 在输入框打字，`submit: true` 回车提交 |
| `fatfish_edge_press` | 按键：Enter / Tab / Escape / PageDown / Home … |
| `fatfish_edge_scroll` | 滚动页面（正数向下） |
| `fatfish_edge_back` | 后退一页 |
| `fatfish_edge_screenshot` | 截图存 PNG，返回路径 |
| `fatfish_edge_close` | 关掉专用 Edge 窗口（不动你日常用的 Edge） |
| `fatfish_doctor` | 体检 node / 脚本 / Edge / 端口 / 配置 |
| `fatfish_pc_status` | 只读看内存占用、开机时长、最占内存的进程 |

推荐节奏：`open` → `read` → `click(index)` → `read` … 每步都基于上一页真实文字决策。

---

## 它到底能干什么

- 「去 B 站首页挑两个视频看看，回来用一句话告诉我」——会点开两个视频，记下标题和简介后总结。
- 「搜一下今天的科技新闻，读两条」——自动在搜索框输入、回车、点开两条正文。
- 「打开某某文档页，把目录列给我」——读正文和小标题，不用截图。
- 「帮我看下这台电脑现在卡不卡」——`fatfish_pc_status`，只读。
- 看图/验证码类页面读不出字时——`fatfish_edge_screenshot` 落一张 PNG。

它**不做**的事写在下面，是硬编码在内核里的，不靠提示词自觉。

---

## 安全与隐私

专用 Edge 的配置目录是 `~/.dsh/fatfish-hands/edge-profile`，和你的日常 Edge 完全隔离。

| 边界 | 行为 |
| --- | --- |
| 支付 / 网购 / 银行 | `alipay.com`、`taobao.com`、`jd.com`、`paypal.com`、各大银行域名等直接拒绝打开 |
| 收银台 / 验证码页面 | 识别到相关字样后只读，不点、不输入 |
| 下载 | CDP 层 `Browser.setDownloadBehavior=deny`，一律拒绝 |
| 密码框 | 页面存在 `input[type=password]` 时，输入工具直接报错 |
| 协议 | 只允许 `http/https`，`file://`、`javascript:` 一律拒绝 |
| 剪贴板 / 本地文件 | 不提供这类能力 |
| 数据外传 | 无遥测、无上报；截图和日志只落在本机 |

- 调试端口只绑 `127.0.0.1`，不对外网开放。
- 扫码登录、输密码、付款这类事请主人自己来——插件会明确拒绝并说明原因。

发现问题请见 [SECURITY.md](SECURITY.md)。

---

## 配置

可选，文件：`~/.dsh/fatfish-hands.config.json`（不存在就用默认值）。

```json
{
  "edgePath": "",
  "port": 9333,
  "profileDir": "",
  "maxChars": 6000,
  "maxLinks": 40,
  "windowSize": "1440,900",
  "headless": false,
  "denyHosts": ["alipay.com", "taobao.com", "..."],
  "denyPageWords": ["收银台", "确认付款", "支付密码", "验证码", "checkout"]
}
```

| 字段 | 说明 |
| --- | --- |
| `edgePath` | Edge 可执行文件路径；空则自动找 |
| `port` | CDP 调试端口，默认 9333 |
| `profileDir` | 专用配置目录，空则 `~/.dsh/fatfish-hands/edge-profile` |
| `maxChars` / `maxLinks` | 单次读取的默认上限 |
| `windowSize` | 窗口大小，默认 1440x900 |
| `headless` | 无头模式（看不到窗口，适合服务器） |
| `denyHosts` | 额外要拉黑的域名（子串匹配） |
| `denyPageWords` | 出现在标题/网址里就只读不动的词 |

环境变量：`FATFISH_EDGE_PATH`（Edge 路径）、`FATFISH_HANDS_CLI`（edge-cli.mjs 路径）、`DSH_NODE`（node 路径）、`DSH_HOME`。

---

## 常见问题

**体检说找不到 node**
DSH 桌面端的 `process.execPath` 是 Electron 主程序，不能当 node 用。插件会去 `~/.dsh/dsh-runtimes/*/dependencies/node/bin` 找 DSH 自带的运行时；找不到就设 `DSH_NODE` 指到真正的 `node.exe`。

**端口 9333 被占用**
改配置里的 `port`，或关掉占用的程序。插件不会去抢端口。

**截图是黑屏 / 一直超时**
最小化的窗口截不到图。`fatfish_edge_screenshot` 会先把窗口恢复正常态；如果你用远程桌面锁屏了，画面本身也是黑的。

**点 index 点错东西**
`index` 只对应「最近一次 read/open 返回的链接列表」。中间如果做了别的操作（比如 scroll 后又 read），要按最新那份列表的编号来。

**Edge 窗口一直弹出来**
这就是它的工作方式——你看得到她在点什么。不想要窗口可以设 `headless: true`。

**和日常 Edge 冲突吗**
不会。独立 `--user-data-dir`，独立端口，互不影响。

**多个对话同时用会打架吗**
插件是**一个浏览器实例**：两个对话同时操作时，页面和链接编号会互相覆盖。
建议同一时间只让一个会话操作 Edge；另一个用 `fatfish_edge_status` 看看当前页面再决定。

**工具返回的正文太长/太短**
`fatfish_edge_read` 和 `fatfish_edge_open` 都支持 `maxChars`（默认 4000，最多 20000）和 `maxLinks`（默认 25，最多 60）。要读长文就调大 `maxChars`，只是找链接就调小。

---

## 开发与测试

需要 Node 22+（用内置 WebSocket）。

```bash
# 离线冒烟：起本地小网页，验证 open/read/click/type/back/shot/status/doctor 和安全拦截
node test/smoke.mjs

# 插件契约：桩 ctx 装载一遍，检查工具注册与卸载
node test/plugin.mjs

# 手工真站测试（会打开 B 站首页）
node test/manual.mjs https://www.bilibili.com
```

目录：

```
lib/
  index.js     插件入口：12 个工具的注册与渲染
  bridge.js    常驻 RPC 桥（node 运行时解析 + 一行一 JSON）
  edge.js      Edge/CDP 内核：导航、读取、点击、输入、截图、安全拦截
  pc.js        本机状态（只读）
tools/
  edge-cli.mjs 命令行 / RPC 入口，也能单独用
```

`tools/edge-cli.mjs` 可以脱离 DSH 单独用：

```bash
node tools/edge-cli.mjs open '{"url":"https://www.bilibili.com"}'
node tools/edge-cli.mjs read '{"maxLinks":20}'
node tools/edge-cli.mjs shot '{"out":"C:\\tmp\\a.png"}'
```

---

## 许可

MIT。详见 [LICENSE](LICENSE)。
