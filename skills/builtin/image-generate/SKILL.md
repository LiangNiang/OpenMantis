---
name: image-generate
description: 使用 Doubao Seedream 4.0/4.5/5.0 模型从文本或参考图生成图像。当用户希望"生成图片"、"create image"、"基于参考图改图"时使用。
---

# Image Generate Skill

通过 `scripts/image_generate.py` 调用 Seedream 系列模型生成图像。支持纯文本生图、单图/多图参考、组图生成。

## 工作目录约定

- 脚本支持 `--output-dir` (`-o`) 参数指定图片保存目录（不传时默认保存到当前工作目录）。
- **输出根目录**：`<Workspace>/images/`（`<Workspace>` 由框架注入，是绝对路径）。
- 一次任务建议放在子目录里：`<Workspace>/images/<run-id>/`，`run-id` 用 `img-YYYYMMDD-HHmmss` 形式命名。
- 所有脚本路径使用绝对路径，不要用 `cd` 切换目录。

> 本项目运行在用户本地，没有 `/mnt/...` 或 `/root/.openclaw/...` 之类的沙箱路径。

## API Key 获取机制

**通过技能目录下的 `.env` 文件配置。** OpenMantis 启动时会扫描每个 skill 目录下的 `.env`，把里面的键值合并进 `process.env`（已存在的同名变量不会被覆盖），子进程会继承这些变量。

- 模板：`skills/builtin/image-generate/.env.example`
- 实际文件：`skills/builtin/image-generate/.env`（已被 `.gitignore` 忽略）

脚本按如下顺序读取 key：
1. `ARK_API_KEY`（推荐，由 .env 注入）
2. `MODEL_IMAGE_API_KEY`
3. `MODEL_AGENT_API_KEY`

### 当 key 缺失时

若脚本抛出 `PermissionError: ARK_API_KEY ... not found`：

**这是技能允许 Agent 主动写 `.env` 的唯一场景。** 流程：

1. **先在对话中向用户索取 `ARK_API_KEY`**，并明确告知 key 将被写入 `skills/builtin/image-generate/.env`，仅本机可见、已加入 `.gitignore`。**绝不要**自己编造、猜测 key，也不要从其他 provider 配置里"借"key 而不告知用户。
2. **拿到 key 后写入 `.env`**：
   - 若 `.env` 不存在：先 `cp skills/builtin/image-generate/.env.example skills/builtin/image-generate/.env`，再用编辑工具把 `ARK_API_KEY=` 一行替换为 `ARK_API_KEY=<用户提供的 key>`。
   - 若 `.env` 已存在但缺该字段：追加 `ARK_API_KEY=<key>`。
3. **提示用户重启 OpenMantis** —— `.env` 仅在启动时加载一次，运行中改不会立即生效。
4. 重启后重试任务。

可选环境变量（一般无需修改）：

- `MODEL_IMAGE_API_BASE`：API 基址，默认 `https://ark.cn-beijing.volces.com/api/v3`
- `MODEL_IMAGE_NAME`：默认模型名

## 用法

### 命令行选项

| 选项 | 短选项 | 说明 |
|---|---|---|
| `--prompt` | `-p` | 图像描述（必填，中英文均可） |
| `--size` | `-s` | 尺寸，默认 `2048x2048`，也支持 `1K/2K/4K` |
| `--model` | `-m` | 模型名，默认 `doubao-seedream-5-0-260128` |
| `--image` | `-i` | 单张参考图 URL |
| `--images` |  | 多张参考图 URL（空格分隔，2–10 张） |
| `--group` | `-g` | 启用组图生成（需在 prompt 中写明数量，如 "生成3张图片"） |
| `--max-images` |  | 组图最大张数，默认 15 |
| `--output-format` |  | `png` 或 `jpeg`，默认 `jpeg` |
| `--timeout` | `-t` | 超时秒数，默认 600 |
| `--no-watermark` |  | 关闭水印 |
| `--output-dir` | `-o` | 输出目录，默认当前目录 |

### 标准调用模式

```bash
python <Skill directory>/scripts/image_generate.py \
  -p "A beautiful sunset over the ocean" \
  -s 2048x2048 \
  --output-dir <Workspace>/images/img-YYYYMMDD-HHmmss
```

