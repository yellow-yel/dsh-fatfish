# Changelog

## 0.1.1 - 2026-10-30

- 随市场版统一上架，补全仓库元数据、安全说明与打包白名单。
- 工具参数、命令名与配置格式与 0.1.0 完全兼容，无需迁移。

## 0.1.0 - 2026-10-30

- 首个版本：bat/cmd/ps1 编码、CRLF、chcp、BOM、裸括号、写死路径体检。
- `batch_doctor` 工具（lint / fix，fix 默认预演）与两条命令。
- GBK 编码经本机 PowerShell `GetEncoding(936)`，带往返校验。
- 写盘前 `.bak`，临时文件 + rename，不删文件。
- 支持配置 `mode` / `backup` / `maxFiles` / `stalePaths` / `skipDirs`。
