# Xiaomi MiMo 联网搜索

联网搜索是一款基础联网搜索工具，能为您的大模型获取实时的公开网络信息（如新闻、商品、天气等）。

## 核心能力

- **联网搜索方式灵活**：支持强制搜索和意图识别两种方式，开通意图识别后，将自主判断是否进行联网搜索，无需手动触发。
- **提前返回搜索来源**：流式响应中，首包会返回所有搜索来源。
- **多工具混合调用**：可与自定义 Function、工具协同使用，模型会自动判断调用优先级与必要性。
- **响应模式灵活**：支持流式和非流式两种响应，两种方式都将返回搜索、总结内容。

## 快速开始

> **注意**：使用前需要开通联网服务插件。

### 开通服务

访问 [控制台-插件管理](https://platform.xiaomimimo.com/console/plugin-management)，选择开通联网服务插件。

联网服务插件收费参考 [定价策略](https://platform.xiaomimimo.com/docs/pricing)，注意，是否触发搜索调用由模型判断，一轮搜索调用（若模型判定需要）可能会发起多个关键词同时搜索，会多次使用联网内容插件，您可以通过 `max_keyword` 参数来限制一轮搜索最大的关键词数量，进一步控制调用频次与成本。

> **说明**：获取 API Key 等准备工作，请参考 [首次调用API](https://platform.xiaomimimo.com/docs/quickstart/first-api-call)。

### 示例代码

#### Curl

```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
--header "api-key: $MIMO_API_KEY" \
--header "Content-Type: application/json" \
--data-raw '{
    "model": "mimo-v2.5-pro",
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
    model="mimo-v2.5-pro",
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

## 响应示例

```json
{
    "id": "d9cbdd74d5384247a3b9f03580901588",
    "choices": [
        {
            "finish_reason": "stop",
            "index": 0,
            "message": {
                "content": "根据搜索结果，武汉明天（2026年4月23日，周四）的天气情况如下：\\n\\n*   **天气状况**：白天为阴天，夜间转为晴天。\\n*   **气温范围**：最高气温18℃，最低气温10℃。\\n*   **风力风向**：北风，风力较小，为微风（风力小于3级）。\\n\\n**综合来看**，明天武汉白天阴天，夜间放晴，气温相比今天（4月22日）有所回升，但昼夜温差仍达8℃左右。建议您根据早晚和午后的温差，采用"洋葱式穿衣法"，方便随时增减衣物。明天无需携带雨具，适合进行户外活动。",
                "role": "assistant",
                "annotations": [
                    {
                        "type": "url_citation",
                        "url": "https://news.qq.com/rain/a/20260422A03GDF00",
                        "title": "小雨转晴再迎小雨!武汉未来三天阴晴交替,湿度大温差显_腾讯新闻",
                        "summary": "今天是2026年4月22日,武汉白天天气为小雨,北风微风,夜晚天气为多云,北风微风,最高气温15°C,最低气温11°C,空气湿度92%,体感温度9.5°C,空气质量优。雨天道路湿滑,出行请携带雨具,注意防滑,驾车保持安全车距。明日武汉天气为阴,微风,夜间晴,微风,最高气温18°C,最低气温10°C。未来三天,武汉天气以阴到多云为主,24日夜间转小雨,25日白天有小雨,气温逐步回升,最高气温从18°C升至25°C,最低气温从10°C升至13°C,昼夜风力均为微风。降雨时段需注意低洼路段可能短时积水,建议提前检查排水设施,避免涉水通行。近期武汉天气总体平稳,但阴雨相间,湿度偏高,体感偏凉;24日起气温明显回升,昼夜温差达11°C左右。建议采用洋葱式穿衣法,兼顾早晚清凉与午后温和;室内注意通风除湿,防范衣物、食品受潮霉变;雨天晾晒条件不佳,可优先使用烘干设备。此稿由AI生成(来源:极目新闻)",
                        "site_name": "腾讯网",
                        "publish_time": "2026-04-22T11:24:12+08:00",
                        "logo_url": "https://th.bochaai.com/favicon?domain_url=https://news.qq.com/rain/a/20260422A03GDF00"
                    },
                    {
                        "type": "url_citation",
                        "url": "https://bocha.cn/share/e79b4068-66c6-4f13-bae2-ecbd48336bc5",
                        "title": "2026年04月22日武汉天气预报",
                        "summary": "2026年04月22日武汉天气预报:\\n04/22 (周三):\\n天气:小雨转多云,温度:16/11°C,风向风力:北风<3级\\n04/23 (周四):\\n天气:阴转晴,温度:18/10°C,风向风力:北风<3级\\n04/24 (周五):\\n天气:小雨,温度:22/13°C,风向风力:北风<3级\\n04/25 (周六):\\n天气:多云转晴,温度:25/13°C,风向风力:北风<3级\\n04/26 (周日):\\n天气:多云转阴,温度:28/17°C,风向风力:北风<3级\\n04/27 (周一):\\n天气:阴转晴,温度:28/18°C,风向风力:北风<3级\\n04/28 (周二):\\n天气:多云转阴,温度:29/19°C,风向风力:北风<3级",
                        "site_name": "博查",
                        "publish_time": "2026-04-22T00:00:00+08:00",
                        "logo_url": "https://th.bochaai.com/favicon?domain_url=https://bocha.cn/share/e79b4068-66c6-4f13-bae2-ecbd48336bc5"
                    },
                    {
                        "type": "url_citation",
                        "url": "https://news.qq.com/rain/a/20260421A06R9300",
                        "title": "【明日天气预报】武汉2026年04月22日天气预报,小雨转多云,北风转北风<3级_腾讯新闻",
                        "summary": "武汉04月22日(周三)天气预报,天气现象小雨转多云,\\n风向风力:\\n北风转北风<3级。最高气温16°C摄氏度,最低气温11摄氏度。\\n感冒指数:\\n少发,\\n无明显降温,感冒机率较低。运动指数:\\n适宜,\\n天气较好,尽情感受运动的快乐吧。过敏指数:\\n易发,\\n应减少外出,外出需采取防护措施。穿衣指数:\\n较冷,\\n建议着厚外套加毛衣等服装。洗车指数:\\n较适宜,\\n无雨且风力较小,易保持清洁度。紫外线指数:\\n最弱,\\n辐射弱,涂擦SPF8-12防晒护肤品。\\n【来源:综合自中国气象局】\\n更多出行游玩、民生资讯、办事服务等精彩内容,欢迎下载九派新闻APP查看。声明:此文版权归原作者所有,若有来源错误或者侵犯您的合法权益,您可通过邮箱与我们取得联系,我们将及时进行处理。邮箱地址:jpbl@jp.jiupainews.com",
                        "site_name": "腾讯网",
                        "publish_time": "2026-04-21T19:32:10+08:00",
                        "logo_url": "https://th.bochaai.com/favicon?domain_url=https://news.qq.com/rain/a/20260421A06R9300"
                    }
                ],
                "tool_calls": null
            }
        }
    ],
    "created": 1776850783,
    "model": "mimo-v2.5-pro",
    "object": "chat.completion",
    "usage": {
        "completion_tokens": 204,
        "prompt_tokens": 2106,
        "total_tokens": 2310,
        "completion_tokens_details": {
            "reasoning_tokens": 0
        },
        "prompt_tokens_details": {
            "cached_tokens": 192
        },
        "web_search_usage": {
            "tool_usage": 3,
            "page_usage": 3
        }
    }
}
```

## 支持的模型列表

当前支持以下模型：

- `mimo-v2.5-pro`
- `mimo-v2.5`
- `mimo-v2-pro`
- `mimo-v2-omni`
- `mimo-v2-flash`

> **注意**：详细参数及调用说明参见 [OpenAI API](https://platform.xiaomimimo.com/docs/api/chat/openai-api)。暂不支持 Anthropic API 协议。

## 计费说明

联网服务插件的计费由以下两部分组成：

### 1. 联网资源的使用次数

联网服务插件一次接口返回中，联网资源出现的次数。

### 2. 联网搜索工具调用费用

| 地区 | 费用 |
|------|------|
| 国内 | ¥25 / 1000 次 |
| 海外 | $5 / 1000 次 |

> **注意**：通过 API 调用联网搜索时，一轮搜索调用会根据 `max_keyword` 数值发起对应数值的关键词同时搜索，会多次使用本插件。

### 3. 模型 Token 消耗费用

联网搜索的网页内容会拼接到提示词中，增加模型的输入 Token，按照模型的标准价格计费。价格详情请参考 [定价与限速](https://platform.xiaomimimo.com/docs/pricing)。

## 常见问题

### 开启联网搜索后，模型为何没有执行网络搜索？

可能有以下三种原因：

1. **缓存**：开启/关闭联网后，会有 5 分钟的缓存时间，5 分钟内联网搜索开关还未真实开启/关闭。

2. **模型判断无需联网**：模型判断当前问题不涉及实时信息，可直接使用自身知识回答。如需强制联网，请设置 `force_search: true`。

3. **模型不支持**：当前 `mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2-pro`，`mimo-v2-omni`，`mimo-v2-flash` 支持联网搜索。

## 参数说明

### tools 参数（web_search 类型）

| 参数 | 类型 | 必选 | 描述 |
|------|------|------|------|
| `type` | `string` | 是 | 工具类型，固定为 `web_search` |
| `max_keyword` | `integer` | 否 | 一轮搜索最大的关键词数量，用于控制调用频次与成本 |
| `force_search` | `boolean` | 否 | 是否强制搜索。设为 `true` 时，模型会强制执行联网搜索 |
| `limit` | `integer` | 否 | 搜索结果数量限制 |
| `user_location` | `object` | 否 | 用户位置信息，用于提供更精准的本地化搜索结果 |

### user_location 参数

| 参数 | 类型 | 必选 | 描述 |
|------|------|------|------|
| `type` | `string` | 是 | 位置类型，固定为 `approximate`（近似位置） |
| `country` | `string` | 否 | 国家/地区 |
| `region` | `string` | 否 | 省份/州 |
| `city` | `string` | 否 | 城市 |

### 响应中的 annotations 字段

联网搜索后，模型会在 `annotations` 字段中返回所有引用的搜索来源。

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | `string` | 注释类型，固定为 `url_citation` |
| `url` | `string` | 搜索结果的 URL |
| `title` | `string` | 搜索结果的标题 |
| `summary` | `string` | 搜索结果的摘要内容 |
| `site_name` | `string` | 网站名称 |
| `publish_time` | `string` | 发布时间（ISO 8601 格式） |
| `logo_url` | `string` | 网站 logo 的 URL |

### usage 中的 web_search_usage 字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `tool_usage` | `integer` | 联网搜索 API 的调用次数 |
| `page_usage` | `integer` | 联网搜索 API 返回的网页数 |

## 使用场景示例

### 场景1：查询实时天气

```json
{
    "messages": [
        {
            "role": "user",
            "content": "北京今天天气怎么样？"
        }
    ],
    "tools": [
        {
            "type": "web_search",
            "force_search": true
        }
    ]
}
```

### 场景2：查询最新新闻

```json
{
    "messages": [
        {
            "role": "user",
            "content": "最近有什么科技新闻？"
        }
    ],
    "tools": [
        {
            "type": "web_search",
            "limit": 5
        }
    ]
}
```

### 场景3：查询商品信息

```json
{
    "messages": [
        {
            "role": "user",
            "content": "iPhone 16 的最新价格是多少？"
        }
    ],
    "tools": [
        {
            "type": "web_search",
            "user_location": {
                "type": "approximate",
                "country": "China"
            }
        }
    ]
}
```

### 场景4：混合工具调用

```json
{
    "messages": [
        {
            "role": "user",
            "content": "帮我查询上海明天的天气，并计算如果气温低于10度，我需要穿多厚的衣服"
        }
    ],
    "tools": [
        {
            "type": "web_search",
            "user_location": {
                "type": "approximate",
                "country": "China",
                "city": "Shanghai"
            }
        },
        {
            "type": "function",
            "function": {
                "name": "calculate_temperature_clothing",
                "description": "根据温度计算建议穿着",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "temperature": {
                            "type": "number",
                            "description": "温度（摄氏度）"
                        }
                    },
                    "required": ["temperature"]
                }
            }
        }
    ]
}
```

## 相关文档

- [OpenAI API 兼容](https://platform.xiaomimimo.com/docs/api/chat/openai-api)
- [首次调用 API](https://platform.xiaomimimo.com/docs/quickstart/first-api-call)
- [定价与限速](https://platform.xiaomimimo.com/docs/pricing)
- [工具调用概述](https://platform.xiaomimimo.com/docs/usage-guide/tool-calling)