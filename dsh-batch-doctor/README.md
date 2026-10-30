# dsh-batch-doctor

Windows 脚本的「换台电脑就乱码」体检：

- 中文 `.bat/.cmd` 被存成 UTF-8，`cmd.exe` 按字符数定位下一行，中文一多就串行；
- `.ps1` 是中文 UTF-8 但没有 BOM，PowerShell 5.1 按 ANSI 读；
- 文件编码和 `chcp` 对不上（GBK 配 65001、UTF-8 配 936）；
- 行尾混用 LF / CRLF；
- 块内 `echo` 有裸括号，提前闭合 `if (`；
- 发布包里还写着开发机的老路径。

本插件只读指定目录里的脚本，体检后可以一键转码（默认 GBK），写前留 `.bak`。
不联网、不删文件。

## 安装

```bash
dsh plugin add dsh-batch-doctor
```

## 命令

| 命令 | 作用 |
|------|------|
| `/batchdoctor.lint D:\project` | 只体检，不改文件 |
| `/batchdoctor.fix D:\project` | 按配置的 `mode` 转码（默认 gbk），写前备份 |

## 给 agent 的工具

工具名 `batch_doctor`：

```json
{ "action": "lint", "dir": "D:\\project" }
{ "action": "fix",  "dir": "D:\\project", "mode": "gbk", "write": true, "backup": true }
```

**`fix` 默认是预演**：只有 `write: true` 才真的写盘。命令 `/batchdoctor.fix`
则直接执行（用户已经明确要求修复）。

## 体检规则

| 代码 | 级别 | 说明 |
|------|------|------|
| `bat-utf8` | 错误 | 中文批处理是 UTF-8，cmd 可能吃字符 |
| `bat-bom` | 错误 | 批处理带 UTF-8 BOM |
| `chcp-mismatch` | 错误 | 文件编码和 `chcp` 对不上 |
| `missing-chcp` | 警告 | 有中文但没设 `chcp` |
| `line-endings` | 警告 | 存在 LF 行尾 |
| `naked-paren` | 警告 | 块内 `echo` 有裸括号 |
| `ps1-bom` | 警告 | 中文 UTF-8 ps1 没有 BOM |
| `ps1-gbk` | 提示 | ps1 是 GBK，PowerShell 7 可能读不了 |
| `stale-path` | 警告 | 命中配置的写死路径正则 |

## 配置

```yaml
# cordis.patch.yml（用户层）
- id: dsh-batch-doctor
  name: dsh-batch-doctor
  config:
    mode: gbk          # gbk | utf8
    backup: true
    maxFiles: 1000
    stalePaths:
      - 'F:\\111'
      - 'D:\\D盘'
    skipDirs:
      - 旧备份
```

`stalePaths` 里填正则字符串，命中就提示；默认空，不误报。

## 修复会做什么

`.bat/.cmd`：

1. 统一 CRLF；
2. 把已有的 `chcp` 改成目标编码对应值（GBK → 936，UTF-8 → 65001）；
3. 按目标编码重写文件（GBK 通过本机 PowerShell 的 `GetEncoding(936)` 编码）；
4. 写前复制 `.bak`，临时文件 + rename，不留 `.tmp`。

`.ps1`：

- 中文 UTF-8 且没有 BOM → 补 BOM；
- `mode: utf8` 时 GBK 的 ps1 → 转 UTF-8 BOM；
- `mode: gbk` 时不动 GBK ps1，也不把 UTF-8 转回 GBK（PowerShell 5.1 带 BOM 能读）。

不会新增 `chcp` 行，也不会改脚本逻辑，只动编码、行尾和已有 `chcp`。

## 边界

- 只扫 `.bat/.cmd/.ps1`，默认最多 1000 个；
- 跳过 `node_modules`、`.git`、`dist`、`build`、`运行时`、`AppData` 等；
- 不跟随符号链接；
- 不联网、不删文件；
- GBK 编码调用本机 `powershell.exe`（命令行参数固定，路径走环境变量，不拼字符串）；
- 非 Windows 上 `mode: gbk` 会明确报错，建议用 `utf8`。

## 测试

```bash
npm test
```

14 项：UTF-8/GBK/BOM 解码、各类规则、跳过目录、预演不写盘、
UTF-8→GBK 往返、ps1 BOM、批量修复计数、插件生命周期。

## 来源

功能来自大肥鱼工具箱的 `工具/脚本编码.py`（U 盘便携部署用），这里重写成
DSH 插件，补了工具接口、预演模式、批量报告和 ps1 GBK→UTF-8。

## License

MIT
