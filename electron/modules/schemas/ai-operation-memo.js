module.exports = [
  {
    type: 'function',
    function: {
      name: 'search_ai_operation_memos',
      description: '按关键词搜索当前项目已保存的 AI 操作备忘录索引。只返回备忘录事实资料，不推荐文件、不决定实现路径；结果可能缺失或过时，修改前必须核对当前源码。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '具体关键词、功能名、文件名、函数名、DOM id、错误文本或模块名。不要传整段自然语言需求。'
          },
          terms: {
            type: 'array',
            items: { type: 'string' },
            description: '可选，模型已提炼的多个具体搜索词。'
          },
          limit: {
            type: 'integer',
            description: '最多返回多少条，默认 8，最大 20。'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_ai_operation_memo',
      description: '按 memo_id 读取一条 AI 操作备忘录全文。备忘录是历史模型主动记录的资料，不是硬证据；读取后仍需核对当前源码、入口加载和运行事实。',
      parameters: {
        type: 'object',
        properties: {
          memo_id: {
            type: 'string',
            description: 'search_ai_operation_memos 返回的备忘录 id。'
          }
        },
        required: ['memo_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'record_ai_operation_memo',
      description: '在最终回复前主动记录本轮项目内代码改动备忘录。只记录模型已经确认的项目内文件、模块、函数、行号范围、调用链、影响面和验证结果；不要把它当成硬证据或修改指令。用户稍后决定是否保存。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '可读标题，用作备忘录文件名主题，必须让后续模型一眼知道内容，例如“统一模型新增弹窗入口”或“修复项目切换消息丢失”。不要使用 memo-随机串。'
          },
          intent: {
            type: 'string',
            description: '一句话说明用户要解决的问题或要新增的能力。'
          },
          summary: {
            type: 'string',
            description: '一句话说明本轮实际做了什么，控制在 200 字以内。'
          },
          changes: {
            type: 'array',
            description: '项目内代码定位记录。只写真实改动或明确相关的项目内文件，不写项目外文件。',
            items: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: '项目内相对路径或绝对路径。工具会过滤项目外路径。'
                },
                module: {
                  type: 'string',
                  description: '这个文件所属模块，例如“模型下拉菜单”“设置模型控制台”“AI操作备忘录存储”。'
                },
                purpose: {
                  type: 'string',
                  description: '本文件这次承担的功能变化。'
                },
                functions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '涉及的函数、类、DOM id、IPC channel 或关键变量名。'
                },
                line_ranges: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '已确认的行号范围，例如 “120-168”。不知道就留空，不要猜。'
                },
                call_chain: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '调用链或加载链，例如 “model menu click -> openModelConsoleModal -> saveCustomModel”。'
                },
                impact: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '可能受影响的相邻入口、UI、状态、存储或测试。'
                },
                caution: {
                  type: 'string',
                  description: '不确定点或后续模型需要重新确认的地方。'
                }
              },
              required: ['path', 'purpose']
            }
          },
          change_session_id: {
            type: 'string',
            description: '可选。补录上一轮备忘录时填写后端提供的变更会话 ID，用于引用上一轮真实文件改动事实；普通本轮主动记录时不用填。'
          },
          verification: {
            type: 'array',
            items: { type: 'string' },
            description: '已做过的验证，例如语法检查、最小自测、未能验证的原因。'
          },
          follow_ups: {
            type: 'array',
            items: { type: 'string' },
            description: '后续维护提示。不是命令，只是备忘。'
          },
          uncertainty: {
            type: 'array',
            items: { type: 'string' },
            description: '不确定点。宁可写不确定，也不要编造行号、调用链或验证。'
          }
        },
        required: ['title', 'summary', 'changes']
      }
    }
  }
]
