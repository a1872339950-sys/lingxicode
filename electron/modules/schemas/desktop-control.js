/**
 * 桌面操控工具 schema：语义 UIA + 坐标/键盘注入
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'desktop_control',
      description:
        '操控 Windows 桌面应用 UI。支持：窗口列表、启动应用、可访问性树、语义动作(act/set_value)、' +
        '精准控件 click/act/set_value、窗口相对坐标 drag/scroll、键盘 type_text/press_key。' +
        '有专用工具时优先专用（文件、搜索、Office、浏览器、runtime_verify）；' +
        '本工具用于通用桌面应用。必须按“观察 → 定位 → 动作 → 再观察验证”执行：' +
        '先 list_windows/list_apps，使用返回的 window.id 调用 get_window_state(include_text=true, include_screenshot=true)。' +
        '点击按钮/输入框优先使用可访问性树中的 element_index，或唯一的 name+role。' +
        '纯坐标 click 默认只返回命中的控件并拒绝执行；只有控件树确实无法定位，且调用 image_analyze 核对 screenshots[0].path 后，' +
        '才可设置 coordinate_verified=true 使用窗口相对坐标。未观察到目标时禁止猜坐标点击。' +
        'image_analyze 只分析刚返回的截图，不会使观察失效；分析完成后直接操作，不要重复 get_window_state。' +
        '弱可访问性应用应在本轮截图中确认真实输入框坐标，再用一次 type_text(x/y, coordinate_verified=true, text, submit=true) 完成点击、输入、回车。' +
        '禁止猜 Ctrl+F/Ctrl+K/Ctrl+L 能聚焦搜索框；press_key 成功只代表按键已注入，不代表界面效果正确，后续必须重新观察验证。' +
        '只使用列表返回的 window.id，不要编造句柄。禁止用 shell_run/SendKeys 替代本工具。禁止 Win/Meta 键。',
      parameters: {
        type: 'object',
        properties: {
          method: {
            type: 'string',
            enum: [
              'list_windows',
              'list_apps',
              'launch_app',
              'activate_window',
              'get_window_state',
              'act',
              'set_value',
              'click',
              'drag',
              'scroll',
              'type_text',
              'press_key'
            ],
            description:
              'list_windows/list_apps/launch_app/activate_window/get_window_state；' +
              'act/set_value/click=优先精准控件；drag/scroll=窗口相对坐标；type_text 必须指定真实输入框或截图确认坐标；press_key=仅报告按键注入'
          },
          query: {
            type: 'string',
            description: 'list_windows / list_apps / launch_app 名称过滤，可用 a|b 交替匹配'
          },
          name: {
            type: 'string',
            description: 'launch_app 软件名；act/click/type_text 的目标控件名称。点击“播放”等按钮时应明确填写'
          },
          path: {
            type: 'string',
            description: 'launch_app 可选可执行文件/快捷方式路径'
          },
          app: {
            type: 'string',
            description: '应用 id 或名称（list_apps / launch_app）'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'launch_app 启动参数'
          },
          cwd: {
            type: 'string',
            description: 'launch_app 工作目录'
          },
          window: {
            type: 'object',
            description: '目标窗口，必须来自 list_windows/list_apps 返回对象，至少含 id',
            properties: {
              id: { type: 'string', description: '窗口 id（句柄字符串）' },
              app: { type: 'string' },
              title: { type: 'string' }
            }
          },
          window_id: {
            type: 'string',
            description: 'window.id 的简写'
          },
          include_text: {
            type: 'boolean',
            description: 'get_window_state：是否返回可访问性树（带 element index）。执行动作前必须设为 true'
          },
          include_screenshot: {
            type: 'boolean',
            description: 'get_window_state：是否截取窗口图，默认 true；树中找不到目标时用 image_analyze 分析返回的截图路径'
          },
          activate: {
            type: 'boolean',
            description: 'get_window_state：是否前置窗口，默认 false（观察不抢焦点）；输入类 method 会自动前置'
          },
          max_nodes: {
            type: 'integer',
            description: '可访问性树最大节点数，默认 400'
          },
          max_depth: {
            type: 'integer',
            description: '可访问性树最大深度，默认 8'
          },
          element_index: {
            type: 'integer',
            description: 'act/set_value/click：get_window_state 树中的 [index]'
          },
          role: {
            type: 'string',
            description: 'act 定位：控件 role，如 button、edit、document'
          },
          automation_id: {
            type: 'string',
            description: 'act 定位：AutomationId'
          },
          operation: {
            type: 'string',
            enum: ['invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'focus'],
            description: 'act 语义操作，默认 invoke'
          },
          value: {
            type: 'string',
            description: 'set_value 写入的文本'
          },
          x: {
            type: 'number',
            description: '默认是窗口相对 X，绝对不要加 window.rect.x；若确实传屏幕坐标，须设 coordinate_space=screen'
          },
          y: {
            type: 'number',
            description: '窗口相对 Y'
          },
          coordinate_space: {
            type: 'string',
            enum: ['window', 'screen'],
            description: 'x/y 的坐标系，默认 window（窗口左上角为 0,0）；截图内坐标就是 window。只有屏幕绝对坐标才设 screen'
          },
          coordinate_verified: {
            type: 'boolean',
            description: '仅坐标点击/聚焦使用。必须先分析本轮 get_window_state 返回的截图并确认坐标后才能设为 true；默认 false'
          },
          from_x: { type: 'number', description: 'drag 起点 X' },
          from_y: { type: 'number', description: 'drag 起点 Y' },
          to_x: { type: 'number', description: 'drag 终点 X' },
          to_y: { type: 'number', description: 'drag 终点 Y' },
          scrollX: {
            type: 'number',
            description: '水平滚动量，正=右，负=左'
          },
          scrollY: {
            type: 'number',
            description: '垂直滚动量，正=下，负=上'
          },
          mouse_button: {
            type: 'string',
            enum: ['left', 'right', 'middle', 'l', 'r', 'm'],
            description: 'click 鼠标键，默认 left'
          },
          click_count: {
            type: 'integer',
            description: 'click 次数，默认 1'
          },
          text: {
            type: 'string',
            description: 'type_text 要输入的 Unicode 文本；必须同时指定可访问性输入框，或经本轮截图确认的 x/y 与 coordinate_verified=true'
          },
          submit: {
            type: 'boolean',
            description: 'type_text 可选：输入后在同一次调用中按 Return 提交，适用于搜索框/命令框'
          },
          submit_wait_after_ms: {
            type: 'integer',
            description: 'submit=true 时按 Return 后等待毫秒数，默认 250'
          },
          key: {
            type: 'string',
            description: 'press_key：X11 风格键名或和弦，如 Return、Tab、Control_L+a、Escape。禁止 Win/Meta。成功只代表按键已注入；除 type_text 内部提交外，后续动作前必须 get_window_state 验证效果'
          },
          wait_after_ms: {
            type: 'integer',
            description: '动作后等待毫秒，默认 150–300'
          },
          limit: {
            type: 'integer',
            description: 'list 结果上限，默认 80'
          },
          confirm_reason: {
            type: 'string',
            description: '可选。说明为何需要用户确认（高风险动作）'
          }
        },
        required: ['method']
      }
    }
  }
]
