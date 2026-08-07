/**
 * Tool Schema - code navigation.
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'code_navigate',
      description: '大文件结构导航工具。用于 2000-5000 行以上文件中按函数/类/选择器/符号快速定位，不是硬门槛。action=outline_file 返回文件结构、大函数和行号；action=find_symbol 在单文件内找定义/引用/DOM/IPC 命中；action=slice_by_symbol 按 symbol 或 line 返回对应函数/类/代码块片段，避免整文件读取和反复猜行号。拿到结果后仍需模型自行判断，不要把输出当直接修改指令。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['outline_file', 'find_symbol', 'slice_by_symbol'],
            description: '操作类型，默认 outline_file。'
          },
          path: {
            type: 'string',
            description: '项目内源文件路径。'
          },
          symbol: {
            type: 'string',
            description: 'find_symbol/slice_by_symbol 使用的函数名、类名、变量名、选择器或关键词。'
          },
          query: {
            type: 'string',
            description: 'symbol 的别名；也可用于文本关键词。'
          },
          line: {
            type: 'integer',
            description: 'slice_by_symbol 可传某一行，返回包含该行的最小函数/类/代码块。'
          },
          limit: {
            type: 'integer',
            description: '最多返回多少个结构或命中，outline 默认 80，find 默认 30。'
          },
          min_lines: {
            type: 'integer',
            description: 'outline_file 可选，只返回不少于该行数的结构块。'
          },
          context_lines: {
            type: 'integer',
            description: 'slice_by_symbol 可选，在结构块前后附加的上下文行数。'
          },
          max_lines: {
            type: 'integer',
            description: 'slice_by_symbol 最多返回多少行，默认 260，最大 1000。'
          }
        },
        required: ['path']
      }
    }
  }
]
