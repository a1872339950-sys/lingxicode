/**
 * 工具 Schema - 语音合成 (1 个工具)
 * 通用多厂商 TTS，后端自动根据模型配置的 apiUrl/provider 路由到对应厂商适配器
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'text_to_speech',
      description: '使用已配置且勾选"语音合成"能力的模型将文本转为语音音频。支持火山引擎、阿里云、微软 Azure、OpenAI、MiniMax 等厂商；后端会根据模型配置自动选择适配器。结果保存为本地音频文件并在工具卡片中显示播放器。当前聊天模型只需要会调用工具，后端自动使用已配置的语音合成模型。',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要合成为语音的文本内容'
          },
          voice: {
            type: 'string',
            description: '音色/发音人名称，具体可选值取决于厂商。例如 OpenAI: alloy/echo/fable/onyx/nova/shimmer；火山引擎: BV001_streaming/BV002_streaming；阿里云: longxiaochun/longwan；Azure: zh-CN-XiaoxiaoNeural/zh-CN-YunxiNeural'
          },
          model: {
            type: 'string',
            description: '语音合成模型 ID；不填使用配置里的模型 ID'
          },
          format: {
            type: 'string',
            enum: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'pcm'],
            description: '输出音频格式，默认 mp3'
          },
          speed: {
            type: 'number',
            description: '语速倍率，默认 1.0；范围通常 0.5-2.0'
          },
          volume: {
            type: 'number',
            description: '音量，默认 1.0 或 50（取决于厂商）'
          },
          pitch: {
            type: 'number',
            description: '音调，默认 1.0 或 0（取决于厂商）'
          },
          sample_rate: {
            type: 'integer',
            description: '采样率，默认取决于厂商（通常 22050 或 24000）'
          },
          language: {
            type: 'string',
            description: '语言代码，例如 zh-CN、en-US、ja-JP；主要用于 Azure'
          },
          instructions: {
            type: 'string',
            description: '可选的语音指令/情感描述，部分模型支持（如 OpenAI gpt-4o-mini-tts）'
          }
        },
        required: ['text']
      }
    }
  }
]
