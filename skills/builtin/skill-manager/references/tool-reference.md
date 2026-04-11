# OpenMantis 工具参考

## 可用工具组

| 工具组 | 包含的工具 | 需要配置 |
|--------|-----------|---------|
| bash | bash（执行 shell 命令） | 无 |
| search | globSearch, grepSearch | 无 |
| skills | skill_*（加载其他 skill） | 无 |
| tavily | tavilySearch, tavilyExtract, tavilyCrawl | tavily.apiKey |
| exa | exaWebSearch | exa.apiKey |
| tapd | tapdSearch 等 | tapd.accessToken |
| schedule | createSchedule, editSchedule, listSchedules | scheduler 上下文 |
| rss | rssFetch | 无 |
| whisper | audio_transcribe | whisper.apiKey |
| tts | textToSpeech | xiaomiTts.enabled |
| memory | saveMemory, recallMemory | memory.enabled |
| agent-browser | bash + `npx agent-browser <command>` | 需安装 agent-browser |

**渠道工具**（仅在对应渠道可用）：feishu, wecom, qq

## 不兼容工具

以下工具来自 Claude Code 等外部环境，在 OpenMantis 中**不存在**：

`Read`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Agent`, `TodoWrite`, `TaskCreate`, `TaskUpdate`

## 替换映射

| 不兼容工具 | OpenMantis 替代方案 |
|-----------|-------------------|
| `Read` | `bash` → `cat`, `head`, `tail` |
| `Edit` | `bash` → `sed`, `awk`, 或重定向写入 |
| `Write` | `bash` → `cat <<'EOF' > file` 或重定向 |
| `Glob` | `search` → `globSearch` |
| `Grep` | `search` → `grepSearch` |
| `WebFetch` | `tavilySearch`（如已配置）或 `bash` + `curl`；需浏览器交互时用 `agent-browser` skill |
| `WebSearch` | `tavilySearch`（如已配置）或 `bash` + `curl` |
| `Agent` | 移除相关段落，简化为单 agent 执行 |
| `TodoWrite` / `TaskCreate` / `TaskUpdate` | 移除相关段落 |
