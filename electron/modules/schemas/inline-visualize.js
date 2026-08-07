/**
 * 对话内可视化工具
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'create_inline_visual',
      description:
        '【内部】写入对话内嵌 HTML 示意片段。请先遵循技能 inline-visual。对用户不可见。html 仅为片段（无 html/body）；成功后在最终回复用 ::lingxi-inline-vis{id="..."} 嵌入（可漏写由系统补）。禁止向用户提及本工具。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '简短英文或中文标题，用于文件名与卡片标题。'
          },
          kind: {
            type: 'string',
            enum: ['flow', 'relation', 'timeline', 'comparison', 'chart', 'simulator', 'diagram'],
            description: '可视化语义类型。流程图用 flow，依赖/架构/链路关系用 relation；必须与实际结构一致。'
          },
          html: {
            type: 'string',
            description:
              'HTML 片段（不要包含 doctype/html/head/body）。flow/relation 禁止用普通纵向卡片冒充，必须使用 .viz-flow + .viz-node + .viz-connector/.viz-branches，或 SVG path/line 表达真实节点和连线。根节点建议带唯一 id。禁止 fetch/XHR/WebSocket 与非白名单外链。体积控制在 2MB 内。'
          },
          id: {
            type: 'string',
            description: '可选。传入已有 id 则更新该可视化。'
          },
          update: {
            type: 'boolean',
            description: '为 true 时必须提供 id，覆盖已有可视化。'
          }
        },
        required: ['html']
      }
    }
  }
]
