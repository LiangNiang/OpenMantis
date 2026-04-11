# Xiaomi MiMo 开放平台 — OpenAI API 文档

## 请求地址
```
https://api.xiaomimimo.com/v1/chat/completions
```

## 请求头

接口支持以下两种认证方式，请选择其中一种添加到请求头中：

**方式一：api-key 字段认证**
```
api-key: $MIMO_API_KEY
Content-Type: application/json
```

**方式二：Authorization: Bearer 认证**
```
Authorization: Bearer $MIMO_API_KEY
Content-Type: application/json
```

---

## 请求体参数

### `messages` array（必选）

对话的消息列表。支持以下消息类型：

- **Developer message**（开发者消息）
- **System message**（系统消息）
- **User message**（用户消息）
- **Assistant message**（助手消息）
- **Tool message**（工具消息）

#### messages 子属性

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `messages.content` | string \| array | 必选 | 消息内容，可为文本字符串或内容数组 |
| `messages.role` | string | 必选 | 消息角色，可选值：`developer` |
| `messages.name` | string | 可选 | 参与者名称，用于区分相同角色的参与者 |

---

### `model` string（必选）

用于生成响应的模型 ID。

可选值：`mimo-v2-pro`、`mimo-v2-omni`、`mimo-v2-tts`、`mimo-v2-flash`

---

### `audio` object（可选）

音频输出参数。**当前仅 `mimo-v2-tts` 模型支持。**

> 注意：如果要生成音频，必须添加一条 `role` 为 `assistant` 的消息，该消息需指定用于音频合成的文本，且可配置发音风格。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `audio.format` | string | `wav` | 输出音频格式。可选值：`wav`、`mp3`、`pcm`、`pcm16` |
| `audio.voice` | string | — | 内置音色。可选值：`mimo_default`、`default_en`、`default_zh` |

---

### `frequency_penalty` number \| null

默认值：`0`，取值范围：`[-2.0, 2.0]`

如果该值为正，新 token 会根据其在已有文本中的出现频率受到惩罚，降低模型重复相同内容的可能性。

---

### `max_completion_tokens` integer \| null

对话补全中可以生成的 token 数上限（含推理 token）。

| 模型 | 默认值 | 范围 |
|------|--------|------|
| `mimo-v2-flash` | 65536 | [0, 131072] |
| `mimo-v2-pro` | 131072 | [0, 131072] |
| `mimo-v2-omni` | 32768 | [0, 131072] |
| `mimo-v2-tts` | 8192 | [0, 8192] |

---

### `presence_penalty` number \| null

默认值：`0`，取值范围：`[-2.0, 2.0]`

如果该值为正，新 token 会根据其是否已在文本中出现受到惩罚，增加模型谈论新主题的可能性。

---

### `response_format` object（可选）

指定模型输出格式。**`mimo-v2-tts` 模型不支持。**

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `response_format.type` | string | 必选 | 响应格式类型，可选值：`text` |

---

### `stop` string \| array \| null

默认值：`null`。最多 4 个停止序列，API 生成到这些序列时停止输出。**`mimo-v2-tts` 模型不支持。**

---

### `stream` boolean \| null

默认值：`false`。设为 `true` 时，响应数据通过 SSE（Server-Sent Events）流式传输。

---

### `thinking` object（可选）

控制模型是否启用思维链。**`mimo-v2-tts` 模型不支持。**

> 注意：在思考模式下的多轮工具调用中，模型会在返回 `tool_calls` 的同时返回 `reasoning_content`，建议在后续请求的 `messages` 中保留所有历史 `reasoning_content`。

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `thinking.type` | string | 必选 | 是否启用思维链。可选值：`enabled`、`disabled`。默认：`mimo-v2-flash` 为 `disabled`，`mimo-v2-pro`/`mimo-v2-omni` 为 `enabled` |

---

### `temperature` number

取值范围：`[0, 1.5]`。较高值（如 0.8）输出更随机，较低值（如 0.2）更确定。建议不要同时修改 `temperature` 和 `top_p`。

| 模型 | 默认值 |
|------|--------|
| `mimo-v2-flash` | 0.3 |
| `mimo-v2-pro` / `mimo-v2-omni` | 1.0 |
| `mimo-v2-tts` | 0.6 |

---

### `tool_choice` string（可选）

控制模型如何选择工具。可选值：`auto`。**`mimo-v2-tts` 模型不支持。**

---

### `tools` array（可选）

模型可能调用的工具列表，当前仅支持函数工具。**`mimo-v2-tts` 模型不支持。**

#### Function tool 子属性

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `tools.function` | object | 必选 | 工具函数对象 |
| `tools.function.name` | string | 必选 | 函数名称，由 a-z、A-Z、0-9、`_`、`-` 组成，最大长度 64 |
| `tools.function.description` | string | 可选 | 函数功能描述 |
| `tools.function.parameters` | object | 可选 | 函数参数（JSON Schema 格式），省略则表示无参数 |
| `tools.function.strict` | boolean | — | 默认 `false`，是否启用严格模式 |
| `tools.type` | string | 必选 | 工具类型，目前仅支持 `function` |

---

### `top_p` number

默认值：`0.95`，取值范围：`[0.01, 1.0]`。核采样概率阈值，建议不要同时修改 `temperature` 和 `top_p`。

---

