# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.1.1 — 2026-10-28

npm 首发版本号调整：0.1.0 被 npm 的待批准流程占住，改用 0.1.1 发布。代码与 0.1.0 完全一致，只有版本号不同；GitHub / Gitee 的 `dsh-fatfish-hands-v0.1.0` 发行版对应同一份源码。

- npm：https://www.npmjs.com/package/dsh-fatfish-hands

## 0.1.0 — 2026-10-28

首个可发布版本。

**工具（12 个）**

- `fatfish_edge_open` / `read` / `click` / `type` / `press` / `scroll` / `back`：基于页面文字和链接编号的浏览闭环。
- `fatfish_edge_status` / `screenshot` / `close`：状态、截图、关闭专用窗口。
- `fatfish_doctor`：node / 脚本 / Edge / 端口 / 配置一键体检。
- `fatfish_pc_status`：只读的本机内存与进程概览。

**内核**

- 常驻 RPC 桥（`tools/edge-cli.mjs --rpc`），保证 `click index` 始终对应最近一次 `read` 的链接表。
- 专用 Edge 配置目录，独立调试端口，不触碰日常浏览器数据。
- 下载拒绝、支付/网购/银行域名拒绝、密码框禁止输入、只允许 http/https。
- 链接提取优先补全邻近标题文字，搜索页的「时间/来源」不再冒充标题。
- 搜索框回车不提交时自动 `requestSubmit` 兜底（必应等站点）。
- `_blank` 链接改为同页跳转，避免新标签页丢失控制。
- 截图前自动恢复最小化窗口，失败再用 `fromSurface:false` 兜底。
- 音视频页面静音暂停（含 Shadow DOM / 同源 iframe），截图不再卡 20 秒。
- 桥接进程 EOF 后 1.5 秒强制退出，不再残留 node 进程。

**测试**

- `test/smoke.mjs`：本地网页离线跑通 11 项（含支付站点、file://、密码页三类安全拦截）。
- `test/plugin.mjs`：桩 ctx 验证工具注册、schema、render 与卸载。
