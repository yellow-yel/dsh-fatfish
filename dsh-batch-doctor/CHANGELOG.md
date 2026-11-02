# Changelog

## 0.1.2 - 2026-11-02

- 修复装载硬伤：`Config` 原来是裸 JSON Schema，宿主 cordis 走 `runtime.Config["~standard"].validate(config)`，
  缺它会抛 `TypeError: Cannot read properties of undefined (reading 'validate')`，整枚插件不装载。
  现在补 Standard Schema：填默认值，`mode` 只收 `gbk` / `utf8`，`backup` 收布尔，`maxFiles` 按 1~5000 夹取。
- 修复装载硬伤：`command` 只在 agent 子作用域提供，写进 `inject` 会永远 `pending`，不写又抛
  `cannot get property "command" without inject`。改成 try/catch 按需取，取不到只少两条命令，`batch_doctor` 工具照常。
- 契约测试补两条：宿主 Standard Schema 契约、`ctx.*` 服务与 `inject` 对账。

## 0.1.1 - 2026-10-30

- 随市场版统一上架，补全仓库元数据、安全说明与打包白名单。
- 工具参数、命令名与配置格式与 0.1.0 完全兼容，无需迁移。

## 0.1.0 - 2026-10-30

- 首个版本：bat/cmd/ps1 编码、CRLF、chcp、BOM、裸括号、写死路径体检。
- `batch_doctor` 工具（lint / fix，fix 默认预演）与两条命令。
- GBK 编码经本机 PowerShell `GetEncoding(936)`，带往返校验。
- 写盘前 `.bak`，临时文件 + rename，不删文件。
- 支持配置 `mode` / `backup` / `maxFiles` / `stalePaths` / `skipDirs`。
