# 发布到 DSH 插件市场

目标：让别人在 DSH 里搜得到、一条命令装得上。

## 1. 发布前检查

```bash
node test/plugin.mjs     # 插件契约 + 工具 schema
node test/smoke.mjs      # 真实 Edge 跑本地网页（10 项）
```

两份都全绿再发。另外确认：

- [ ] `package.json` 的 `version` 已 bump（对照 `CHANGELOG.md`）
- [ ] `package.json` 的 `dsh.bundle.patch` 指向 `./cordis.patch.yml`
- [ ] `cordis.patch.yml` 里 `name` 与包名完全一致（`dsh-fatfish-hands`）
- [ ] `files` 覆盖 `lib`、`tools`、`cordis.patch.yml`、README、LICENSE
- [ ] README 的安装命令和工具表与实际一致
- [ ] 没有提交 `node_modules`、`.env`、本机路径、令牌

自检安装包内容：

```bash
npm pack --dry-run
```

## 2. 推到 GitHub

仓库名建议与包名一致：`dsh-fatfish-hands`。

```bash
git init
git add .
git commit -m "feat: dsh-fatfish-hands 0.1.0 — Edge hands for DSH agents"
git remote add origin https://github.com/<you>/dsh-fatfish-hands.git
git push -u origin main
```

**关键一步**：给仓库打上 `dsh-plugin` topic。DSH 插件市场按这个 topic 收录。

```bash
gh repo edit --add-topic dsh-plugin,deepseek-harness,edge,browser-automation
```

再发一个 Release，tag `v0.1.0`，附 `npm pack` 产物。

## 3. 发 npm（可选，但推荐）

DSH 的 `dsh plugin add dsh-fatfish-hands` 走 npm 解析；发上去安装体验最好。

```bash
npm login
npm publish --access public
```

先确认包名没被占用：`npm view dsh-fatfish-hands version`。

## 4. 装到本机验证

```bash
dsh plugin --profile desktop add dsh-fatfish-hands
# 或本地源码
dsh plugin --profile desktop add "link:C:\path\to\dsh-fatfish-hands"
```

重启 DSH，新建对话，发一句：

> 用 fatfish_doctor 体检一下，然后打开 https://www.bilibili.com 读一下首页标题

应看到工具被调用、Edge 窗口弹出、返回页面标题和链接列表。

卸载：

```bash
dsh plugin --profile desktop remove dsh-fatfish-hands
```

## 5. 版本节奏

- 修 bug：patch（0.1.1）
- 加工具/加参数：minor（0.2.0）
- 改工具名/改默认安全策略：major（1.0.0），并在 CHANGELOG 写清迁移

每次发布都更新 `CHANGELOG.md`，Release notes 直接抄对应小节。