## Chat 响应对象（非流式输出）

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 响应的唯一标识符 |
| `object` | string | 对象类型，固定为 `chat.completion` |
| `created` | integer | 创建时的 Unix 时间戳（秒） |
| `model` | string | 用于生成结果的模型 |
| `choices` | array | 生成的回复选项列表 |
| `usage` | object \| null | 用量信息 |

### `choices` 子属性

| 字段 | 类型 | 说明 |
|------|------|------|
| `choices.finish_reason` | string | 停止原因：`stop`、`length`、`tool_calls`、`content_filter`、`repetition_truncation` |
| `choices.index` | integer | 选项索引 |
| `choices.message.content` | string | 消息内容 |
| `choices.message.reasoning_content` | string | 推理内容（思维链） |
| `choices.message.role` | string | 消息角色 |
| `choices.message.tool_calls` | array | 工具调用列表 |
| `choices.message.annotations` | array | 联网搜索引用注释 |
| `choices.message.audio` | object | 音频响应数据 |
| `choices.message.error_message` | string | 联网搜索错误信息 |

#### tool_calls 子属性

| 字段 | 类型 | 说明 |
|------|------|------|
| `tool_calls.id` | string | 工具调用 ID |
| `tool_calls.type` | string | 工具类型，固定为 `function` |
| `tool_calls.function.name` | string | 调用的函数名 |
| `tool_calls.function.arguments` | string | 函数参数（JSON 格式） |

#### annotations 子属性（联网搜索）

| 字段 | 类型 | 说明 |
|------|------|------|
| `annotations.logo_url` | string | Logo 网址 |
| `annotations.publish_time` | string | 发布时间 |
| `annotations.site_name` | string | 网站名称 |
| `annotations.summary` | string | 总结 |
| `annotations.title` | string | 标题 |
| `annotations.type` | string | 类型 |
| `annotations.url` | string | 网址 |

#### audio 子属性

| 字段 | 类型 | 说明 |
|------|------|------|
| `audio.id` | string | 音频响应唯一标识符 |
| `audio.data` | string | Base64 编码的音频数据 |
| `audio.expires_at` | number \| null | 过期 Unix 时间戳，当前为 null |
| `audio.transcript` | string \| null | 音频文字记录，当前为 null |

### `usage` 子属性

| 字段 | 类型 | 说明 |
|------|------|------|
| `usage.completion_tokens` | integer | 输出消耗的 token 数 |
| `usage.prompt_tokens` | integer | 提示词消耗的 token 数 |
| `usage.total_tokens` | integer | 总 token 数 |
| `usage.completion_tokens_details.reasoning_tokens` | integer | 推理消耗的 token 数 |
| `usage.prompt_tokens_details.cached_tokens` | integer | 缓存提供的 token 数 |
| `usage.prompt_tokens_details.audio_tokens` | integer | 音频输入 token 数 |
| `usage.prompt_tokens_details.image_tokens` | integer | 图像输入 token 数 |
| `usage.prompt_tokens_details.video_tokens` | integer | 视频输入 token 数 |
| `usage.web_search_usage.tool_usage` | integer | 联网搜索 API 调用次数 |
| `usage.web_search_usage.page_usage` | integer | 联网搜索返回网页数 |

---

## Chat 响应 chunk 对象（流式输出）

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 对话补全对象唯一标识符（每个 chunk 相同） |
| `object` | string | 固定为 `chat.completion.chunk` |
| `created` | integer | Unix 时间戳（每个 chunk 相同） |
| `model` | string | 用于生成结果的模型 |
| `choices` | array | 回复选项列表 |
| `usage` | object \| null | 用量信息（同非流式） |

### `choices.delta` 子属性

| 字段 | 类型 | 说明 |
|------|------|------|
| `choices.delta.content` | string | 数据块消息内容 |
| `choices.delta.reasoning_content` | string | 推理内容 |
| `choices.delta.role` | string | 消息角色 |
| `choices.delta.tool_calls` | array | 工具调用列表 |
| `choices.delta.annotations` | array | 联网搜索引用注释 |
| `choices.delta.audio` | object \| null | 音频响应数据 |
| `choices.delta.error_message` | string | 联网搜索错误信息 |
| `choices.finish_reason` | string \| null | 停止原因 |
| `choices.index` | integer | 选项索引 |

---

## 示例代码（基础调用）

### 请求（curl）
```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
  --header "api-key: $MIMO_API_KEY" \
  --header "Content-Type: application/json" \
  --data-raw '{
    "model": "mimo-v2-pro",
    "messages": [
      {
        "role": "system",
        "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
      },
      {
        "role": "user",
        "content": "please introduce yourself"
      }
    ],
    "max_completion_tokens": 1024,
    "temperature": 1.0,
    "top_p": 0.95,
    "stream": false,
    "stop": null,
    "frequency_penalty": 0,
    "presence_penalty": 0,
    "thinking": {
      "type": "disabled"
    }
  }'
```

### 响应示例
```json
{
  "id": "c69c7aeaa7e7416db4ea08c905860830",
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "content": "Hello! I'm MiMo, an AI assistant developed by Xiaomi...",
        "role": "assistant",
        "tool_calls": null
      }
    }
  ],
  "created": 1773831233,
  "model": "mimo-v2-pro",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 77,
    "prompt_tokens": 57,
    "total_tokens": 134,
    "completion_tokens_details": {
      "reasoning_tokens": 0
    },
    "prompt_tokens_details": null
  }
}
```