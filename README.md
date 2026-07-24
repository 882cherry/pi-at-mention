# pi-at-mention

在 pi 中使用 `@agentname task` 快速委托任务给 subagent。

输入 `@` 自动弹出 agent 列表，选中后输入任务描述即可直接委托。

## 前置依赖

需要已安装 [pi-subagents](https://github.com/nicobailon/pi-subagents)：

```bash
pi install npm:pi-subagents
```

扩展启动时会自动检查 `subagent` 工具是否可用，若未安装则跳过自身。

## 安装

```bash
# 从 npm 安装（发布后）
pi install npm:pi-at-mention

# 或从本地路径安装（clone 后）
pi install .

# 或从 git 仓库安装
pi install git:github.com/882cherry/pi-at-mention@v0.1.0
```

### 首次安装

安装后首次启动 pi 时，扩展会引导你完成配置：

1. **检查 pi-subagents** — 自动检测，未安装则提示
2. **安装自定义 agent 文件** — 询问是否复制内置的 8 个 agent 文件到 `~/.pi/agent/agents/`
3. **配置 disableBuiltins** — 询问是否禁用 pi-subagents 的内置 agent

配置可通过 `/mention-setup` 随时重新进行。

## 使用

输入 `@` 后自动显示可用 agent 列表，选中后输入任务：

```
@oracle 审查这段代码的架构
@fixer 实现用户认证模块
@designer 美化这个页面
@explorer 查找路由相关文件
@librarian 查看 React 18 的 use 文档
@observer 分析这张截图
@council 这个架构方案你怎么看
```

### Agent 列表

| 名称 | 用途 |
|------|------|
| `@oracle` | 架构决策、复杂调试、代码审查 |
| `@fixer` | 快速实现变更 |
| `@explorer` | 代码库搜索和模式匹配 |
| `@designer` | UI/UX 设计和实现 |
| `@librarian` | 文档和研究 |
| `@observer` | 视觉/媒体文件分析 |
| `@council` | 多模型共识 |

## 配置管理

### `/mention-setup` 命令

随时重新运行配置向导：

```
/mention-setup
```

向导包含：

1. **Agent 文件管理**
   - 已安装 → 询问是否移除（内容匹配保护）
   - 未安装 → 询问是否安装
2. **disableBuiltins 设置**
   - 由扩展设置 → 询问是否恢复
   - 未设置 → 询问是否启用
   - 手动设置 → 跳过，不做修改

### 自动修复

扩展启动时检查已安装的 agent 文件是否完整。若发现缺失，提示重新安装。

## 自定义 Agent

### 添加自定义 agent

在 `~/.pi/agent/agents/` 下创建 `.md` 文件，格式：

```yaml
---
name: my-agent
description: 用途说明
tools: read, bash, grep
model: anthropic/claude-sonnet-4-20250514
thinking: high
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
---

自定义 system prompt 内容...
```

### 禁用特定 agent

通过 `~/.pi/agent/settings.json` 中的 `subagents.agentOverrides`：

```json
{
  "subagents": {
    "agentOverrides": {
      "oracle": { "disabled": true },
      "fixer": { "disabled": true }
    }
  }
}
```

### 禁用所有内置 subagent

```json
{
  "subagents": {
    "disableBuiltins": true
  }
}
```

扩展安装向导可以帮你设置此项。

## 卸载

```bash
pi remove npm:pi-at-mention
```

扩展安装的 agent 文件**不会自动删除**，需要手动清理：

```bash
# 删除所有由扩展安装的 agent 文件
rm -i ~/.pi/agent/agents/{council,designer,explorer,fixer,librarian,observer,oracle,orchestrator}.md

# 或只删除特定文件
rm ~/.pi/agent/agents/designer.md
```

扩展的安装状态文件位于 `~/.pi/agent/extensions/pi-at-mention/state.json`，卸载后残留无影响，可手动删除。

## 开发

```bash
git clone https://github.com/882cherry/pi-at-mention.git
cd pi-at-mention

# 本地安装测试
pi install .

# 或通过 -e 临时加载
pi -e ./extensions/index.ts
```
```

## 文件结构

```
pi-at-mention/
├── package.json            # pi 包清单
├── README.md               # 本文档
├── CHANGELOG.md            # 变更日志
├── extensions/
│   └── index.ts            # 扩展入口
└── agents/                 # 捆绑的 agent 定义
    ├── council.md
    ├── designer.md
    ├── explorer.md
    ├── fixer.md
    ├── librarian.md
    ├── observer.md
    ├── oracle.md
    └── orchestrator.md
```

## 许可证

MIT

## 发布到 npm

```bash
# 如配置了镜像源，发布时需指定官方源
npm publish --registry=https://registry.npmjs.org
```

或临时切换：

```bash
npm config set registry https://registry.npmjs.org
npm publish
npm config set registry https://registry.npmmirror.com  # 切回镜像
```
