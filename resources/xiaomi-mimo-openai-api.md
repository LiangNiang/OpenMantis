# Xiaomi MiMo OpenAI API 兼容

## 请求地址

```
https://api.xiaomimimo.com/v1/chat/completions
```

## 请求头

接口支持以下两种认证方式，请选择其中一种添加到请求头中：

### 方式一：api-key 字段认证

```http
api-key: $MIMO_API_KEY
Content-Type: application/json
```

### 方式二：Authorization: Bearer 认证

```http
Authorization: Bearer $MIMO_API_KEY
Content-Type: application/json
```

## 请求体

### messages

- **类型**: `array`
- **必选**: 是
- **描述**: 对话的消息列表。

#### 消息类型

- `Developer message` - 开发者提供的指令
- `System message` - 系统消息
- `User message` - 用户消息
- `Assistant message` - 助手消息
- `Tool message` - 工具消息

#### messages.content

- **类型**: `string | array`
- **必选**: 是
- **描述**: 消息内容。

#### messages.role

- **类型**: `string`
- **必选**: 是
- **描述**: 消息角色。
- **可选值**: `developer`, `system`, `user`, `assistant`, `tool`

#### messages.name

- **类型**: `string`
- **必选**: 否
- **描述**: 参与者的可选名称，用于区分相同角色的参与者。

### model

- **类型**: `string`
- **必选**: 是
- **描述**: 用于生成响应的模型 ID。
- **可选值**: 
  - `mimo-v2.5-pro`
  - `mimo-v2.5`
  - `mimo-v2.5-tts`
  - `mimo-v2.5-tts-voicedesign`
  - `mimo-v2.5-tts-voiceclone`
  - `mimo-v2-pro`
  - `mimo-v2-omni`
  - `mimo-v2-tts`
  - `mimo-v2-flash`

### audio

- **类型**: `object`
- **必选**: 否
- **描述**: 音频输出参数。详情请参考语音合成。

> **注意**: 如果要生成音频，必须添加一条 role 为 assistant 的消息，该消息需指定用于音频合成的文本。此外，使用 `mimo-v2.5-tts-voicedesign` 模型时，role 为 user 的消息为必填。当前仅支持 `mimo-v2.5-tts`，`mimo-v2.5-tts-voicedesign`，`mimo-v2.5-tts-voiceclone` 和 `mimo-v2-tts` 模型。

#### audio.format

- **类型**: `string`
- **默认值**: `wav`
- **描述**: 指定输出音频格式。默认值：wav，如果设置 `stream: true` 则为 pcm。
- **可选值**: `wav`, `mp3`, `pcm`, `pcm16`

#### audio.voice

- **类型**: `string`
- **描述**: 预置音色的音色ID 或音频样本的 base64 编码。
- **可选值**:
  - `mimo-v2-tts`: `mimo_default`, `default_en`, `default_zh`
  - `mimo-v2.5-tts`: `mimo_default`, `冰糖`, `茉莉`, `苏打`, `白桦`, `Mia`, `Chole`, `Milo`, `Dean`

### frequency_penalty

- **类型**: `number | null`
- **默认值**: `0`
- **范围**: `[-2.0, 2.0]`
- **描述**: 取值范围在 -2.0 到 2.0 之间的数值。如果该值为正，那么新 token 会根据其在已有文本中的出现频率受到相应的惩罚，降低模型重复相同内容的可能性。

### max_completion_tokens

- **类型**: `integer | null`
- **描述**: 对话补全中可以生成的 token 数的上限，包括可见的输出 token 数和推理 token 数。
- **默认值**:
  - `mimo-v2-flash`: 65536
  - `mimo-v2.5-pro`, `mimo-v2-pro`: 131072
  - `mimo-v2.5`, `mimo-v2-omni`: 32768
  - `mimo-v2.5-tts`, `mimo-v2.5-tts-voiceclone`, `mimo-v2.5-tts-voicedesign`, `mimo-v2-tts`: 8192
- **范围**: `[0, 131072]`

### presence_penalty

- **类型**: `number | null`
- **默认值**: `0`
- **范围**: `[-2.0, 2.0]`
- **描述**: 取值范围在 -2.0 到 2.0 之间的数值。如果该值为正，那么新 token 会根据其是否已在已有文本中出现受到相应的惩罚，从而增加模型谈论新主题的可能性。

### response_format

- **类型**: `object`
- **描述**: 一个指定模型必须输出的格式的对象。

