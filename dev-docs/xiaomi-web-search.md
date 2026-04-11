# 联网搜索

联网搜索是一款基础联网搜索工具，能为您的大模型获取实时的公开网络信息（如新闻、商品、天气等）。

## 核心能力

- **联网搜索方式灵活**：支持强制搜索和意图识别两种方式，开通意图识别后，将自主判断是否进行联网搜索，无需手动触发。
- **提前返回搜索来源**：流式响应中，首包会返回所有搜索来源。
- **多工具混合调用**：可与自定义 Function、工具协同使用，模型会自动判断调用优先级与必要性。
- **响应模式灵活**：支持流式和非流式两种响应，两种方式都将返回搜索、总结内容。

## 快速开始

> **注意**：使用前需要开通 **联网服务插件**。

### 开通服务

访问 **控制台-插件管理**，选择开通联网服务插件。

联网服务插件收费参考定价策略，注意，是否触发搜索调用由模型判断，一轮搜索调用（若模型判定需要）可能会发起多个关键词同时搜索，会多次使用联网内容插件，您可以通过 `max_keyword` 参数来限制一轮搜索最大的关键词数量，进一步控制调用频次与成本。

> **说明**：获取 API Key 等准备工作，请参考 **首次调用 API**。

### 示例代码

#### Curl
```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
  --header "api-key: $MIMO_API_KEY" \
  --header "Content-Type: application/json" \
  --data-raw '{
    "model": "mimo-v2-pro",
    "messages": [
      {
        "role": "user",
        "content": "武汉明天天气怎么样？"
      }
    ],
    "tools": [
      {
        "type": "web_search",
        "max_keyword": 3,
        "force_search": true,
        "limit": 1,
        "user_location": {
          "type": "approximate",
          "country": "China",
          "region": "Hubei",
          "city": "Wuhan"
        }
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

#### Python
```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/v1"
)

completion = client.chat.completions.create(
    model="mimo-v2-pro",
    messages=[
        {
            "role": "system",
            "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
        },
        {
            "role": "user",
            "content": "武汉明天天气怎么样？"
        }
    ],
    max_completion_tokens=1024,
    temperature=1.0,
    top_p=0.95,
    stream=False,
    stop=None,
    frequency_penalty=0,
    presence_penalty=0,
    extra_body={
        "thinking": {"type": "disabled"}
    },
    tools=[
        {
            "type": "web_search",
            "max_keyword": 3,
            "force_search": True,
            "limit": 1,
            "user_location": {
                "type": "approximate",
                "country": "China",
                "region": "Hubei",
                "city": "Wuhan"
            }
        }
    ],
    tool_choice="auto"
)

print(completion.model_dump_json())
```

### 响应示例
```json
{
  "id": "d910e1ea0f1e40ceb7c1c16650327e15",
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "content": "根据搜索结果，武汉明天的天气情况如下：\n\n- **日期**：2026年3月19日，星期四\n- **天气状况**：多云转阴\n- **温度范围**：17°C / 11°C\n- **风向风力**：东风，风力小于3级\n\n明天天气以多云到阴天为主，气温比今天略有回升，但温差仍达6度，早晚体感会偏凉。东风轻拂，天气比较稳定。",
        "role": "assistant",
        "annotations": [...],
        "tool_calls": null
      }
    }
  ],
  "created": 1773832843,
  "model": "mimo-v2-pro",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 121,
    "prompt_tokens": 3894,
    "total_tokens": 4015,
    "web_search_usage": {
      "tool_usage": 3,
      "page_usage": 3
    }
  }
}
```

> 详细参数及调用说明参见 **OpenAI API**。暂不支持 Anthropic API 协议。

## 支持的模型列表

当前支持 `mimo-v2-pro`、`mimo-v2-omni`、`mimo-v2-flash` 模型。

## 计费说明

联网服务插件的计费由以下两部分组成：

- **联网资源的使用次数**：联网服务插件一次接口返回中，联网资源出现的次数。
  - 联网搜索工具每 1000 次调用费用：国内 ¥25 / 1000 次；海外 $5 / 1000 次。
  - 注意：通过 API 调用联网搜索时，一轮搜索调用会根据 `max_keyword` 数值发起对应数值的关键词同时搜索，会多次使用本插件。
- **模型 Token 消耗费用**：联网搜索的网页内容会拼接到提示词中，增加模型的输入 Token，按照模型的标准价格计费。价格详情请参考**定价与限速**。

## 常见问题

### 开启联网搜索后，模型为何没有执行网络搜索？

可能有以下三种原因：

1. **缓存**：开启/关闭联网后，会有 5 分钟的缓存时间，5 分钟内联网搜索开关还未真实开启/关闭。
2. **模型判断无需联网**：模型判断当前问题不涉及实时信息，可直接使用自身知识回答。如需强制联网，请设置 `forced_search: true`。
3. **模型不支持**：当前 `mimo-v2-pro`、`mimo-v2-omni`、`mimo-v2-flash` 支持联网搜索。