其中 `<Skill directory>` 和 `<Workspace>` 是框架在上方注入的绝对路径，直接使用即可。

输出：JSON 形如

```json
{
  "status": "success",
  "success_list": [
    { "name": "task_0_image_0", "url": "https://...", "local_path": "/abs/path/workspace/images/img-20260409-1530/image-1775202119.jpg" }
  ],
  "error_list": [],
  "error_detail_list": []
}
```

### 常用示例

```bash
# 文生图
python <Skill directory>/scripts/image_generate.py \
  -p "A cute cat" -s 2K \
  --output-dir <Workspace>/images/img-YYYYMMDD-HHmmss

# 文生组图（注意 prompt 里写数量 + --group）
python <Skill directory>/scripts/image_generate.py \
  -p "生成3张可爱的小猫图片" -s 2K -g --max-images 3 \
  --output-dir <Workspace>/images/img-YYYYMMDD-HHmmss

# 单图参考改图
python <Skill directory>/scripts/image_generate.py \
  -p "Convert this image to anime style" \
  -i "https://example.com/image.jpg" \
  --output-dir <Workspace>/images/img-YYYYMMDD-HHmmss

# 多图融合成组图
python <Skill directory>/scripts/image_generate.py \
  -p "Combine these images into a collage" \
  --images "https://example.com/img1.jpg" "https://example.com/img2.jpg" \
  -g --max-images 5 \
  --output-dir <Workspace>/images/img-YYYYMMDD-HHmmss

# 指定模型 / 关水印 / PNG 输出
python <Skill directory>/scripts/image_generate.py \
  -p "A futuristic city" -m doubao-seedream-5-0-260128 \
  --no-watermark --output-format png \
  --output-dir <Workspace>/images/img-YYYYMMDD-HHmmss
```

## 任务类型矩阵

模型根据参数组合自动判断任务类型：

| `image` 参数 | `--group` | 任务类型 |
|---|---|---|
| 无 | 无 | 文 → 单图 |
| 无 | 有 | 文 → 组图 |
| string | 无 | 单图 → 单图 |
| string | 有 | 单图 → 组图 |
| array (2–10) | 无 | 多图 → 单图 |
| array (2–10) | 有 | 多图 → 组图 |

## 给用户返回

读取脚本的 JSON 输出后，给用户返回：

1. **本地路径**：来自 `success_list[].local_path`，例如 `workspace/images/img-20260409-1530/image-1775202119.jpg`
2. **图片预览**：用 Markdown 渲染 URL（24 小时内有效）：
   ```
   ![generated-image-1](https://example.com/image1.jpg)
   ```
3. 同时给出 URL 文本，方便用户复制下载。

## 模型回退

遇到 `ModelNotOpen` 等模型相关错误时，可降级到：

- `doubao-seedream-5-0-260128`
- `doubao-seedream-4-5-251128`
- `doubao-seedream-4-0-250828`

## 常见错误

- ❌ 使用相对路径引用脚本（如 `../../../skills/...`）—— 始终使用框架注入的绝对路径
- ❌ 用 `cd` 切换到输出目录再运行脚本 —— 使用 `--output-dir` 参数指定输出位置
- ❌ 把 `ARK_API_KEY` 写到 `.openmantis/config.json` —— 已改为放在 `skills/builtin/image-generate/.env`
- ❌ 修改 `.env` 后未重启 OpenMantis —— `.env` 只在启动时加载一次
- ❌ 看到 `waiting_for_input` 就立刻 `bash_kill` —— 图像生成往往需要 10–30s 无输出，应改用 `bash_wait` 继续等待
- ❌ 用已废弃的 `doubao-seedream-3-0-*` 模型 —— 脚本会直接返回失败
- ❌ 启用 `--group` 但 prompt 里没写"生成 N 张" —— 模型可能只产 1 张

## 注意

- 推荐尺寸 `2048x2048` 或常见纵横比，画质最佳
- URL 24 小时后失效，需要持久化时务必使用 `local_path`
- 组图任务需 `--group` + prompt 中写明数量