> **注意**: MiMo-V2-TTS 和 MiMo-V2.5-TTS 系列模型不支持。

#### response_format.type

- **类型**: `string`
- **必选**: 是
- **描述**: 所定义的响应格式类型。
- **可选值**: `text`

### stop

- **类型**: `string | array | null`
- **默认值**: `null`
- **描述**: 最多 4 个序列，当 API 生成到这些序列时会停止继续生成 token。返回的文本中不会包含这些停止序列。

> **注意**: MiMo-V2-TTS 和 MiMo-V2.5-TTS 系列模型不支持。

### stream

- **类型**: `boolean | null`
- **默认值**: `false`
- **描述**: 如果设置为 true，模型的响应数据会在生成过程中通过SSE（server-sent events）的形式流式传输到客户端。

### thinking

- **类型**: `object`
- **描述**: 这个参数用于控制模型是否启用思维链。

> **注意**: 在思考模式下的多轮工具调用过程中，模型会在返回 `tool_calls` 字段的同时返回 `reasoning_content` 字段。若要继续对话，建议在后续每次请求的 messages 数组中保留所有历史 `reasoning_content`，以获得最佳表现。

> **注意**: MiMo-V2-TTS 和 MiMo-V2.5-TTS 系列模型不支持。

#### thinking.type

- **类型**: `string`
- **必选**: 是
- **描述**: 是否启用思维链。
- **默认值**:
  - `mimo-v2-flash`: `disabled`
  - `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-pro`, `mimo-v2-omni`: `enabled`
- **可选值**: `enabled`, `disabled`

### temperature

- **类型**: `number`
- **范围**: `[0, 1.5]`
- **描述**: 要使用的采样温度，介于 0 和 1.5 之间。较高的值（如 0.8）会使输出更加随机，而较低的值（如 0.2）会使其更加集中和确定性。我们通常建议更改此值或 `top_p`，但不要同时更改。
- **默认值**:
  - `mimo-v2-flash`: 0.3
  - `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-pro`, `mimo-v2-omni`: 1.0
  - `mimo-v2.5-tts`, `mimo-v2.5-tts-voiceclone`, `mimo-v2.5-tts-voicedesign`, `mimo-v2-tts`: 0.6

### tool_choice

- **类型**: `string`
- **描述**: 控制模型如何选择工具。
- **可选值**: `auto`

> **注意**: 当 `tool_choice` 传入非 auto 值时，后端会默认移除该字段，模型响应行为仍等同于 auto 模式（该逻辑保留调整的可能性）。

> **注意**: MiMo-V2-TTS 和 MiMo-V2.5-TTS 系列模型不支持。

### tools

- **类型**: `array`
- **描述**: 模型可能调用的工具列表。目前仅支持函数作为工具。

> **注意**: 在思考模式下的多轮工具调用过程中，模型会在返回 `tool_calls` 字段的同时返回 `reasoning_content` 字段。若要继续对话，建议在后续每次请求的 messages 数组中保留所有历史 `reasoning_content`，以获得最佳表现。

> **注意**: MiMo-V2-TTS 和 MiMo-V2.5-TTS 系列模型不支持。

#### tools.function

- **类型**: `object`
- **必选**: 是

##### tools.function.name

- **类型**: `string`
- **必选**: 是
- **描述**: 工具函数的名称。必须由a-z、A-Z、0-9组成，或包含下划线（_）和连字符（-），最大长度为64。
- **长度限制**: `[1, 64]`

##### tools.function.description

- **类型**: `string`
- **描述**: 函数功能的描述，供模型判断何时以及如何调用该函数。

##### tools.function.parameters

- **类型**: `object`
- **描述**: 函数接受的参数，以 JSON 模式对象的形式描述。若省略 parameters，则表示该函数的参数列表为空。

##### tools.function.strict

- **类型**: `boolean`
- **默认值**: `false`
- **描述**: 生成函数调用时是否启用严格的模式遵循。若设为 true，模型将严格遵循 parameters 字段中定义的确切模式。当 strict 为 true 时，仅支持 JSON 模式的一个子集。

#### tools.type

- **类型**: `string`
- **必选**: 是
- **描述**: 工具类型。
- **可选值**: `function`

### top_p

- **类型**: `number`
- **默认值**: `0.95`
- **范围**: `[0.01, 1.0]`
- **描述**: 核采样的概率阈值，用于控制模型生成文本的多样性。top_p 值越高，生成的文本多样性越强；top_p 值越低，生成的文本确定性越高。由于 temperature 和 top_p 均用于控制生成文本的多样性，建议仅设置其中一个参数。

