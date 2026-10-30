# Changelog

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
