/**
 * 工具 Schema - media-gen 类别 (5 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "generate_image",
      "description": "根据文字提示生成图片。当前聊天模型只需要会调用工具；后端会自动使用已配置且勾选“图片生成”能力的模型。支持 OpenAI/智谱图片接口，也支持 MiniMax /v1/image_generation；结果会保存为本地 PNG 并在工具卡片中显示缩略图。",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description": "图片生成提示词，描述主体、风格、构图、颜色、比例、细节等"
          },
          "model": {
            "type": "string",
            "description": "图片模型，默认 gpt-image-2"
          },
          "size": {
            "type": "string",
            "enum": [
              "1024x1024",
              "1024x1536",
              "1536x1024",
              "512x512"
            ],
            "description": "图片尺寸，默认 1024x1024"
          },
          "aspect_ratio": {
            "type": "string",
            "description": "MiniMax 图片比例，例如 1:1、16:9、9:16、4:3、3:4。未填时按 size 推断"
          },
          "subject_reference": {
            "type": "string",
            "description": "MiniMax 可选主体参考图 URL/base64/文件标识；用于角色或商品一致性生成"
          },
          "subject_type": {
            "type": "string",
            "description": "MiniMax 主体类型，例如 character、product，未填默认 character"
          },
          "n": {
            "type": "number",
            "description": "生成数量，默认 1，最多 4"
          }
        },
        "required": [
          "prompt"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "generate_music",
      "description": "使用已配置且勾选“音乐生成”能力的 MiniMax 模型生成音乐音频，并保存为本地音频文件。适合用户明确要求 AI 直接生成歌曲、纯音乐、配乐、BGM、音频成品，而不是在内置音乐工作台里手动编曲。",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description": "音乐描述，例如风格、情绪、速度、乐器、结构、用途"
          },
          "lyrics": {
            "type": "string",
            "description": "歌词或音乐文本；纯音乐可写“纯音乐，无人声”并在 prompt 描述编曲"
          },
          "model": {
            "type": "string",
            "description": "MiniMax 音乐模型 ID；不填使用配置里的模型 ID"
          },
          "format": {
            "type": "string",
            "enum": [
              "mp3",
              "wav",
              "aac",
              "m4a"
            ],
            "description": "输出格式，默认 mp3"
          },
          "output_format": {
            "type": "string",
            "enum": [
              "hex",
              "url"
            ],
            "description": "MiniMax 返回格式，默认 hex；url 会下载返回的音频链接"
          },
          "sample_rate": {
            "type": "number",
            "description": "采样率，默认 44100"
          },
          "bitrate": {
            "type": "number",
            "description": "比特率，默认 128000"
          },
          "is_instrumental": {
            "type": "boolean",
            "description": "是否生成纯音乐/无人声"
          },
          "auto_lyrics": {
            "type": "boolean",
            "description": "是否让 MiniMax 自动补全歌词，具体是否生效取决于模型"
          },
          "refer_audio": {
            "type": "string",
            "description": "可选参考音频 URL/base64/文件标识，用于风格或音色参考"
          },
          "refer_voice": {
            "type": "string",
            "description": "可选参考声音 ID 或参考声音参数，具体取决于 MiniMax 模型"
          },
          "style": {
            "type": "string",
            "description": "可选风格标签"
          },
          "duration": {
            "type": "number",
            "description": "可选时长秒数，具体是否生效取决于 MiniMax 模型"
          },
          "instruments": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "可选乐器列表"
          }
        },
        "required": [
          "prompt"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "generate_video",
      "description": "使用已配置且勾选“视频生成”能力的模型生成视频。当前支持 MiniMax 兼容模型的任务轮询与 MP4 下载。",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description": "视频生成提示词，描述主体、镜头、动作、风格、光影、时长等"
          },
          "model": {
            "type": "string",
            "description": "视频模型 ID；不填使用配置里的模型 ID"
          },
          "first_frame_image": {
            "type": "string",
            "description": "可选首帧图片 URL/base64，是否支持取决于具体视频模型"
          },
          "last_frame_image": {
            "type": "string",
            "description": "可选尾帧图片 URL/base64，是否支持取决于具体视频模型"
          },
          "subject_reference": {
            "type": "string",
            "description": "可选主体参考图 URL/base64，是否支持取决于具体视频模型"
          },
          "duration": {
            "type": "number",
            "description": "可选视频时长秒数，具体范围取决于模型"
          },
          "resolution": {
            "type": "string",
            "description": "可选分辨率，例如 720P、1080P，具体取决于模型"
          },
          "prompt_optimizer": {
            "type": "boolean",
            "description": "是否启用提示词优化"
          },
          "callback_url": {
            "type": "string",
            "description": "可选任务回调 URL；桌面本地一般不填，默认轮询"
          },
          "timeout": {
            "type": "number",
            "description": "最大等待毫秒，默认 600000，最长 1800000"
          },
          "pollInterval": {
            "type": "number",
            "description": "轮询间隔毫秒，默认 5000"
          }
        },
        "required": [
          "prompt"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "extract_video_frames",
      "description": "使用项目内置 FFmpeg 从本地视频提取关键检查帧。支持按指定时间点精确抽帧，或按固定秒间隔批量抽帧；适合检查动画、转场、首尾帧、视频 UI 与模型视觉分析。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "本地视频路径，相对路径基于当前项目"
          },
          "timestamps": {
            "type": "array",
            "items": { "type": "number" },
            "description": "可选精确时间点（秒），最多 60 个；设置后忽略 interval_seconds"
          },
          "interval_seconds": {
            "type": "number",
            "description": "未提供 timestamps 时的抽帧间隔秒数，默认 1"
          },
          "max_frames": {
            "type": "integer",
            "description": "按间隔抽帧时最多输出帧数，默认 12，最大 120"
          },
          "width": {
            "type": "integer",
            "description": "可选输出帧宽度；保持比例，高度自动计算"
          },
          "timeout_ms": {
            "type": "integer",
            "description": "处理超时毫秒，默认 180000"
          }
        },
        "required": ["path"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "upscale_media",
      "description": "本地高质量放大图片或视频。图片使用 Sharp Lanczos3 与轻量锐化，视频使用 FFmpeg Lanczos 与 unsharp；这是确定性超分预处理，不冒充 AI 模型。method=ai 会在未配置 AI 超分提供方时明确返回不可用。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "本地图片或视频路径，相对路径基于当前项目"
          },
          "scale": {
            "type": "number",
            "description": "放大倍数，默认 2，范围 1-4"
          },
          "method": {
            "type": "string",
            "enum": ["lanczos", "ai"],
            "description": "处理方式，默认 lanczos；ai 需要后续配置 AI 超分提供方"
          },
          "quality": {
            "type": "integer",
            "description": "图片输出质量，默认 92"
          },
          "crf": {
            "type": "integer",
            "description": "视频 H.264 CRF，默认 18"
          },
          "preset": {
            "type": "string",
            "description": "视频编码预设，默认 medium"
          },
          "timeout_ms": {
            "type": "integer",
            "description": "处理超时毫秒，默认 180000"
          }
        },
        "required": ["path"]
      }
    }
  }
]