## Chat 响应对象（非流式输出）

### choices

- **类型**: `array`
- **描述**: 包含生成的回复选项列表。

#### choices.finish_reason

- **类型**: `string`
- **描述**: 模型停止生成 token 的原因。
- **可选值**: 
  - `stop` - 模型到达自然停止点或提供的停止序列
  - `length` - 达到请求中指定的最大 token 数
  - `tool_calls` - 模型调用了工具
  - `content_filter` - 内容因触发过滤策略而被拦截
  - `repetition_truncation` - 模型检测到了复读

#### choices.index

- **类型**: `integer`
- **描述**: 选项列表中对应选项的索引。

#### choices.message

- **类型**: `object`
- **描述**: 模型生成的对话补全消息。

##### choices.message.content

- **类型**: `string`
- **描述**: 消息的内容。

##### choices.message.reasoning_content

- **类型**: `string`
- **描述**: 助手消息中最终答案之前的推理内容。

##### choices.message.role

- **类型**: `string`
- **描述**: 消息作者的角色。

##### choices.message.tool_calls

- **类型**: `array`
- **描述**: 函数调用启动后，模型会返回待调用的工具以及该调用所需的参数。此参数可包含一个或多个工具响应对象。

##### choices.message.tool_calls.function

- **类型**: `object`
- **描述**: 模型所调用的函数。

###### choices.message.tool_calls.function.arguments

- **类型**: `string`
- **描述**: 模型生成的用于调用函数的参数，格式为 JSON。请注意，模型生成的内容并非总能保证是有效的 JSON，且可能会虚构出函数模式中未定义的参数。在调用函数之前，请在代码中对这些参数进行验证。

###### choices.message.tool_calls.function.name

- **类型**: `string`
- **描述**: 要调用的函数的名称。

##### choices.message.tool_calls.id

- **类型**: `string`
- **描述**: 工具调用的 ID。

##### choices.message.tool_calls.type

- **类型**: `string`
- **描述**: 工具的类型。
- **可选值**: `function`

##### choices.message.annotations

- **类型**: `array`
- **描述**: 联网搜索后，模型会返回全部引用网址的注释。

##### choices.message.annotations.logo_url

- **类型**: `string`
- **描述**: logo网址。

##### choices.message.annotations.publish_time

- **类型**: `string`
- **描述**: 发布时间。

##### choices.message.annotations.site_name

- **类型**: `string`
- **描述**: 网站名称。

##### choices.message.annotations.summary

- **类型**: `string`
- **描述**: 总结。

##### choices.message.annotations.title

- **类型**: `string`
- **描述**: 标题。

##### choices.message.annotations.type

- **类型**: `string`
- **描述**: 类型。

##### choices.message.annotations.url

- **类型**: `string`
- **描述**: 网址。

##### choices.message.error_message

- **类型**: `string`
- **描述**: 联网搜索的错误信息。

##### choices.message.audio

- **类型**: `object`
- **描述**: 如果请求输出音频，该对象将包含有关模型音频响应的数据。

###### choices.message.audio.id

- **类型**: `string`
- **描述**: 此音频响应的唯一标识符。

###### choices.message.audio.data

- **类型**: `string`
- **描述**: 模型生成的 Base64 编码音频，格式为请求中指定的格式。

###### choices.message.audio.expires_at

- **类型**: `number | null`
- **描述**: 此音频响应过期的 Unix 时间戳（以秒为单位）。当前仅为 null。

###### choices.message.audio.transcript

- **类型**: `string | null`
- **描述**: 模型生成的音频的文字记录。当前仅为 null。

### created

- **类型**: `integer`
- **描述**: 对话补全对象创建时的 Unix 时间戳（以秒为单位）。

### id

- **类型**: `string`
- **描述**: 响应的唯一标识符。

### model

- **类型**: `string`
- **描述**: 用于生成结果的模型。

### object

- **类型**: `string`
- **描述**: 对象类型。
- **可选值**: `chat.completion`

### usage

- **类型**: `object | null`
- **描述**: 该对话补全请求的用量信息。

#### usage.completion_tokens

- **类型**: `integer`
- **描述**: 模型输出内容花费的 token。

#### usage.prompt_tokens

- **类型**: `integer`
- **描述**: 提示词使用的 token 数量。

