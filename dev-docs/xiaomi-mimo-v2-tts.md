# 语音合成

语音合成（文本转语音）支持将输入的文本自动转换为自然流畅的语音输出。您可通过配置发音风格等参数，生成表达丰富、效果生动的语音内容。

## 核心能力

- **提供预置音色**：内置默认音色，满足快速使用需求。
- **多样化发音风格**：支持指定发音风格，语音更生动自然。

## 支持的模型列表

当前仅支持 `mimo-v2-tts` 模型。

## 准备工作

获取 API Key 等准备工作，请参考 [首次调用 API](https://platform.xiaomimimo.com/#/docs/usage-guide/first-call)。

## 可选预置音色

使用时，可在 `{"audio": {"voice": "mimo_default"}}` 中设置预置音色。

| 音色名 | voice 参数 |
|--------|------------|
| MiMo-默认 | `mimo_default` |
| MiMo-中文女声 | `default_zh` |
| MiMo-英文女声 | `default_en` |

> 当前不支持音色克隆

## 风格控制

### 语音整体风格控制

将 `<style>style</style>` 置于转换目标文本开头，其中 `style` 为需要生成的音频风格。如需设置多种风格，请将多个风格名称置于同一个 `<style>` 标签内，分隔符不限。

**格式示例：**
```
<style>风格1 风格2</style>待合成内容
```

以下是一些推荐使用的风格，支持使用不在列表中的风格：

| 风格类型 | 风格示例 |
|----------|----------|
| 语速控制 | 变快 / 变慢 |
| 情绪变化 | 开心 / 悲伤 / 生气 |
| 角色扮演 | 孙悟空 / 林黛玉 |
| 风格变化 | 悄悄话 / 夹子音 / 台湾腔 |
| 方言 | 东北话 / 四川话 / 河南话 / 粤语 |

**样例：**
```
<style>开心</style>明天就是周五了，真开心！
<style>东北话</style>哎呀妈呀，这天儿也忒冷了吧！你说这风，嗖嗖的，跟刀子似的，割脸啊！
<style>粤语</style>呢个真係好正啊！食过一次就唔会忘记！
<style>唱歌</style>原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒，Oh no。背弃了理想，谁人都可以，哪会怕有一天只你共我。
```

### 音频标签细粒度控制

通过 `[音频标签]`，你可以对声音进行细粒度控制，精准调节语气、情绪和表达风格——无论是低声耳语、放声大笑，还是带点小情绪的小吐槽，也可以灵活插入呼吸声、停顿、咳嗽等，都能轻松实现。语速同样可以灵活调整，让每句话都有它该有的节奏。

**样例：**
```
（紧张，深呼吸）呼……冷静，冷静。不就是一个面试吗……（语速加快，碎碎念）自我介绍已经背了五十遍了，应该没问题的。加油，你可以的……（小声）哎呀，领带歪没歪？

（极其疲惫，有气无力）师傅……到地方了叫我一声……（长叹一口气）我先眯一会儿，这班加得我魂儿都要散了。

如果我当时……（沉默片刻）哪怕再坚持一秒钟，结果是不是就不一样了？（苦笑）呵，没如果了。

（寒冷导致的急促呼吸）呼——呼——这、这大兴安岭的雪……（咳嗽）简直能把人骨头冻透了……别、别停下，走，快走。

（提高音量喊话）大姐！这鱼新鲜着呢！早上刚捞上来的！哎！那个谁，别乱翻，压坏了你赔啊？！
```

## 调用示例

### 注意事项

- 语音合成的目标文本需填写在 `role` 为 `assistant` 的消息中，不可放在 `user` 角色的消息内。
- `user` 角色的消息为可选参数，但建议用户携带，可在部分场景下调整语音合成的语气与风格。
- 指定语音风格时，需将 `<style>style</style>` 置于目标文本开头。
- 如需体验更佳的唱歌风格，必须在目标文本最开头仅添加 `<style>唱歌</style>` 标签，格式为：`<style>唱歌</style>歌词`。

### 非流式调用

#### Curl
```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
--header "api-key: $MIMO_API_KEY" \
--header 'Content-Type: application/json' \
--data-raw '{
  "model": "mimo-v2-tts",
  "messages": [
    {
      "role": "user",
      "content": "Hello, MiMo, have you had lunch?"
    },
    {
      "role": "assistant",
      "content": "Yes, I had a sandwich."
    }
  ],
  "audio": {
    "format": "wav",
    "voice": "mimo_default"
  }
}'
```

#### Python
```python
import os
from openai import OpenAI
import base64

client = OpenAI(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/v1"
)

completion = client.chat.completions.create(
    model="mimo-v2-tts",
    messages=[
        {
            "role": "user",
            "content": "Hello, MiMo, have you had lunch?"
        },
        {
            "role": "assistant",
            "content": "Yes, I had a sandwich."
        }
    ],
    audio={
        "format": "wav",
        "voice": "mimo_default"
    }
)

message = completion.choices[0].message
audio_bytes = base64.b64decode(message.audio.data)

with open("audio_file.wav", "wb") as f:
    f.write(audio_bytes)
```

### 流式调用

#### 注意事项

采用流式调用时，输出音频的格式请指定为 `pcm16`，以便拼接成完整音频。拼接示例可参考 Python 调用方式。

#### Curl
```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
--header "api-key: $MIMO_API_KEY" \
--header 'Content-Type: application/json' \
--data-raw '{
  "model": "mimo-v2-tts",
  "messages": [
    {
      "role": "assistant",
      "content": "You are UN-BE-LIEVABLE! I am sooooo done with your constant lies. GET. OUT!"
    }
  ],
  "audio": {
    "format": "pcm16",
    "voice": "default_en"
  },
  "stream": true
}'
```

#### Python
```python
import base64
import os
import numpy as np
import soundfile as sf
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/v1"
)

completion = client.chat.completions.create(
    model="mimo-v2-tts",
    messages=[
        {
            "role": "assistant",
            "content": "You are UN-BE-LIEVABLE! I am sooooo done with your constant lies. GET. OUT!"
        }
    ],
    audio={
        "format": "pcm16",
        "voice": "default_en"
    },
    stream=True
)

# 24kHz PCM16LE mono audio
collected_chunks: np.ndarray = np.array([], dtype=np.float32)

for chunk in completion:
    if not chunk.choices:
        continue
    delta = chunk.choices[0].delta
    audio = getattr(delta, "audio", None)
    if audio is not None:
        assert isinstance(audio, dict), f"Expected audio to be a dict, got {type(audio)}"
        pcm_bytes = base64.b64decode(audio["data"])
        np_pcm = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        collected_chunks = np.concatenate((collected_chunks, np_pcm))
        print(f"Received audio chunk of size {len(pcm_bytes)} bytes")

# Save the collected audio to a file
os.makedirs("tmp", exist_ok=True)
sf.write("tmp/output.wav", collected_chunks, samplerate=24000)
print("Audio saved to tmp/output.wav")
```

## 计费说明

- **计费**：限时免费。
- **查看账单**：您可以在控制台的 **账单明细** 页面查看用量。