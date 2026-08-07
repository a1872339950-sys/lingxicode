/**
 * create_inline_visual 工具处理
 */

const featureSettings = require('../feature-settings')
const inlineVisualize = require('../inline-visualize')

const handlers = {
  create_inline_visual: async (args = {}, ctx = {}) => {
    if (!featureSettings.isFeatureEnabled('inline_visualize')) {
      return {
        success: false,
        disabled: true,
        error: '对话内可视化已关闭。请在 设置 → 能力开关 中开启「对话内可视化」。',
        next_action: 'ask_user_to_enable_inline_visualize'
      }
    }

    const html = String(args.html || args.content || args.fragment || '')
    if (!html.trim()) {
      return {
        success: false,
        error: 'create_inline_visual 需要 html 片段',
        error_type: 'invalid_tool_args',
        recoverable: true
      }
    }

    const projectId = ctx.projectId || ctx.options?.projectId || ''
    const saved = inlineVisualize.saveVisual({
      projectId,
      id: args.id || '',
      title: args.title || '',
      kind: args.kind || args.type || '',
      html,
      update: args.update === true || !!args.id
    })
    if (saved && saved.success) {
      saved.internal = true
      saved.hide_from_ui = true
    }
    return saved
  }
}

module.exports = { handlers }
