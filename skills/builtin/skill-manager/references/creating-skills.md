# 创建技能指南

## 目录结构

在 `skills/custom/<skill-name>/` 下创建：

```
skill-name/
├── SKILL.md              # 必须：元数据 + 指令
├── .env                  # 可选：环境变量
├── scripts/              # 可选：可执行脚本
│   └── *.py, *.sh, *.ts
└── references/           # 可选：按需加载的参考文档
    └── *.md
```

## SKILL.md 结构

### Frontmatter（必填）

```yaml
---
name: my-skill-name
description: 技能做什么以及何时触发。包含具体的触发短语。描述要略"激进"以确保相关场景能触发。
---
```

`description` 是主要触发机制，决定 agent 是否激活技能。包含：
- 技能功能
- 具体触发短语
- 适用场景
- 不应触发的场景（避免误触发）

### Markdown 正文

推荐章节：

```markdown
# 技能标题

一句话摘要。

## When to Use
- 触发场景列表

## When NOT to Use
- 看似相关但应使用其他方式的场景

## Instructions
核心工作流。用祈使句。解释每步的"为什么"。

## Tools Used
列出依赖的 OpenMantis 工具。

## Examples
1-2 个具体输入/输出示例。
```

## 写作规范

- **解释原因，不只是步骤。** "检查配置文件因为部分工具需要 API key" 好过 "总是检查配置文件"。
- **用祈使句。** "读取文件" 而非 "你应该读取文件"。
- **控制在 500 行以内。** 过长时拆到 `references/*.md` 并在 SKILL.md 中引用。
- **工具名要具体。** 写 "用 `globSearch` 搜索文件" 而非 "搜索文件"。
- **包含示例。** 非显而易见的输出格式要有示例。
- **不要过度约束。** 优先解释推理而非死板的 MUST/NEVER 规则。

## 脚本规范

如果技能需要确定性或重复逻辑，打包为脚本：

- 优先 TypeScript (`.ts`) + Bun 运行 — 这是项目运行时
- Python 适用于需要 Python 特有库的场景
- Shell 脚本适合简单管道
- 脚本放在 `scripts/` 下，通过 bash 工具调用
- **使用绝对路径引用脚本**：`python <Skill directory>/scripts/xxx.py`
- **不要用 `cd` 切换目录**

## 环境变量

如果技能需要 API key 或配置，创建 `.env` 文件：

```
# skills/custom/<skill-name>/.env
MY_API_KEY=your-key-here
```

OpenMantis 的技能发现系统会自动加载。已有的 `process.env` 值优先（用户环境变量 > .env）。

## 冒烟测试

编写完成后执行：

1. **验证 frontmatter**：确认 `name` 和 `description` 存在且非空。
2. **检查脚本**（如有）：确认脚本文件存在、可解析。
3. **走读流程**：让用户描述一个应触发技能的场景，心理模拟指令流程 — 是否合理？引用的工具是否可用？
4. **审核**：完成后建议进入 Audit 模式做兼容性检查。