#### usage.total_tokens

- **类型**: `integer`
- **描述**: 请求中使用的 token 总数（提示词 + 补全结果）。

#### usage.completion_tokens_details

- **类型**: `object`
- **描述**: 补全中使用的 token 数量明细。

##### usage.completion_tokens_details.reasoning_tokens

- **类型**: `integer`
- **描述**: 模型为推理生成的 token 数量。

#### usage.prompt_tokens_details

- **类型**: `object`
- **描述**: 提示中使用的 token 数量明细。

##### usage.prompt_tokens_details.cached_tokens

- **类型**: `integer`
- **描述**: 缓存中提供的 token 数量。

##### usage.prompt_tokens_details.audio_tokens

- **类型**: `integer`
- **描述**: 提示中存在的音频输入 token 数量。

##### usage.prompt_tokens_details.image_tokens

- **类型**: `integer`
- **描述**: 提示中存在的图像输入 token 数量。

##### usage.prompt_tokens_details.video_tokens

- **类型**: `integer`
- **描述**: 提示中存在的视频输入 token 数量。

#### usage.web_search_usage

- **类型**: `object`
- **描述**: 联网搜索 api 的调用量明细。

##### usage.web_search_usage.tool_usage

- **类型**: `integer`
- **描述**: 联网搜索 api 的调用次数。

##### usage.web_search_usage.page_usage

- **类型**: `integer`
- **描述**: 联网搜索 api 返回的网页数。

## Chat 响应chunk对象（流式输出）

### choices

- **类型**: `array`
- **描述**: 包含生成的回复选项列表。

#### choices.delta

- **类型**: `object`
- **描述**: 流式模型响应生成的对话补全增量。

##### choices.delta.content

- **类型**: `string`
- **描述**: 数据块消息的内容。

##### choices.delta.reasoning_content

- **类型**: `string`
- **描述**: 助手消息中最终答案之前的推理内容。

##### choices.delta.role

- **类型**: `string`
- **描述**: 消息作者的角色。

##### choices.delta.tool_calls

- **类型**: `array`
- **描述**: 函数调用启动后，模型会返回待调用的工具以及该调用所需的参数。此参数可包含一个或多个工具响应对象。

##### choices.delta.tool_calls.index

- **类型**: `integer`
- **描述**: 在 tool_calls 列表中被调用工具的索引，从 0 开始。

##### choices.delta.tool_calls.function

- **类型**: `object`
- **描述**: 调用的函数。

###### choices.delta.tool_calls.function.arguments

- **类型**: `string`
- **描述**: 模型生成的用于调用函数的参数，格式为 JSON。请注意，模型生成的内容并非总能保证是有效的 JSON，且可能会虚构出函数模式中未定义的参数。在调用函数之前，请在代码中对这些参数进行验证。

###### choices.delta.tool_calls.function.name

- **类型**: `string`
- **描述**: 要调用的函数的名称。

##### choices.delta.tool_calls.id

- **类型**: `string`
- **描述**: 工具调用的 ID。

##### choices.delta.tool_calls.type

- **类型**: `string`
- **描述**: 工具的类型。
- **可选值**: `function`

##### choices.delta.annotations

- **类型**: `array`
- **描述**: 联网搜索后，模型会返回全部引用网址的注释。

##### choices.delta.annotations.logo_url

- **类型**: `string`
- **描述**: logo网址。

##### choices.delta.annotations.publish_time

- **类型**: `string`
- **描述**: 发布时间。

##### choices.delta.annotations.site_name

- **类型**: `string`
- **描述**: 网站名称。

##### choices.delta.annotations.summary

- **类型**: `string`
- **描述**: 总结。

##### choices.delta.annotations.title

- **类型**: `string`
- **描述**: 标题。

##### choices.delta.annotations.type

- **类型**: `string`
- **描述**: 类型。

##### choices.delta.annotations.url

- **类型**: `string`
- **描述**: 网址。

##### choices.delta.error_message

- **类型**: `string`
- **描述**: 联网搜索链路的错误信息。

##### choices.delta.audio

- **类型**: `object | null`
- **描述**: 如果请求输出音频，该对象将包含有关模型音频响应的数据。

###### choices.delta.audio.id

- **类型**: `string`
- **描述**: 此音频响应的唯一标识符。

###### choices.delta.audio.data

- **类型**: `string`
- **描述**: 模型生成的 Base64 编码音频，格式为请求中指定的格式。

