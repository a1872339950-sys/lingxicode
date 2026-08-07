/**
 * 角色动画预览工具（桌面悬浮窗，类似桌宠预览）
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'character_animation_preview',
      description:
        '打开/关闭/切换桌面悬浮的角色动画预览窗口（类似桌宠，无需用户自己开网页）。制作或修改 2D 角色动画帧后应用 open 展示效果；用户说关闭/关掉预览时用 close。支持 spritesheet 图集或 frames 目录。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['open', 'close', 'set_action', 'status'],
            description: 'open=打开预览，close=关闭，set_action=切换动作，status=查询状态'
          },
          path: {
            type: 'string',
            description:
              '角色资源路径：角色目录、character.json，或 spritesheet.webp。可相对当前项目根。例如 assets/characters/hero 或 data/characters/fengfeng'
          },
          action_id: {
            type: 'string',
            description: '要播放的动作 id，如 idle、walk、running-right；省略则用第一个动作'
          },
          scale: {
            type: 'number',
            description: '显示缩放，默认约 1.6'
          }
        },
        required: ['action']
      }
    }
  }
]
