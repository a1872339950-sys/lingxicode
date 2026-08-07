/**
 * 工具 Schema - screenshot-image 类别 (8 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "runtime_verify",
      "description": "唯一运行态验证入口，用于点击无响应、内容空白、状态切换、元素不可见和 F12 错误，只检查已登记且与当前项目/工作区绑定的开发运行实例。省略 interaction 时自动执行当前实例的 DOM 或 Accessibility 实时检查；提供 interaction 时自动执行 DOM 或 UI Automation 语义交互，不使用鼠标坐标。唯一候选会自动选中，多候选会返回 candidates 并要求 runtime_id。交互失败返回当前 URL/页面摘要、可交互候选、hiddenBy 隐藏祖先、完整 ancestorChain、裁切和遮挡证据；看到 retry_policy=do_not_repeat_same_call 时禁止原样循环。目标、能力或证据不足时明确返回 incomplete，绝不回退无头 URL/HTML、桌面截图或旧版交互检查。",
      "parameters": {
        "type": "object",
        "properties": {
          "runtime_id": { "type": "string", "description": "已登记运行实例 ID，可来自 Electron、Browser 或其他适配器；同项目多实例时必须精确指定" },
          "runtime_url": { "type": "string", "description": "可选 URL 匹配提示；只用于已登记运行实例，多个匹配时仍要求 runtime_id" },
          "tab_id": { "type": "string", "description": "可选运行标签 ID 匹配提示；只用于已登记运行实例" },
          "claim": { "type": "string", "description": "Required verification claim naming the exact user-reported element and state. Generic page health is not a fix claim." },
          "assertions": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "description": "Required concrete result contract for DOM runtimes. A successful action without assertions is incomplete.",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "selector": { "type": "string" },
                "property": {
                  "type": "string",
                  "enum": ["exists", "visible", "interactable", "childElementCount", "offsetHeight", "offsetWidth", "text", "display", "visibility", "opacity", "classContains", "ariaExpanded"]
                },
                "operator": {
                  "type": "string",
                  "enum": ["equals", "not_equals", "gt", "gte", "lt", "lte", "includes", "not_includes"]
                },
                "expected": {}
              },
              "required": ["selector", "property", "operator", "expected"]
            }
          },
          "interaction": {
            "type": "object",
            "description": "可选语义交互。通过 DOM/可访问名称触发，不模拟人类鼠标坐标；省略时自动执行实时状态检查。",
            "properties": {
              "click_locator": {
                "type": "object",
                "properties": {
                  "selector": { "type": "string", "description": "Browser/Electron 使用精确 CSS 选择器；Windows UIA 可填写 AutomationId。若不确定选择器，优先使用 role/name，失败后读取 nearby_candidates，禁止盲猜重试。" },
                  "automation_id": { "type": "string", "description": "Windows UI Automation 的 AutomationId" },
                  "text": { "type": "string", "description": "元素可见文本或标签" },
                  "role": { "type": "string", "description": "可访问角色，如 button、link、textbox" },
                  "name": { "type": "string", "description": "可访问名称，支持包含匹配" }
                }
              },
              "native_operation": {
                "type": "string",
                "enum": ["invoke", "toggle", "select", "set_value", "expand", "collapse"],
                "description": "Windows UIA 语义动作，默认 invoke；不使用屏幕坐标"
              },
              "value": { "type": "string", "description": "native_operation=set_value 时写入的值" },
              "expected_name": { "type": "string", "description": "原生动作后 Accessibility 树中应出现的名称" },
              "expected_role": { "type": "string", "description": "原生动作后应出现的可访问角色，如 text、button" },
              "expected_automation_id": { "type": "string", "description": "原生动作后应出现的 AutomationId" },
              "expected_visible_selector": { "type": "string", "description": "交互后应可见的元素" },
              "expected_hidden_selector": { "type": "string", "description": "交互后应隐藏的元素" },
              "inspect_selectors": { "type": "array", "items": { "type": "string" }, "description": "交互前后诊断这些元素：读取自身和完整祖先链的 DOM、矩形、计算样式、effectiveVisible、hiddenBy、裁切与遮挡原因" },
              "close_locator": { "type": "object", "description": "可选关闭动作，字段与 click_locator 相同" },
              "expected_closed_selector": { "type": "string", "description": "关闭后应隐藏的元素" },
              "repeat_open": { "type": "boolean", "description": "关闭后再次打开，验证状态可重复" },
              "require_visual_change": { "type": "boolean", "description": "是否要求交互前后像素发生变化" },
              "wait_after_click_ms": { "type": "number", "description": "语义点击后等待状态更新的时间，默认 300ms" },
              "wait_for_locator_ms": { "type": "number", "description": "点击前等待异步渲染目标出现/可交互的时间，默认 1500ms，最大 10000ms。超时后返回页面预检与候选诊断。" }
              ,"input_mode": { "type": "string", "enum": ["semantic", "pointer"], "description": "semantic uses DOM/UIA action; pointer waits for stable geometry, verifies the hit point, then sends native Electron mouse input." }
              ,"stable_for_ms": { "type": "number", "description": "Target rectangle stability required before activation. Default 120ms." }
              ,"wait_for_assertions_ms": { "type": "number", "description": "Poll concrete assertions after interaction. Default 3000ms, maximum 10000ms." }
              ,"poll_interval_ms": { "type": "number", "description": "Assertion polling interval. Default 100ms." }
              ,"assertion_settle_ms": { "type": "number", "description": "Stable asserted state required before acceptance. Default 120ms." }
            }
          },
          "inspect_selectors": { "type": "array", "items": { "type": "string" }, "description": "不执行交互时也可诊断指定元素的自身样式、完整祖先链、effectiveVisible、hiddenBy、裁切与遮挡原因" },
          "expect_text": { "type": "string", "description": "页面应包含的关键文本" },
          "capture_evidence": { "type": "boolean", "description": "保存证据截图，默认 true" },
          "fail_on_console_error": { "type": "boolean", "description": "控制台/F12 错误是否判定失败，默认 true" },
          "runtime_since_ms": { "type": "integer", "description": "读取已打开窗口历史错误的时间范围，默认最近 10 分钟" },
          "observe_ms": { "type": "integer", "description": "验证期间继续观察延迟错误的时间" },
          "timeout_ms": { "type": "integer", "description": "总超时；交互模式默认 30000ms" },
          "step_timeout_ms": { "type": "integer", "description": "交互中单个加载、DOM、截图步骤的超时；默认按总超时计算，上限 8000ms" }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "list_runtime_targets",
      "description": "列出当前工作区已登记的运行实例及 adapter、capabilities、build_type、workspace_path 和 verification_eligible。支持 Electron 开发实例与终端自动发现的 Browser 开发服务器；安装版只作为 observation_only。多个候选时必须传 runtime_id，禁止按活跃窗口猜测。",
      "parameters": {
        "type": "object",
        "properties": {
          "project_id": {
            "type": "string",
            "description": "可选项目 ID；默认使用当前工具上下文项目"
          },
          "include_unscoped": {
            "type": "boolean",
            "description": "是否同时列出尚未归属项目的运行目标，默认 false"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "capture_screenshot",
      "description": "截取明确目标的 UI 画面。网页/本地 HTML 优先传 url 或 html_path，工具会用隐藏窗口渲染；右侧 webview/预览页可传 webContentsId；外部软件必须使用 target=list_sources 先列窗口，或 target=window + 精确 window_title/source_id。窗口截图走独立窗口源，被遮挡时仍可捕获；source_id 失效、标题不匹配或最小化后无可用帧时明确失败，绝不退回截取屏幕或其他窗口。只有用户明确要求查看灵犀聊天/当前项目窗口时才用 target=current_project。",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "要截图的目标 URL，例如 http://localhost:3000 或 file:///E:/demo/index.html"
          },
          "html_path": {
            "type": "string",
            "description": "要截图的本地 HTML 文件路径。可传相对项目路径或绝对路径；工具会用隐藏窗口加载后截图"
          },
          "target": {
            "type": "string",
            "enum": [
              "current_project",
              "main_window",
              "list_sources",
              "window",
              "screen"
            ],
            "description": "截图目标。网页/HTML 不用 target。外部软件先用 list_sources 列窗口，再用 window 截取；screen 截屏幕；current_project/main_window 只用于截图灵犀自身窗口"
          },
          "webContentsId": {
            "type": "number",
            "description": "指定 Electron webContents ID，用于截图已存在的目标窗口、webview 或预览页"
          },
          "runtime_id": {
            "type": "string",
            "description": "由 list_runtime_targets 返回的稳定运行实例 ID。同项目多窗口时优先使用它精确截图"
          },
          "runtime_url": {
            "type": "string",
            "description": "可选运行实例 URL 匹配提示；存在多个匹配时仍会要求 runtime_id"
          },
          "tab_id": {
            "type": "string",
            "description": "可选右侧运行标签 ID，用于精确匹配已登记实例"
          },
          "source_id": {
            "type": "string",
            "description": "target=window/screen 时使用，从 target=list_sources 返回的 sources[].id 选择精确目标。ID 失效时会报错，不会自动改截屏幕"
          },
          "window_title": {
            "type": "string",
            "description": "target=window 时按窗口标题或应用名匹配，例如“录屏软件”“Chrome”“Blender”。不确定时先 list_sources"
          },
          "x": {
            "type": "number",
            "description": "可选裁剪区域 x，适用于 webContents 或桌面截图"
          },
          "y": {
            "type": "number",
            "description": "可选裁剪区域 y，适用于 webContents 或桌面截图"
          },
          "width": {
            "type": "number",
            "description": "可选裁剪区域宽度，适用于 webContents 或桌面截图"
          },
          "height": {
            "type": "number",
            "description": "可选裁剪区域高度，适用于 webContents 或桌面截图"
          },
          "viewport_width": {
            "type": "number",
            "description": "隐藏窗口截图宽度，默认 1440"
          },
          "viewport_height": {
            "type": "number",
            "description": "隐藏窗口截图高度，默认 900"
          },
          "delay_ms": {
            "type": "number",
            "description": "页面加载后等待渲染的毫秒数，默认 500；WebGL/动画页面可设为 1000-3000"
          },
          "wait_until": {
            "type": "string",
            "enum": [
              "dom-ready",
              "load",
              "networkidle"
            ],
            "description": "等待策略，默认 dom-ready"
          },
          "reason": {
            "type": "string",
            "description": "截图目的，例如“验证页面布局是否溢出”或“检查粒子 Logo 是否可见”"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "inspect_image",
      "description": "分析本地图片或截图内容。当前模型具备视觉理解能力时直接用当前模型分析；当前模型不具备视觉能力、需要借用另一个视觉模型时才会弹窗征得用户同意。适用于 UI 截图、设计稿、运行效果截图和普通图片理解。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "要分析的本地图片路径，支持 capture_screenshot 返回的 path"
          },
          "question": {
            "type": "string",
            "description": "希望视觉模型重点回答的问题，例如“指出布局错位和文字重叠问题”"
          }
        },
        "required": [
          "path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "view_image",
      "description": "Codex 风格图片查看/理解入口。用于查看本地图片、截图、设计稿或运行效果图；底层复用 inspect_image。只需要读取图片尺寸/预览时可直接 read_file 图片路径；需要理解画面内容时使用本工具。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "要查看或分析的本地图片路径，支持 capture_screenshot 返回的 path"
          },
          "question": {
            "type": "string",
            "description": "希望重点查看的问题，例如“检查按钮是否重叠”或“描述这个 UI 的异常”"
          }
        },
        "required": [
          "path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "render_svg_asset",
      "description": "把已有或生成的 SVG 资产渲染为 PNG/WebP/JPG/AVIF/TIFF 图片。适用于需要固定图片、贴图、poster、fallback、图标位图或社交预览图的场景；网页 UI 不应把它当成唯一视觉方案，优先按任务选择真实素材、Canvas/WebGL、视频或 SVG 转图。注意：短 SVG 可以直接传 svg_content；大 SVG 推荐先写 .svg 文件，再传 svg_path。",
      "parameters": {
        "type": "object",
        "properties": {
          "svg_path": {
            "type": "string",
            "description": "已有 SVG 文件路径。与 svg_content 二选一；相对路径基于当前项目。"
          },
          "svg_content": {
            "type": "string",
            "description": "SVG 源码。适合直接生成一次性资产；如果资产需要维护，优先先用 write_file 写入 .svg。"
          },
          "output_path": {
            "type": "string",
            "description": "输出图片路径，如 public/assets/hero-product.webp 或 src/assets/feature.png。相对路径基于当前项目。"
          },
          "format": {
            "type": "string",
            "enum": [
              "png",
              "webp",
              "jpg",
              "jpeg",
              "avif",
              "tiff"
            ],
            "description": "输出格式。网页优先 webp，透明图标/需要无损时用 png。"
          },
          "width": {
            "type": "integer",
            "description": "输出宽度，默认 1200。"
          },
          "height": {
            "type": "integer",
            "description": "输出高度，默认 800。"
          },
          "scale": {
            "type": "number",
            "description": "缩放倍数，默认 1。"
          },
          "quality": {
            "type": "integer",
            "description": "有损格式质量，默认 88。"
          },
          "background": {
            "type": "string",
            "description": "背景色，如 transparent、#ffffff。留空保持透明。"
          },
          "fit": {
            "type": "string",
            "enum": [
              "contain",
              "cover",
              "fill",
              "inside",
              "outside"
            ],
            "description": "缩放裁切方式，默认 contain。"
          }
        },
        "required": [
          "output_path"
        ]
      }
    }
  },
]
