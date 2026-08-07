module.exports = [{
  type: 'function',
  function: {
    name: 'parallel_research',
    description: '单次工具调用中并行执行互不依赖的只读研究任务。仅支持 read_file、find_in_file 和 rg_search；任务在后台工作线程运行，结果按 tasks 输入顺序稳定返回。不得用于写入、删除、构建、启动服务或依赖其他任务输出的操作。',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          description: '互不依赖的只读子任务，按输入顺序返回。',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '可选的稳定任务标识。' },
              kind: { type: 'string', enum: ['read_file', 'find_in_file', 'rg_search'] },
              args: { type: 'object', description: '对应子任务参数。read_file/find_in_file 使用 path；rg_search 使用 pattern 和可选 path。' }
            },
            required: ['kind', 'args']
          }
        },
        timeout_ms: { type: 'integer', description: '单个子任务超时，默认 15000，最大 60000；系统同时最多执行 2 个任务。' }
      },
      required: ['tasks']
    }
  }
}]