module.exports = [
  {
    type: 'function',
    function: {
      name: 'mcp_aidev_workflow',
      description: '外部 AI 开发 MCP 聚合工作流。用于项目概览、具体关键词事实扫描、文件感知、语法检查、静态分析和影响面分析；不做自然语言候选推荐，结果必须由模型读取源码和运行事实自行判断。',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'string', description: '可选，外部 MCP server id；默认 aidev-prototype。' },
          mode: { type: 'string', enum: ['auto', 'overview', 'locate', 'inspect', 'verify', 'diagnose'], description: '聚合流程模式，默认 auto。diagnose 返回事实证据和检查结果，不返回执行指令。' },
          query: { type: 'string', description: '具体关键词、错误文本、功能名、按钮文案、模块名、DOM/CSS/函数/API 名等事实线索。' },
          file: { type: 'string', description: '重点检查的项目内文件路径。' },
          files: { type: 'array', items: { type: 'string' }, description: '需要检查的事实命中文件列表。' },
          limit: { type: 'integer', description: '返回事实命中数量上限。' },
          inspect_limit: { type: 'integer', description: '自动感知和检查的文件数量上限，默认 6。' },
          with_content: { type: 'boolean', description: '单文件感知时是否返回文件内容，默认 false。' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_list_tools',
      description: '外部 AI 开发 MCP 聚合工作流。用于项目概览、具体关键词事实扫描、文件感知、语法检查、静态分析和影响面分析；不做自然语言候选推荐，结果必须由模型读取源码和运行事实自行判断。',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'string', description: '可选，外部 MCP server id；默认 aidev-prototype。' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_call_tool',
      description: '外部 AI 开发 MCP 聚合工作流。用于项目概览、具体关键词事实扫描、文件感知、语法检查、静态分析和影响面分析；不做自然语言候选推荐，结果必须由模型读取源码和运行事实自行判断。',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'string', description: '可选，外部 MCP server id；默认 aidev-prototype。' },
          name: { type: 'string', description: '外部 MCP 原子工具名，例如 aidev_check。' },
          arguments: { type: 'object', description: '传给外部 MCP 工具的参数。' },
          timeout_ms: { type: 'integer', description: '可选超时毫秒数。' }
        },
        required: ['name']
      }
    }
  }
]
