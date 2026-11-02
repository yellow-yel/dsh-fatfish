# 更新日志

## 0.5.1 (2026-11-02)

- 修复装载硬伤一：`Config` 原来只是裸 JSON Schema，而宿主 cordis 走 `runtime.Config["~standard"].validate(config)`，
  缺这一句会在装载时抛 `TypeError: Cannot read properties of undefined (reading 'validate')`，整枚插件不装载。
  现在补上 Standard Schema：按 Schema 填默认值，布尔 / 整数 / 枚举 / 字符串逐项收口，整数尊重 `minimum` / `maximum`，
  字符串尊重 `maxLength`，校验只回 `{ value }`，不返回 `issues`、不用异步。
- 修复装载硬伤二：`command` 服务只在 agent 上下文的子作用域提供。写进 `inject` 会让整枚插件卡在
  `pending (waiting for service: command)`（人设、记忆、查毒全部不生效）；不写进 `inject` 直接读又会被宿主抛
  `cannot get property "command" without inject`。改成 try/catch 按需取：取到就注册斜杠命令，取不到只少命令，
  人设与 7 个工具照常装载。
- 契约测试补两条：宿主 Standard Schema 契约、`ctx.*` 用到的服务必须逐项与 `inject` 对上（受保护的除外）。
- 装机实测：DSH NEXT 桌面端 `plugin.state` 由 `pending` 变 `active`，日志出现 `[fatfish] 人设 normal · 工具 7 个`。

## 0.5.0 (2026-10-28)

- 新增本地记忆：保存 / 召回 / 遗忘，对话里自动抽取名字、喜好、习惯、生日
- 记忆拒收密码、验证码、证件号、银行卡、手机号、住址、API Key
- 新增只读安全检查：可疑进程、开机启动项、常用目录可执行文件、SHA-256 哈希
- 新增病毒库在线更新：HTTPS 订阅、大小与跳转校验、原子写入，内置库始终兜底
- 新增 7 个工具与 5 个命令，agent 可以直接记事、查毒、做动作
- 新增 `fatfish_act`：伸懒腰 / 吐泡泡 / 打盹 / 被摸头 / 吃一口 / 翻肚皮 / 甩尾巴
- 设置页加入记忆和查毒选项；配置项补齐
- 发布包移除个人配置目录，隐私扫描纳入测试
- 移除百度文心 provider（未验证可用）
- 补 `repository` / `homepage` / `bugs` / `publishConfig.access`，与市场索引、仓库对齐

## 0.4.0

- 加入设置页与可选免费 API（智谱 / 通义 / DeepSeek）
- 人设、时段感知、情绪、红线整理为独立模块

## 0.3.0

- 首个 DSH 插件版本：通过 `systemPrompt.section()` 注入大肥鱼人设
