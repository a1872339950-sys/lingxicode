/**
 * 网页交付工具：脚手架 → 设计三选一 → 预览 → 收尾
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'website_delivery',
      description:
        '网页交付动作入口。完整流程见技能 website-delivery：init→save_option×2~3→present_choices→实现→open_preview→finalize。对用户谈站点与设计，不谈工具名。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['init', 'save_option', 'present_choices', 'open_preview', 'get_status', 'set_stage', 'finalize'],
            description:
              'init=脚手架；save_option=存一个设计选项；present_choices=弹设计选择；open_preview=右侧预览；get_status=状态；set_stage=改阶段；finalize=收尾'
          },
          site_dir: {
            type: 'string',
            description: '站点相对项目目录，默认 site'
          },
          title: {
            type: 'string',
            description: '站点或设计选项标题'
          },
          description: {
            type: 'string',
            description: '站点简介（init）'
          },
          id: {
            type: 'string',
            description: '设计选项 id（save_option）'
          },
          html: {
            type: 'string',
            description: '设计选项预览 HTML 片段或完整小页（save_option）。可与 brief 二选一'
          },
          brief: {
            type: 'string',
            description: '设计说明：布局/气质/字体/交互要点（save_option）'
          },
          colors: {
            type: 'string',
            description: '色板，逗号分隔，如 #6366f1,#0f172a,#f8fafc'
          },
          stage: {
            type: 'string',
            enum: ['design', 'building', 'preview', 'done'],
            description: 'set_stage 时使用'
          },
          question: {
            type: 'string',
            description: 'present_choices 时展示的问题，默认「请选择一个视觉方向」'
          }
        },
        required: ['action']
      }
    }
  }
]
