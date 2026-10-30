# Security

## 能做什么

- 读取指定目录里的 `.bat`、`.cmd`、`.ps1` 文件内容，做编码/行尾/语法体检。
- `fix` + `write: true`（或 `/batchdoctor.fix`）时改写这些脚本：
  转编码、统一 CRLF、补 BOM、调整已有 `chcp`。
- 写盘前复制 `.bak`，用临时文件 + rename。
- GBK 编码调用本机 `powershell.exe`，命令行参数固定；文件路径通过
  `BD_SRC` / `BD_DST` 环境变量传入，不拼命令字符串。

## 不做什么

- 不联网，没有遥测。
- 不执行被检查的脚本。
- 不改脚本里的命令逻辑（不会新增/删除业务行）。
- 不删除、不移动文件。
- 不扫描符号链接；跳过 `node_modules`、`.git`、系统目录等。

## 需要注意

- `fix` 会改写文件；工具默认预演，只有 `write: true` 才落盘。
- `.bak` 每次运行会覆盖同名旧备份；需要多版本请自己先提交 git。
- GBK 无法表示的字符会拒绝写入并报错（不会静默替换成 `?`）。
- 非 Windows 上没有 PowerShell，`mode: gbk` 会失败；请用 `utf8`。

## 报告问题

https://github.com/yellow-yel/dsh-fatfish/issues
