module.exports = [
  {
    type: 'function',
    function: {
      name: 'create_canvas_workflow',
      description: '根据用户需求创建画布工作流并保存到当前项目。模型分析需求后构建包含 input/work/output 节点和 edges 依赖关系的工作流 JSON，保存后自动通知前端刷新画布并切换到画布视图。仅在用户使用 @画布工作流 指令时调用。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '工作流名称，简洁有语义，如"前端重构工作流""API接口实现工作流"'
          },
          description: {
            type: 'string',
            description: '工作流目标简述'
          },
          nodes: {
            type: 'array',
            description: '工作流节点数组。必须包含恰好 1 个 type=input 节点和 1 个 type=output 节点，以及 1-N 个 type=work 节点。',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '节点唯一 ID，如 "input-xxx"、"work-xxx"、"output-xxx"' },
                type: { type: 'string', enum: ['input', 'work', 'output'], description: '节点类型' },
                name: { type: 'string', description: '节点显示名称，如"数据采集""接口实现""测试验证"' },
                task: { type: 'string', description: '该节点的具体任务描述，work 节点必须非空' },
                outputRule: { type: 'string', description: '输出要求/格式说明' },
                modelKey: { type: 'string', description: '模型标识，留空让用户在画布中手动选择' },
                modelName: { type: 'string', description: '模型名称，留空让用户在画布中手动选择' },
                x: { type: 'number', description: '画布 X 坐标。input 约 90，work 从 360 起每隔 290，output 约 1090' },
                y: { type: 'number', description: '画布 Y 坐标。按行取 150 + (index%4)*184' }
              },
              required: ['id', 'type', 'name', 'task', 'x', 'y']
            }
          },
          edges: {
            type: 'array',
            description: '节点连接关系数组，形成从 input 到 work 到 output 的有向无环图。',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '连接唯一 ID，如 "edge-xxx"' },
                source: { type: 'string', description: '源节点 ID' },
                target: { type: 'string', description: '目标节点 ID' }
              },
              required: ['id', 'source', 'target']
            }
          }
        },
        required: ['name', 'nodes', 'edges']
      }
    }
  }
]