###### choices.delta.audio.expires_at

- **类型**: `number | null`
- **描述**: 此音频响应过期的 Unix 时间戳（以秒为单位）。当前仅为 null。

###### choices.delta.audio.transcript

- **类型**: `string | null`
- **描述**: 模型生成的音频的文字记录。当前仅为 null。

#### choices.finish_reason

- **类型**: `string | null`
- **描述**: 模型停止生成 token 的原因。
- **可选值**: 
  - `stop` - 模型到达自然停止点或提供的停止序列
  - `length` - 达到请求中指定的最大 token 数
  - `tool_calls` - 模型调用了工具
  - `content_filter` - 内容因触发过滤策略而被拦截
  - `repetition_truncation` - 模型检测到了复读

#### choices.index

- **类型**: `integer`
- **描述**: 选项列表中对应选项的索引。

### created

- **类型**: `integer`
- **描述**: 对话补全对象创建时的 Unix 时间戳（以秒为单位）。每个数据块均使用相同的时间戳。

### id

- **类型**: `string`
- **描述**: 对话补全对象的唯一标识符。每个数据块均使用相同的 ID。

### model

- **类型**: `string`
- **描述**: 用于生成结果的模型。

### object

- **类型**: `string`
- **描述**: 对象类型。
- **可选值**: `chat.completion.chunk`

### usage

- **类型**: `object | null`
- **描述**: 该对话补全请求的用量信息。

#### usage.completion_tokens

- **类型**: `integer`
- **描述**: 模型输出内容花费的 token。

#### usage.prompt_tokens

- **类型**: `integer`
- **描述**: 提示词使用的 token 数量。

#### usage.total_tokens

- **类型**: `integer`
- **描述**: 请求中使用的 token 总数（提示词 + 补全结果）。

#### usage.completion_tokens_details

- **类型**: `object`
- **描述**: 补全中使用的 token 数量明细。

##### usage.completion_tokens_details.reasoning_tokens

- **类型**: `integer`
- **描述**: 模型为推理生成的 token 数量。

#### usage.prompt_tokens_details

- **类型**: `object`
- **描述**: 提示中使用的 token 数量明细。

##### usage.prompt_tokens_details.cached_tokens

- **类型**: `integer`
- **描述**: 缓存中提供的 token 数量。

##### usage.prompt_tokens_details.audio_tokens

- **类型**: `integer`
- **描述**: 提示中存在的音频输入 token 数量。

##### usage.prompt_tokens_details.image_tokens

- **类型**: `integer`
- **描述**: 提示中存在的图像输入 token 数量。

##### usage.prompt_tokens_details.video_tokens

- **类型**: `integer`
- **描述**: 提示中存在的视频输入 token 数量。

#### usage.web_search_usage

- **类型**: `object`
- **描述**: 联网搜索 api 的调用量明细。

##### usage.web_search_usage.tool_usage

- **类型**: `integer`
- **描述**: 联网搜索 api 的调用次数。

##### usage.web_search_usage.page_usage

- **类型**: `integer`
- **描述**: 联网搜索 api 返回的网页数。

## 代码示例

### 基础调用 (curl)

```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
--header "api-key: $MIMO_API_KEY" \
--header "Content-Type: application/json" \
--data-raw '{
    "model": "mimo-v2.5-pro",
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

### 基础调用响应示例

```json
{
    "id": "8b51f9e0515949cb8207fbd35ea6ea5c",
    "choices": [
        {
            "finish_reason": "stop",
            "index": 0,
            "message": {
                "content": "Hello! I'm MiMo, Xiaomi's AI assistant created by the Xiaomi LLM-Core team. I'm here to chat, help answer questions, and assist with various tasks—whether it's providing information, brainstorming ideas, or just having a friendly conversation. Feel free to ask me anything, and I'll do my best to help! 😊",
                "role": "assistant",
                "tool_calls": null
            }
        }
    ],
    "created": 1776848906,
    "model": "mimo-v2.5-pro",
    "object": "chat.completion",
    "usage": {
        "completion_tokens": 72,
        "prompt_tokens": 57,
        "total_tokens": 129,
        "completion_tokens_details": {
            "reasoning_tokens": 0
        },
        "prompt_tokens_details": null
    }
}
```

## 支持的功能

- 基础调用
- 流式响应
- 函数调用
- 联网搜索
- 图像输入
- 音频输入
- 视频输入
- 语音合成
- 结构化输出
- 深度思考