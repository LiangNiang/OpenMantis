# 技能发现与安装

## Skills CLI

Skills CLI (`npx skills`) 是开放 agent 技能生态的包管理器。

**核心命令：**

- `npx skills find [query]` — 搜索技能
- `npx skills add <package>` — 安装技能
- `npx skills check` — 检查更新
- `npx skills update` — 更新所有已安装技能

**浏览技能：** https://skills.sh/

## 搜索流程

### Step 1：理解需求

明确用户需要的：
1. 领域（React、测试、设计、部署等）
2. 具体任务（写测试、创建动画、审查 PR 等）
3. 是否常见到可能有现成 skill

### Step 2：优先查排行榜

搜索前先查 [skills.sh 排行榜](https://skills.sh/)。热门 skill 来源：
- `vercel-labs/agent-skills` — React, Next.js, Web 设计（100K+ 安装）
- `anthropics/skills` — 前端设计、文档处理（100K+ 安装）

### Step 3：CLI 搜索

排行榜没有合适的，用 CLI：

```bash
npx skills find [query]
```

示例：
- "如何让 React 更快" → `npx skills find react performance`
- "帮我审查 PR" → `npx skills find pr review`
- "需要生成 changelog" → `npx skills find changelog`

### Step 4：质量验证

**不要仅凭搜索结果推荐。** 验证：

1. **安装量** — 优选 1K+ 安装，<100 的要谨慎
2. **来源信誉** — 官方来源（`vercel-labs`, `anthropics`, `microsoft`）更可信
3. **GitHub stars** — 源仓库 <100 stars 需谨慎

### Step 5：展示选项

```
找到一个相关技能！"react-best-practices" 提供 Vercel 工程团队的 React 和 Next.js 性能优化指南。
（185K 安装）

安装到本项目：
npx skills add vercel-labs/agent-skills -s react-best-practices --copy -y

技能将放在 skills/custom/react-best-practices/。
安装后会自动运行兼容性审核。

了解更多：https://skills.sh/
```

## 下载安装步骤

### 从 CLI 安装

1. **下载：**
   ```bash
   npx skills add <owner/repo> -s <skill> --copy -y
   ```

2. **移动到 custom 目录：**
   ```bash
   mv .agents/skills/<skill-name>/ {PROJECT_ROOT}/skills/custom/<skill-name>/
   ```

3. **标记来源**（尽力而为）：如果能确定来源，在 SKILL.md frontmatter 追加：
   ```yaml
   source:
     repo: owner/repo
     skill: skill-name
     installedAt: YYYY-MM-DD
   ```

4. **进入 Audit 模式**：安装完成后自动对新 skill 进行兼容性审核。

### 从 URL 直接安装

当用户发送 GitHub URL 时：

1. 从 URL 提取仓库和 skill 信息
2. 用 `npx skills add` 或 `git clone` + 手动提取
3. 移动到 `skills/custom/`
4. 标记来源
5. 进入 Audit 模式

## 常见分类关键词

| 分类 | 搜索词 |
|------|-------|
| Web 开发 | react, nextjs, typescript, css, tailwind |
| 测试 | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| 文档 | docs, readme, changelog, api-docs |
| 代码质量 | review, lint, refactor, best-practices |
| 设计 | ui, ux, design-system, accessibility |
| 生产力 | workflow, automation, git |

## 搜索无结果

如果没有找到相关 skill：

1. 告知用户未找到匹配
2. 提出直接用通用能力帮助
3. 建议用户创建自定义 skill（切换到 Create 模式）
