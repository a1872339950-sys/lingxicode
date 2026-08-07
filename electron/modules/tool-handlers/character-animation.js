/**
 * 角色动画预览工具处理
 */

const preview = require('../character-animation-preview')

const handlers = {
  character_animation_preview: async (args, ctx) => {
    return preview.handlePreviewTool(args || {}, ctx || {})
  }
}

module.exports = { handlers }
