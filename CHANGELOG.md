# Changelog

## 0.1.2 (2025-07-28)

- Docs: 修复 README 开发章节中多余的 markdown code fence

## 0.1.1 (2025-07-24)

- Fix: 修复模块加载时因 agent 文件未安装而提前退出导致 @ 补全永不生效的致命 Bug
- Fix: agentList 改为每次事件动态获取，/mention-setup 后无需重启即生效

## 0.1.0 (2025-07-24)

- Initial release
- `@agentname` autocomplete in TUI
- Direct delegation to subagents via `subagent` tool call
- Interactive first-run setup: install agent files + configure `disableBuiltins`
- `/mention-setup` command for re-configuration
- Automatic agent file integrity checking on startup
- Safe uninstall: only removes agent files that match bundled content
- pi-subagents dependency check
- Bundled agent definitions: council, designer, explorer, fixer, librarian, observer, oracle, orchestrator
