# Changelog

## 0.1.1 — 2026-11-02

- 依赖锁到 `dsh-fatfish@0.5.1`：0.5.0 在本代 DSH NEXT 宿主上装载失败（配置校验与 `command` 注入两处硬伤），
  套装挂着它等于三件里最要紧的那件装不上。
- 修复装载硬伤：`command` 只在 agent 上下文的子作用域提供，写进 `inject` 会让整枚插件永远 `pending`，
  不写直接读又会被宿主抛 `cannot get property "command" without inject`。改成 try/catch 按需取——
  取不到只少 `fatfish.suite` 这一条命令，两个只读状态工具照常装载。
- `fatfish_suite_status` 的套装自身版本回退值同步为 `0.1.1`。

## 0.1.0 — 2026-10-30

首个版本。把这几天的三件能力打成一个市场可安装的套装。

- 新增 `fatfish_suite_status`：只读检查 `dsh-fatfish` / `dsh-fatfish-hands` / `dsh-quota-guard`
  是否安装、是否通过 `cordis.patch.yml` 挂载、版本是否与套装要求一致。
- 新增 `fatfish_suite_guide`：按主题返回用法与安全边界（总览 / 记忆 / 浏览器 / 额度 / 查毒 /
  独立桌面版 / 安装卸载），只返回说明文字，不执行动作。
- 新增 `fatfish.suite` 命令：在 DSH 命令面板里直接看套装状态。
- `cordis.patch.yml` 一次插入三件：人设、之手、额度护栏。额度护栏保持默认只记账不拦截。
- 依赖锁定为 `dsh-fatfish@0.5.0`、`dsh-fatfish-hands@0.1.3`、`dsh-quota-guard@0.1.3`，
  套装自身不联网、不读聊天、不执行命令。
- 明确「套装与三件套二选一」，避免重复挂载。
