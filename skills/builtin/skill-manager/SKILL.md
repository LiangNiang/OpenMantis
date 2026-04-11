---
name: skill-manager
description: 管理 OpenMantis 技能的全生命周期。创建、发现、安装、审核、更新技能。当用户说"创建 skill"、"做个技能"、"find a skill"、"有没有 XX skill"、"审核 skill"、"检查兼容性"、"更新 skill"、"修改 skill"、"turn this into a skill"时触发。当用户发送 GitHub 链接或 skill 包链接时也应触发（下载+审核）。
---

# Skill Manager

管理 OpenMantis 技能的全生命周期：创建、发现安装、审核修复、更新。

## 路径规则

所有 bash 命令使用框架注入的绝对路径。上方 header 中提供了：
- `Skill directory`：本 skill 的绝对路径
- `Workspace`：输出文件目录
- `Project root`：项目根目录

**不要使用 `cd` 切换目录**，直接用绝对路径引用文件和脚本。

## 模式路由

根据用户意图选择对应模式：

| 用户意图 | 模式 | 参考文档 |
|---------|------|---------|
| "创建 skill"、"做个技能"、"turn this into a skill" | Create | `references/creating-skills.md` |
| "找 skill"、"有没有 XX skill"、发送 URL | Discover & Install | `references/skill-discovery.md` |
| "审核 skill"、"检查兼容性"、安装后自动触发 | Audit & Fix | `references/audit-rules.md` |
| "更新 skill"、"修改 skill" | Update | `references/creating-skills.md` |

## 模式概览

### Create — 创建新技能

1. **捕获意图**：理解用户想让技能做什么。如果当前对话已有成功的工作流（用户说"turn this into a skill"），从对话中提取。
2. **采访细节**：逐个确认触发场景、输入输出、外部依赖、边界情况。
3. **编写 SKILL.md**：在 `skills/custom/<name>/` 下创建。结构和规范见 `references/creating-skills.md`。
4. **冒烟测试**：验证 frontmatter、检查脚本、走读流程。
5. **审核**：自动进入 Audit 模式，对新创建的 skill 做兼容性检查。

### Discover & Install — 发现和安装技能

1. **理解需求**：用户想要什么能力。
2. **搜索**：先查 skills.sh 排行榜，再用 `npx skills find` CLI 搜索。
3. **下载安装**：`npx skills add` → 移动到 `skills/custom/`。
4. **审核**：自动进入 Audit 模式。

详细流程见 `references/skill-discovery.md`。

当用户直接发送 GitHub URL 时，跳过搜索步骤，直接下载并审核。

### Audit & Fix — 审核和修复

1. **确定目标**：要审核哪个 skill。如果用户未指定，列出 `skills/custom/` 下的 skill 让用户选。
2. **三维审核**：工具依赖 → Skill 依赖 → 运行时依赖。
3. **交互修复**：按 FATAL → WARN → INFO 顺序，逐项与用户讨论并修复。

详细规则见 `references/audit-rules.md`。工具参考表见 `references/tool-reference.md`。

### Update — 更新已有技能

1. 读取现有 SKILL.md。
2. 与用户讨论需要改什么。
3. 编辑并保存。
4. 冒烟测试。
5. 可选：重新审核。

编写规范同 Create 模式，见 `references/creating-skills.md`。
