/**
 * 工具 Schema - ppt 类别 (38 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "ppt_open",
      "description": "打开本地 PowerPoint 软件。用户可以看到 PPT 窗口弹出。",
      "parameters": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean",
            "description": "是否显示窗口（默认true）"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_create",
      "description": "创建新的 PowerPoint 演示文稿。用户看到空白 PPT 打开。",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_load",
      "description": "加载已有的 PowerPoint 文件。",
      "parameters": {
        "type": "object",
        "properties": {
          "file_path": {
            "type": "string",
            "description": "PPT 文件路径（如 E:/demo.pptx）"
          }
        },
        "required": [
          "file_path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_slide",
      "description": "添加新幻灯片。用户看到新页面出现。",
      "parameters": {
        "type": "object",
        "properties": {
          "layout_type": {
            "type": "string",
            "description": "布局类型: blank(空白), title(标题), title_content(标题内容), two_content(两栏)",
            "enum": [
              "blank",
              "title",
              "title_content",
              "two_content",
              "section_header",
              "title_only"
            ]
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_title",
      "description": "设置当前幻灯片的标题。",
      "parameters": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "description": "标题文字"
          }
        },
        "required": [
          "title"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_content",
      "description": "设置当前幻灯片的内容文本。",
      "parameters": {
        "type": "object",
        "properties": {
          "content": {
            "type": "string",
            "description": "内容文字"
          }
        },
        "required": [
          "content"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_text",
      "description": "在指定位置添加文本框。",
      "parameters": {
        "type": "object",
        "properties": {
          "left": {
            "type": "number",
            "description": "左边距（英寸）"
          },
          "top": {
            "type": "number",
            "description": "上边距（英寸）"
          },
          "width": {
            "type": "number",
            "description": "宽度（英寸）"
          },
          "height": {
            "type": "number",
            "description": "高度（英寸）"
          },
          "text": {
            "type": "string",
            "description": "文本内容"
          },
          "font_size": {
            "type": "integer",
            "description": "字体大小"
          },
          "font_color": {
            "type": "string",
            "description": "字体颜色如 #333333"
          },
          "bold": {
            "type": "boolean",
            "description": "是否加粗"
          }
        },
        "required": [
          "left",
          "top",
          "text"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_bullets",
      "description": "添加项目符号列表（适合要点列举）。",
      "parameters": {
        "type": "object",
        "properties": {
          "left": {
            "type": "number",
            "description": "左边距（英寸）"
          },
          "top": {
            "type": "number",
            "description": "上边距（英寸）"
          },
          "items": {
            "type": "array",
            "description": "列表项数组，如 [\"要点1\", \"要点2\", \"要点3\"]",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "items"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_bg_color",
      "description": "设置当前幻灯片背景颜色。",
      "parameters": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string",
            "description": "背景颜色如 #f5f5f5（浅灰）"
          }
        },
        "required": [
          "color"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_goto_slide",
      "description": "跳转到指定幻灯片页面。",
      "parameters": {
        "type": "object",
        "properties": {
          "slide_index": {
            "type": "integer",
            "description": "幻灯片序号（从1开始）"
          }
        },
        "required": [
          "slide_index"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_save",
      "description": "保存 PowerPoint 文件。",
      "parameters": {
        "type": "object",
        "properties": {
          "file_path": {
            "type": "string",
            "description": "保存路径（可选）"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_image",
      "description": "在幻灯片中插入图片。支持精确位置和大小设置。",
      "parameters": {
        "type": "object",
        "properties": {
          "image_path": {
            "type": "string",
            "description": "图片文件路径（支持 jpg/png/gif/bmp）"
          },
          "left": {
            "type": "number",
            "description": "左边距（英寸，默认0）"
          },
          "top": {
            "type": "number",
            "description": "上边距（英寸，默认0）"
          },
          "width": {
            "type": "number",
            "description": "宽度（英寸，可选，不填则使用原始尺寸）"
          },
          "height": {
            "type": "number",
            "description": "高度（英寸，可选）"
          }
        },
        "required": [
          "image_path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_video",
      "description": "在幻灯片中插入视频。支持自动播放、循环、全屏等选项。电影级PPT核心工具。",
      "parameters": {
        "type": "object",
        "properties": {
          "video_path": {
            "type": "string",
            "description": "视频文件路径（支持 mp4/avi/wmv）"
          },
          "left": {
            "type": "number",
            "description": "左边距（英寸）"
          },
          "top": {
            "type": "number",
            "description": "上边距（英寸）"
          },
          "width": {
            "type": "number",
            "description": "宽度（英寸）"
          },
          "height": {
            "type": "number",
            "description": "高度（英寸）"
          },
          "auto_play": {
            "type": "boolean",
            "description": "是否自动播放（默认true）"
          },
          "loop": {
            "type": "boolean",
            "description": "是否循环播放（默认false）"
          },
          "full_screen": {
            "type": "boolean",
            "description": "是否全屏播放（默认false）"
          }
        },
        "required": [
          "video_path",
          "left",
          "top"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_audio",
      "description": "在幻灯片中插入音频。适合背景音乐或配音。",
      "parameters": {
        "type": "object",
        "properties": {
          "audio_path": {
            "type": "string",
            "description": "音频文件路径（支持 mp3/wav）"
          },
          "auto_play": {
            "type": "boolean",
            "description": "是否自动播放（默认true）"
          },
          "loop": {
            "type": "boolean",
            "description": "是否循环播放（默认false）"
          },
          "hide": {
            "type": "boolean",
            "description": "是否隐藏音频图标（默认true）"
          }
        },
        "required": [
          "audio_path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_shape",
      "description": "绘制形状。支持矩形、圆形、三角形、星形、箭头等。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_type": {
            "type": "string",
            "description": "形状类型: rectangle/oval/circle/diamond/triangle/star/arrow/round_rectangle",
            "enum": [
              "rectangle",
              "oval",
              "circle",
              "diamond",
              "triangle",
              "star",
              "arrow",
              "round_rectangle",
              "right_triangle",
              "line"
            ]
          },
          "left": {
            "type": "number",
            "description": "左边距（英寸）"
          },
          "top": {
            "type": "number",
            "description": "上边距（英寸）"
          },
          "width": {
            "type": "number",
            "description": "宽度（英寸）"
          },
          "height": {
            "type": "number",
            "description": "高度（英寸）"
          },
          "fill_color": {
            "type": "string",
            "description": "填充颜色如 #ff0000（可选）"
          },
          "line_color": {
            "type": "string",
            "description": "边框颜色（可选）"
          },
          "line_width": {
            "type": "number",
            "description": "边框宽度（默认1）"
          }
        },
        "required": [
          "shape_type",
          "left",
          "top",
          "width",
          "height"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_line",
      "description": "绘制线条。支持箭头设置。",
      "parameters": {
        "type": "object",
        "properties": {
          "start_x": {
            "type": "number",
            "description": "起点X（英寸）"
          },
          "start_y": {
            "type": "number",
            "description": "起点Y（英寸）"
          },
          "end_x": {
            "type": "number",
            "description": "终点X（英寸）"
          },
          "end_y": {
            "type": "number",
            "description": "终点Y（英寸）"
          },
          "line_color": {
            "type": "string",
            "description": "线条颜色"
          },
          "line_width": {
            "type": "number",
            "description": "线条宽度"
          },
          "arrow_type": {
            "type": "string",
            "description": "箭头类型: none/arrow/arrow_both/arrow_start",
            "enum": [
              "none",
              "arrow",
              "arrow_both",
              "arrow_start"
            ]
          }
        },
        "required": [
          "start_x",
          "start_y",
          "end_x",
          "end_y"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_animation",
      "description": "添加动画效果。电影级PPT必备。**重要**: shape_name 必须使用 ppt_add_shape/ppt_add_image 等工具返回的名称，或先调用 ppt_list_shapes 获取。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "目标形状名称（可先通过list_shapes获取）"
          },
          "effect_type": {
            "type": "string",
            "description": "动画类型: fade/fly/zoom/wipe/cover/push/bounce/blinds/box/checkerboard/dissolve/split/grow/spin/random/appear",
            "enum": [
              "fade",
              "fly",
              "zoom",
              "wipe",
              "cover",
              "push",
              "bounce",
              "blinds",
              "box",
              "checkerboard",
              "dissolve",
              "split",
              "grow",
              "spin",
              "random",
              "appear",
              "wheel",
              "float"
            ]
          },
          "trigger": {
            "type": "string",
            "description": "触发方式: on_click/after_previous/with_previous",
            "enum": [
              "on_click",
              "after_previous",
              "with_previous"
            ]
          },
          "duration": {
            "type": "number",
            "description": "持续时间（秒，默认1）"
          },
          "delay": {
            "type": "number",
            "description": "延迟时间（秒，默认0）"
          },
          "direction": {
            "type": "string",
            "description": "方向: from_left/from_top/from_right/from_bottom/from_center",
            "enum": [
              "from_left",
              "from_top",
              "from_right",
              "from_bottom",
              "from_center"
            ]
          }
        },
        "required": [
          "shape_name",
          "effect_type"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_motion_path",
      "description": "添加动作路径动画。让元素沿路径移动，电影级动画效果。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "目标形状名称"
          },
          "path_type": {
            "type": "string",
            "description": "路径类型: line/arc/circle/figure_8/zigzag",
            "enum": [
              "line",
              "arc",
              "circle",
              "figure_8",
              "zigzag"
            ]
          },
          "duration": {
            "type": "number",
            "description": "持续时间（秒）"
          },
          "trigger": {
            "type": "string",
            "description": "触发方式",
            "enum": [
              "on_click",
              "after_previous",
              "with_previous"
            ]
          }
        },
        "required": [
          "shape_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_animation_timing",
      "description": "设置动画时间参数。精确控制动画节奏。",
      "parameters": {
        "type": "object",
        "properties": {
          "effect_index": {
            "type": "integer",
            "description": "动画索引（从1开始）"
          },
          "duration": {
            "type": "number",
            "description": "持续时间（秒）"
          },
          "delay": {
            "type": "number",
            "description": "延迟时间（秒）"
          },
          "repeat_count": {
            "type": "integer",
            "description": "重复次数"
          },
          "auto_reverse": {
            "type": "boolean",
            "description": "是否自动反向"
          }
        },
        "required": [
          "effect_index"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_transition",
      "description": "设置幻灯片切换效果。电影级过渡动画。",
      "parameters": {
        "type": "object",
        "properties": {
          "transition_type": {
            "type": "string",
            "description": "切换类型: fade/push/cover/wipe/zoom/dissolve/cube/curtains/origami/page_curl/ripple/halo/pan/glitter/warp/random",
            "enum": [
              "none",
              "fade",
              "push",
              "cover",
              "wipe",
              "zoom",
              "dissolve",
              "cube",
              "curtains",
              "origami",
              "page_curl",
              "ripple",
              "halo",
              "pan",
              "glitter",
              "warp",
              "wheel",
              "fly_through",
              "random",
              "blinds",
              "split",
              "fade_through_black"
            ]
          },
          "duration": {
            "type": "number",
            "description": "持续时间（秒）"
          },
          "manual": {
            "type": "boolean",
            "description": "是否手动点击切换"
          },
          "auto_advance": {
            "type": "boolean",
            "description": "是否自动切换"
          },
          "advance_time": {
            "type": "number",
            "description": "自动切换等待时间（秒）"
          }
        },
        "required": [
          "transition_type"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_transition_sound",
      "description": "设置切换音效。",
      "parameters": {
        "type": "object",
        "properties": {
          "sound_path": {
            "type": "string",
            "description": "音效文件路径"
          },
          "loop": {
            "type": "boolean",
            "description": "是否循环"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_font_style",
      "description": "设置文本字体样式。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          },
          "font_size": {
            "type": "number",
            "description": "字体大小"
          },
          "font_color": {
            "type": "string",
            "description": "字体颜色如 #333333"
          },
          "font_name": {
            "type": "string",
            "description": "字体名称如 Arial"
          },
          "bold": {
            "type": "boolean",
            "description": "是否加粗"
          },
          "italic": {
            "type": "boolean",
            "description": "是否斜体"
          },
          "underline": {
            "type": "boolean",
            "description": "是否下划线"
          }
        },
        "required": [
          "shape_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_element_position",
      "description": "设置元素位置。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          },
          "left": {
            "type": "number",
            "description": "左边距（英寸）"
          },
          "top": {
            "type": "number",
            "description": "上边距（英寸）"
          }
        },
        "required": [
          "shape_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_element_size",
      "description": "设置元素大小。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          },
          "width": {
            "type": "number",
            "description": "宽度（英寸）"
          },
          "height": {
            "type": "number",
            "description": "高度（英寸）"
          }
        },
        "required": [
          "shape_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_element_rotation",
      "description": "设置元素旋转角度。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          },
          "angle": {
            "type": "number",
            "description": "旋转角度（度）"
          }
        },
        "required": [
          "shape_name",
          "angle"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_gradient_background",
      "description": "设置渐变背景。增强视觉效果。",
      "parameters": {
        "type": "object",
        "properties": {
          "color1": {
            "type": "string",
            "description": "起始颜色"
          },
          "color2": {
            "type": "string",
            "description": "结束颜色"
          },
          "direction": {
            "type": "string",
            "description": "方向: horizontal/vertical/diagonal_up/diagonal_down/from_center",
            "enum": [
              "horizontal",
              "vertical",
              "diagonal_up",
              "diagonal_down",
              "from_center"
            ]
          }
        },
        "required": [
          "color1",
          "color2"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_set_shape_fill",
      "description": "设置形状填充。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          },
          "fill_type": {
            "type": "string",
            "description": "填充类型: solid/gradient/none",
            "enum": [
              "solid",
              "gradient",
              "none"
            ]
          },
          "color": {
            "type": "string",
            "description": "颜色"
          },
          "transparency": {
            "type": "number",
            "description": "透明度（0-1）"
          },
          "gradient_color2": {
            "type": "string",
            "description": "渐变第二色"
          }
        },
        "required": [
          "shape_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_hyperlink",
      "description": "添加超链接。交互式PPT必备。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          },
          "link_type": {
            "type": "string",
            "description": "链接类型: url/slide/first_slide/last_slide/next_slide/previous_slide",
            "enum": [
              "url",
              "slide",
              "first_slide",
              "last_slide",
              "next_slide",
              "previous_slide"
            ]
          },
          "target": {
            "type": "string",
            "description": "目标地址或幻灯片索引"
          },
          "tooltip": {
            "type": "string",
            "description": "鼠标悬停提示"
          }
        },
        "required": [
          "shape_name",
          "link_type"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_add_chart",
      "description": "插入图表。",
      "parameters": {
        "type": "object",
        "properties": {
          "chart_type": {
            "type": "string",
            "description": "图表类型: column/bar/line/pie/scatter/area/doughnut",
            "enum": [
              "column",
              "bar",
              "line",
              "pie",
              "scatter",
              "area",
              "doughnut"
            ]
          },
          "left": {
            "type": "number",
            "description": "左边距（英寸）"
          },
          "top": {
            "type": "number",
            "description": "上边距（英寸）"
          },
          "width": {
            "type": "number",
            "description": "宽度（英寸）"
          },
          "height": {
            "type": "number",
            "description": "高度（英寸）"
          },
          "data": {
            "type": "object",
            "description": "图表数据: {categories:[], values:[], series_name:\"\"}"
          }
        },
        "required": [
          "chart_type"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_align_elements",
      "description": "对齐多个元素。",
      "parameters": {
        "type": "object",
        "properties": {
          "align_type": {
            "type": "string",
            "description": "对齐方式: left/right/top/bottom/center/middle",
            "enum": [
              "left",
              "right",
              "top",
              "bottom",
              "center",
              "middle"
            ]
          },
          "shapes": {
            "type": "array",
            "description": "形状名称数组",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "align_type",
          "shapes"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_distribute_elements",
      "description": "均匀分布元素。",
      "parameters": {
        "type": "object",
        "properties": {
          "distribute_type": {
            "type": "string",
            "description": "分布方式: horizontal/vertical",
            "enum": [
              "horizontal",
              "vertical"
            ]
          },
          "shapes": {
            "type": "array",
            "description": "形状名称数组",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "distribute_type",
          "shapes"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_group_shapes",
      "description": "组合多个形状。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_names": {
            "type": "array",
            "description": "形状名称数组",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "shape_names"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_duplicate_shape",
      "description": "复制形状。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          },
          "offset_x": {
            "type": "number",
            "description": "水平偏移（英寸）"
          },
          "offset_y": {
            "type": "number",
            "description": "垂直偏移（英寸）"
          }
        },
        "required": [
          "shape_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_delete_shape",
      "description": "删除形状。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          }
        },
        "required": [
          "shape_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_rename_shape",
      "description": "重命名形状。",
      "parameters": {
        "type": "object",
        "properties": {
          "old_name": {
            "type": "string",
            "description": "原名称"
          },
          "new_name": {
            "type": "string",
            "description": "新名称"
          }
        },
        "required": [
          "old_name",
          "new_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_get_shape_info",
      "description": "获取形状信息。",
      "parameters": {
        "type": "object",
        "properties": {
          "shape_name": {
            "type": "string",
            "description": "形状名称"
          }
        },
        "required": [
          "shape_name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_list_shapes",
      "description": "列出当前幻灯片所有形状。获取形状名称用于后续操作。",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ppt_run_script",
      "description": "执行 PPT 脚本。**推荐用于复杂任务**：先设计完整 PPT 结构，写成一个 Python 脚本，然后执行。脚本内部可设置延迟(time.sleep)，用户能看到一步一步构建的可视化效果。比逐个调用工具更可靠、更美观，不会出现页面错乱或名称匹配错误。",
      "parameters": {
        "type": "object",
        "properties": {
          "script": {
            "type": "string",
            "description": "Python 脚本代码。可用函数：open_ppt(), create_new(), add_slide(layout), goto_slide(index), add_shape(type,left,top,w,h), add_text_box(left,top,w,h,text), add_image(path,left,top,w,h), add_animation(shape_name,effect), set_transition(type), save_file(path) 等。示例见下方。"
          },
          "delay": {
            "type": "number",
            "description": "每步操作延迟时间（秒，默认0.3）。设置后脚本会自动在每步操作间插入延迟，模拟一步一步构建效果。"
          }
        },
        "required": [
          "script"
        ]
      }
    }
  }
]
