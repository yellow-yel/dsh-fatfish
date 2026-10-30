# dsh-path-healer

给 DSH 的环境路径做「自愈」：换电脑、换盘符、挪目录之后，配置里的
Node / Python / Git / Edge / DSH NEXT / NapCat 路径经常失效。这个插件会
体检这些路径，能找回的就写回 JSON 配置，找不到就如实说没找到。

零依赖、不联网、不执行命令、不删文件；写配置前先留 `.bak`。

## 安装

```bash
dsh plugin add dsh-path-healer
```

或在 DSH 的插件目录里：

```bash
npm i dsh-path-healer
```

## 命令

| 命令 | 作用 |
|------|------|
| `/pathhealer.check` | 只体检，不写盘 |
| `/pathhealer.repair` | 找回失效路径并写回配置（写前备份） |
| `/pathhealer.get node` | 取某一项的当前路径 |

## 给 agent 的工具

工具名 `path_healer`：

```json
{ "action": "check",  "deep": false }
{ "action": "repair", "deep": true }
{ "action": "get",    "key": "python" }
```

- `check`：只读体检。
- `repair`：找回并写回，只写插件配置里指定的那一个 JSON 文件。
- `get`：取单项路径，不写盘。
- `deep`：已知位置都找不到时，浅层扫盘兜底（默认跟随配置 `scanDrives`）。

## 配置

默认配置：`~/.dsh/path-healer.json`（`DSH_HOME` 存在时优先用它）。

### 扁平结构（可以直接指向原来的 `路径配置.json`）

```json
{
  "python": "D:\\Python39\\python.exe",
  "pythonw": "D:\\Python39\\pythonw.exe",
  "node": "D:\\tools\\node.exe",
  "git": "C:\\Program Files\\Git\\cmd\\git.exe",
  "edge": "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "dsh": "D:\\DSH NEXT\\DSH NEXT.exe",
  "napcat": "E:\\NapCat\\NapCatWinBootMain.exe"
}
```

修复时只改能确认的新路径，其它键原样保留；会补一个 `_meta` 记录主机和时间。

### 嵌套结构

```json
{
  "version": 2,
  "paths": { "node": "", "python": "" },
  "other": { "keep": true }
}
```

原样保留 `version` / `other`，只改 `paths`。

### 追加/覆盖检查项

```yaml
# cordis.patch.yml（用户层）
- id: dsh-path-healer
  name: dsh-path-healer
  config:
    scanDrives: false
    maxDepth: 4
    targets:
      - key: ffmpeg
        label: FFmpeg
        marker: ffmpeg.exe
        depth: 4
        dirs:
          - D:\tools\ffmpeg\bin
```

目标字段：

| 字段 | 说明 |
|------|------|
| `key` | 写进配置的键名 |
| `label` | 报告里显示的名字 |
| `marker` | 用来确认路径的可执行文件名 |
| `dirs` | 额外候选目录 |
| `depth` | 扫盘兜底深度 |

## 查找顺序

1. 配置里现有的值（文件同名 / 目录里有 marker 才算有效）；
2. `PATH`；
3. DSH 自带运行时里的 node（`~/.dsh/dsh-runtimes/*/dependencies/node/...`）；
4. 各工具常见安装目录；
5. `deep: true` 时的浅层扫盘（跳过 `Windows`、`node_modules`、`.git` 等，默认最多看 12000 个目录）。

扫盘只扫非 C 盘根目录和用户主目录，不扫整个 C 盘，避免卡住。

## 边界

- 不联网、没有遥测。
- 不启动、不调用任何程序（只 `stat` / `readdir`）。
- 只写 `configFile` 一个文件，临时文件 + rename，写前 `.bak`。
- 不删除任何文件。
- 支持 Windows；Linux/macOS 也能跑（marker 和目录不同）。

## 测试

```bash
npm test
```

12 项：探测、有效性判断、补齐/迁移/缺失、只读模式、扁平/嵌套配置、
坏 JSON、扫盘深度、默认配置路径、插件生命周期。

## 来源

功能来自大肥鱼工具箱的 `工具/自愈路径.py`（U 盘便携部署用），这里重写成
零依赖的 DSH 插件，并补了自定义目标、嵌套配置、备份与工具接口。

## License

MIT
