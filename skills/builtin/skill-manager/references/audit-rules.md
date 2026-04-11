# 技能兼容性审核规则

## 审核目标

确定要审核的 skill。如果用户未指定，列出可用 skill：

```bash
ls {PROJECT_ROOT}/skills/custom/
```

读取目标 skill：

```bash
cat {PROJECT_ROOT}/skills/custom/<skill-name>/SKILL.md
```

其中 `{PROJECT_ROOT}` 使用上方 header 注入的 `Project root` 绝对路径。

## 维度 1：工具依赖

扫描 SKILL.md 全文，识别引用的工具名，对照 `references/tool-reference.md` 检查。

**检查步骤：**

1. 通读 SKILL.md，列出所有提到的工具名
2. 与 `references/tool-reference.md` 中的可用工具对照
3. 对于需要 API key 的工具，检查配置：
   ```bash
   cat {PROJECT_ROOT}/.openmantis/config.json
   ```
4. 分类结果：
   - **FATAL**：引用了不存在的工具（如 Claude Code 专属工具），skill 无法运行
   - **WARN**：引用了存在但未配置的工具（如 tavily 未配置 API key），部分功能受限
   - **INFO**：工具存在但有更合适的替代方案

## 维度 2：Skill 依赖

扫描 SKILL.md 中对其他 skill 的引用。

**识别模式：**
- 明确引用：`skill_xxx`、"调用 xxx skill"、"使用 xxx 技能"、"load the xxx skill"
- 隐含引用：提到某个 skill 的功能但未直接命名

**检查步骤：**

1. 列出所有引用的 skill 名称
2. 检查每个 skill 是否存在：
   ```bash
   ls {PROJECT_ROOT}/skills/builtin/ {PROJECT_ROOT}/skills/custom/
   ```
3. 分类：
   - **FATAL**：引用了不存在的核心 skill，且该 skill 是流程中必需的
   - **WARN**：引用了不存在的可选 skill
   - **INFO**：引用的 skill 存在，但名称或调用方式需微调

## 维度 3：运行时依赖

检查 skill 的脚本和配置所需的运行时工具。

**检查脚本文件：**

1. 列出脚本：
   ```bash
   find {PROJECT_ROOT}/skills/custom/<skill-name>/scripts/ -type f 2>/dev/null
   ```
2. 检查每个脚本的 shebang 行和命令调用
3. 验证本机是否安装：
   ```bash
   which python3 ffmpeg yt-dlp node curl jq 2>&1
   ```

**检查环境变量：**

```bash
cat {PROJECT_ROOT}/skills/custom/<skill-name>/.env 2>/dev/null
```

分类：
- **FATAL**：缺少核心脚本的运行时依赖
- **WARN**：缺少可选工具或环境变量未设置
- **INFO**：所有运行时依赖已满足

## 审核结果展示

完成三个维度后，展示摘要：

```
审核结果：<skill-name>
━━━━━━━━━━━━━━━━━━━━
致命 (FATAL): N 项
警告 (WARN):  N 项
信息 (INFO):  N 项
━━━━━━━━━━━━━━━━━━━━
```

然后逐项列出所有发现的问题。

## 交互式修复

按 FATAL → WARN → INFO 顺序，逐项与用户讨论。

**对于每个问题：**

1. **报告**：是什么、在哪个位置、为什么不兼容
2. **建议修复方案**
3. **等待用户选择**：接受建议 / 自定义处理 / 跳过

**修复策略：**

| 场景 | 建议修复 |
|------|---------|
| 引用 Claude Code 工具 `Read`/`Edit`/`Grep`/`Glob` | 改为 `bash`（`cat`/`sed`/`find`）或 `search`（`globSearch`/`grepSearch`） |
| 引用 `WebFetch`/`WebSearch` | 替换为 `tavilySearch` 或 `bash` + `curl`；需浏览器交互用 `agent-browser` |
| 引用 `Agent`/`TodoWrite`/`TaskCreate` | 移除相关段落，简化为单 agent |
| 引用未配置的 `tavily` | 建议配置 API key，或替换为 `exa` / `curl` / 移除 |
| 引用不存在的 skill | 通过 Discover 模式安装 / 移除引用 / 内联逻辑 |
| 缺少 `python3` 等运行时 | 提示安装（`brew install`）或改写为 TypeScript + Bun |
| 整体严重不适配 | 建议参考原 skill 重写，征得用户同意后执行 |

**修复完成后：**

1. 如 SKILL.md 被修改过，在 frontmatter 追加 `adapted: true`
2. 展示修改总结
3. 告知用户 skill 已就绪
