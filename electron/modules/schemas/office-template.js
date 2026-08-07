/**
 * 办公模板工具：列出 / 套用 灵犀 office-templates 插件中的参考模板
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'office_from_template',
      description:
        '从灵犀「办公模板」插件套用文档/演示/表格参考模板。list 列出可用模板；apply 复制参考文件到项目并可选填充。演示/表格复杂填充可随后用 office_workflow 或 artifact_workflow 继续编辑。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'apply'],
            description: 'list=列出模板；apply=套用并生成文件'
          },
          template_id: {
            type: 'string',
            description:
              '模板 id，如 minimal-letterhead、team-alignment、analytics-dashboard、three-statement-forecast'
          },
          kind: {
            type: 'string',
            enum: ['document', 'presentation', 'spreadsheet', 'docx', 'ppt', 'excel'],
            description: '可选。list 时按类型过滤；apply 时可省略（由模板自身 kind 决定）'
          },
          output_path: {
            type: 'string',
            description:
              '可选。输出路径，相对项目根或绝对路径。默认 assets/office/<template_id>-<时间戳>.(docx|pptx|xlsx)'
          },
          title: {
            type: 'string',
            description: '可选。用于文件名 slug 或文档主标题'
          },
          replacements: {
            type: 'object',
            description:
              '可选。纯文本替换映射 { "旧文": "新文" }，适用于 docx/pptx/xlsx 简单占位替换',
            additionalProperties: { type: 'string' }
          },
          placeholders: {
            type: 'object',
            description:
              '可选。仅 docx：填充 {{key}} 占位符，如 { "收件人": "张三" }',
            additionalProperties: { type: 'string' }
          },
          open_after: {
            type: 'boolean',
            description: '可选。apply 后是否用 office_workflow 打开（excel/ppt 依赖本机 Office；docx 仅加载到控制器）'
          }
        },
        required: ['action']
      }
    }
  }
]
