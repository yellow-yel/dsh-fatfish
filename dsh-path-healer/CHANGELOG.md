# Changelog

## 0.1.2 - 2026-11-02

- 修复装载硬伤：`Config` 原来是裸 JSON Schema，宿主 cordis 走 `runtime.Config["~standard"].validate(config)`，
  缺它会抛 `TypeError: Cannot read properties of undefined (reading 'validate')`，整枚插件不装载。
  现在补 Standard Schema：填默认值，`configFile` 转字符串，`scanDrives` 收布尔，`maxDepth` 按 1~8 夹取。
- 修复装载硬伤：`command` 只在 agent 子作用域提供，写进 `inject` 会永远 `pending`，不写又抛
  `cannot get property "command" without inject`。改成 try/catch 按需取，取不到只少三条命令，`path_healer` 工具照常。
- 契约测试补两条：宿主 Standard Schema 契约、`ctx.*` 服务与 `inject` 对账。

## 0.1.1 - 2026-10-30

- 随市场版统一上架，补全仓库元数据、安全说明与打包白名单。
- 插件入口、工具名与配置格式与 0.1.0 完全兼容，无需迁移。

## 0.1.0 - 2026-10-30

- 首个版本：Node / Python / PythonW / Git / Edge / DSH NEXT / NapCat 路径体检与自愈。
- 支持扁平与嵌套 JSON 配置，保留未知键。
- 写回前备份 `.bak`，临时文件 + rename。
- 工具 `path_healer`（check / repair / get）与三条命令。
- 支持自定义检查项（key / label / marker / dirs / depth）。
- 可选浅层扫盘兜底，默认关闭。
