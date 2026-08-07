/**
 * 工具 Schema - blender 类别 (7 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "blender_status",
      "description": "检查本机是否可用 Blender，并返回可执行文件路径和版本。需要制作 3D 模型、GLB、材质、预览图或用户要求可视化 Blender 操作前，先调用此工具确认环境。",
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
      "name": "blender_create_demo_model",
      "description": "在 Blender 中创建一个可视化演示 3D 模型，并导出 .glb、.blend 和预览图。默认 visible=true 且 slow_mode=true，会打开真实 Blender 窗口并以慢速模式构建模型，让用户看到每个步骤的构建过程；用户明确要求快速生成时设置 slow_mode=false。",
      "parameters": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "模型文件名，默认 lingxi-cyber-orb"
          },
          "theme": {
            "type": "string",
            "description": "模型主题或风格，例如 cyberpunk planet、ancient jade device"
          },
          "output_dir": {
            "type": "string",
            "description": "可选，模型输出目录，默认 assets/blender/models"
          },
          "preview_dir": {
            "type": "string",
            "description": "可选，预览图输出目录，默认 assets/blender/previews"
          },
          "visible": {
            "type": "boolean",
            "description": "是否打开可视化 Blender 窗口，默认 true"
          },
          "slow_mode": {
            "type": "boolean",
            "description": "是否启用慢速可视化模式，默认 true。慢速模式下每个构建步骤延迟 1-3 秒，让用户看到构建过程；快速模式下延迟 0.5 秒以内，快速完成。"
          },
          "visual_delay": {
            "type": "boolean",
            "description": "同 slow_mode，是否启用可视化延迟，默认 true"
          },
          "wait": {
            "type": "boolean",
            "description": "是否等待 Blender 执行完成。可视化 visible=true 时通常不要等待，因为 Blender 窗口可能保持打开；需要后台导出日志时使用 visible=false 且 wait=true"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "blender_run_script",
      "description": "运行自定义 Blender Python 脚本，用于创建 3D 场景、模型、材质、动画、相机、灯光并导出资产。默认 visible=true，会打开真实 Blender 窗口；适合让用户看到 AI 一步步构建模型。",
      "parameters": {
        "type": "object",
        "properties": {
          "script": {
            "type": "string",
            "description": "Blender Python 脚本内容。会写入 assets/blender/scripts 后执行"
          },
          "script_path": {
            "type": "string",
            "description": "可选，已有脚本路径；相对路径按当前项目解析"
          },
          "name": {
            "type": "string",
            "description": "可选，写入脚本文件名"
          },
          "visible": {
            "type": "boolean",
            "description": "是否打开可视化 Blender 窗口，默认 true"
          },
          "wait": {
            "type": "boolean",
            "description": "是否等待 Blender 执行完成，默认 false。可视化 visible=true 时通常不要等待，因为 Blender 窗口可能保持打开；后台任务可用 visible=false 且 wait=true"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "blender_modify_scene",
      "description": "对现有 Blender 场景或 .blend 文件执行明确的后处理操作，不需要临场手写 bpy 脚本。适合“平滑一下”“加细分/倒角”“上材质颜色”“补灯光”“渲染多视角检查图”“保存/导出 GLB”。若已有 .blend 文件，传 blend_path；否则会处理当前默认场景。相比 blender_run_script 更适合确定性修改。",
      "parameters": {
        "type": "object",
        "properties": {
          "blend_path": {
            "type": "string",
            "description": "可选，要打开并修改的 .blend 文件路径；相对路径按当前项目解析"
          },
          "name": {
            "type": "string",
            "description": "输出资产名称，默认 lingxi-blender-asset"
          },
          "operations": {
            "type": "array",
            "description": "按顺序执行的操作。常用：smooth 平滑；subdivision 加细分；bevel 加倒角；merge_by_distance 焊接近距离点；material 设置材质；lighting 设置灯光；render_preview 渲染预览；render_views 渲染 front/back/left/right/top 检查图；save 保存 blend；export_glb 导出 glb。",
            "items": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "smooth",
                    "subdivision",
                    "bevel",
                    "merge_by_distance",
                    "material",
                    "lighting",
                    "render_preview",
                    "render_views",
                    "save",
                    "export_glb"
                  ]
                },
                "levels": {
                  "type": "number",
                  "description": "subdivision 细分视图等级，建议 1-2"
                },
                "render_levels": {
                  "type": "number",
                  "description": "subdivision 渲染等级，建议 1-2"
                },
                "width": {
                  "type": "number",
                  "description": "render_preview/render_views 输出宽度像素"
                },
                "segments": {
                  "type": "number",
                  "description": "bevel 倒角段数，建议 2-6"
                },
                "distance": {
                  "type": "number",
                  "description": "merge_by_distance 焊接距离，建议 0.001-0.03"
                },
                "name": {
                  "type": "string",
                  "description": "material 材质名"
                },
                "color": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  },
                  "description": "material 基础色 RGBA 或 RGB，取值 0-1"
                },
                "metallic": {
                  "type": "number",
                  "description": "material 金属度 0-1"
                },
                "roughness": {
                  "type": "number",
                  "description": "material 粗糙度 0-1"
                },
                "emission": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  },
                  "description": "material 发光颜色 RGB/RGBA，取值 0-1"
                },
                "emission_strength": {
                  "type": "number",
                  "description": "material 发光强度"
                },
                "height": {
                  "type": "number",
                  "description": "render_preview/render_views 输出高度像素"
                },
                "camera": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  },
                  "description": "render_preview 相机位置 [x,y,z]"
                },
                "lens": {
                  "type": "number",
                  "description": "render_preview/render_views 相机焦距"
                },
                "path": {
                  "type": "string",
                  "description": "save/export/render 的自定义输出路径"
                }
              },
              "required": [
                "type"
              ]
            }
          },
          "output_blend": {
            "type": "string",
            "description": "可选，保存 .blend 的输出路径"
          },
          "output_glb": {
            "type": "string",
            "description": "可选，导出 .glb 的输出路径"
          },
          "preview_path": {
            "type": "string",
            "description": "可选，预览图输出路径"
          },
          "output_dir": {
            "type": "string",
            "description": "可选，默认 assets/blender/models"
          },
          "preview_dir": {
            "type": "string",
            "description": "可选，默认 assets/blender/previews"
          },
          "views_dir": {
            "type": "string",
            "description": "可选，多视角检查图目录，默认 assets/blender/views/{name}"
          },
          "visible": {
            "type": "boolean",
            "description": "是否打开真实 Blender 窗口，默认 true"
          },
          "wait": {
            "type": "boolean",
            "description": "是否等待执行完成；需要拿到 stdout/确认导出结果时可设 true，并配合 visible=false 或 auto_quit=true"
          },
          "auto_quit": {
            "type": "boolean",
            "description": "执行后自动退出 Blender，适合 wait=true 的后台后处理"
          },
          "timeout": {
            "type": "number",
            "description": "等待超时时间毫秒"
          }
        },
        "required": [
          "operations"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "blender_import_asset",
      "description": "把参考图片或外部 3D 模型导入 Blender 场景。适合用户给了参考图、GLB/GLTF/FBX/OBJ/STL/PLY/BLEND 文件，或需要先把参考图放进 Blender 作为建模参照。导入项目外文件前会走 AI 授权。会保存 .blend、尝试导出 .glb，并渲染预览图。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "参考图或模型文件路径。支持 png/jpg/jpeg/webp/bmp/tif/tiff/glb/gltf/fbx/obj/stl/ply/blend"
          },
          "kind": {
            "type": "string",
            "enum": [
              "reference_image",
              "model"
            ],
            "description": "可选，reference_image 表示作为参考图导入；model 表示导入 3D 模型。不传则按扩展名判断。"
          },
          "name": {
            "type": "string",
            "description": "输出资产名称，默认 lingxi-blender-import"
          },
          "reference_plane": {
            "type": "boolean",
            "description": "图片是否创建为 Blender 中的参考平面，默认 true"
          },
          "clear_scene": {
            "type": "boolean",
            "description": "导入前是否清空场景，默认 true"
          },
          "scale": {
            "type": "number",
            "description": "导入模型缩放倍数，默认 1"
          },
          "output_blend": {
            "type": "string",
            "description": "可选，保存 .blend 的输出路径"
          },
          "output_glb": {
            "type": "string",
            "description": "可选，导出 .glb 的输出路径"
          },
          "preview_path": {
            "type": "string",
            "description": "可选，预览图输出路径"
          },
          "output_dir": {
            "type": "string",
            "description": "可选，默认 assets/blender/models"
          },
          "preview_dir": {
            "type": "string",
            "description": "可选，默认 assets/blender/previews"
          },
          "visible": {
            "type": "boolean",
            "description": "是否打开真实 Blender 窗口，默认 true"
          },
          "wait": {
            "type": "boolean",
            "description": "是否等待执行完成。需要拿到导出结果时设 true，并配合 auto_quit=true"
          },
          "auto_quit": {
            "type": "boolean",
            "description": "执行后自动退出 Blender，适合 wait=true"
          },
          "timeout": {
            "type": "number",
            "description": "等待超时时间毫秒"
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
      "name": "blender_inspect_scene",
      "description": "检查 Blender 场景或 .blend 文件质量，并输出 JSON 报告和多视角检查图。适合检查模型是否为空、缺材质、缺灯光/相机、尺寸异常、对象偏离主场景等问题；用于修复前后的复核。",
      "parameters": {
        "type": "object",
        "properties": {
          "blend_path": {
            "type": "string",
            "description": "可选，要检查的 .blend 文件路径；不传则检查默认/当前脚本场景"
          },
          "name": {
            "type": "string",
            "description": "报告名称，默认 lingxi-blender-inspect"
          },
          "report_path": {
            "type": "string",
            "description": "可选，JSON 报告输出路径"
          },
          "views_dir": {
            "type": "string",
            "description": "可选，多视角检查图目录"
          },
          "render_views": {
            "type": "boolean",
            "description": "是否渲染 front/back/left/right/top 多视角检查图，默认 true"
          },
          "visible": {
            "type": "boolean",
            "description": "是否打开真实 Blender 窗口，默认 false"
          },
          "wait": {
            "type": "boolean",
            "description": "是否等待检查完成，默认 true"
          },
          "auto_quit": {
            "type": "boolean",
            "description": "执行后自动退出 Blender，默认 true"
          },
          "timeout": {
            "type": "number",
            "description": "等待超时时间毫秒，默认 120000"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "blender_3d_relay",
      "description": "启动专门的 Blender 3D 模型接力工作流。不是并行派发子Agent，而是参考图Agent -> 建模Agent -> 材质灯光Agent -> 检查Agent -> 修复Agent -> 导出Agent 顺序接力。适合角色、物体、可视化3D资产、参考图转3D模型。会先生成或使用参考图，再导入 Blender 作为参照，多视角渲染检查眼睛/四肢/材质/断开/穿模问题，必要时自动修复，最后导出 glb/blend/png。若未传 reference_image，需要已配置图片生成模型；检查阶段需要视觉理解模型。",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description": "用户想要的 3D 模型描述，包含主体、结构、颜色、材质、用途"
          },
          "name": {
            "type": "string",
            "description": "资产名称，默认 blender-relay-model"
          },
          "style": {
            "type": "string",
            "description": "风格，例如赛博朋克、卡通、写实、低多边形"
          },
          "reference_image": {
            "type": "string",
            "description": "可选，用户已有参考图路径；不传则先调用文生图生成参考图"
          },
          "reference_prompt": {
            "type": "string",
            "description": "可选，指定文生图参考图提示词"
          },
          "image_size": {
            "type": "string",
            "description": "参考图尺寸，默认 1024x1024"
          },
          "visible": {
            "type": "boolean",
            "description": "是否打开真实 Blender 可视化窗口，默认 true"
          }
        },
        "required": [
          "prompt"
        ]
      }
    }
  }
]
