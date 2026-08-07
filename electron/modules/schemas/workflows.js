module.exports = [
  {
    type: 'function',
    function: {
      name: 'artifact_workflow',
      description: '通用产物工作流工具，一工具生万法。用于 Blender/3D、PPT 等产物型任务。模型只传领域、目标、脚本或结构化动作；工具内部临时执行脚本/调用底层能力，并保留临时产物默认 1 天。注意：长脚本建议先写成脚本文件，或分阶段执行。',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: ['blender', 'ppt', 'excel', 'docx'],
            description: '产物领域。blender 用于 3D；ppt 用于演示；excel 用于表格；docx 用于 Word 文档。'
          },
          goal: {
            type: 'string',
            description: '用户目标或本次工作流意图。'
          },
          script: {
            type: 'string',
            description: '可选。由模型临时生成的脚本。blender 为 Blender Python；ppt 为对应 Python 控制脚本。复杂任务优先用脚本。'
          },
          script_path: {
            type: 'string',
            description: '可选。已有脚本路径，主要用于 Blender。'
          },
          action: {
            type: 'string',
            description: '可选。简单任务的动作名，例如 create、save、add_slide、run_script。复杂任务优先用 script。'
          },
          args: {
            type: 'object',
            description: '动作参数或领域参数。'
          },
          source_path: {
            type: 'string',
            description: '可选。Blender 等任务的输入资源路径。'
          },
          source_type: {
            type: 'string',
            enum: ['image', 'model', 'auto'],
            description: '可选。输入资源类型，默认 auto。'
          },
          options: {
            type: 'object',
            description: '领域配置，例如 Blender 操作列表等。'
          },
          operations: {
            type: 'array',
            description: '可选。Blender 结构化操作列表。',
            items: { type: 'object' }
          },
          visible: {
            type: 'boolean',
            description: '可选。是否显示外部程序窗口。'
          },
          wait: {
            type: 'boolean',
            description: '可选。是否等待执行完成，默认 true。'
          },
          auto_quit: {
            type: 'boolean',
            description: '可选。执行后是否自动退出外部程序。'
          },
          keep_days: {
            type: 'number',
            description: '临时脚本和产物保留天数，默认 1 天。'
          }
        },
        required: ['domain', 'goal']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'office_workflow',
      description: '高层 Office 工作流工具。用于 PPT / Excel / Word。模型描述目标、提供脚本或少量动作，工具内部调用底层 ppt_*/excel_*/docx_*；不要直接暴露几十个细工具。',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['ppt', 'excel', 'docx'],
            description: '目标类型：ppt 演示；excel 表格；docx Word 文档。'
          },
          goal: {
            type: 'string',
            description: '用户目标或本次工作流意图。'
          },
          script: {
            type: 'string',
            description: '可选。临时 Python 脚本。docx 经 docx_run_script（python-docx）；ppt/excel 走对应 run_script。'
          },
          action: {
            type: 'string',
            description: '可选。动作名（不带前缀），如 create、open、save、run_script、add_heading、write_cell、add_slide。'
          },
          args: {
            type: 'object',
            description: '传给底层动作的参数。'
          },
          keep_days: {
            type: 'number',
            description: '临时产物保留天数，默认 1 天。'
          }
        },
        required: ['kind', 'goal']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'blender_workflow',
      description: '高层 Blender 工作流工具。用于 3D 建模、材质、灯光、相机、渲染、导出和检查。模型临时生成 Blender Python 脚本交给本工具执行；底层 blender_* 细工具不直接暴露给模型。',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: '用户希望创建或修改的 3D 内容。'
          },
          script: {
            type: 'string',
            description: '可选。Blender Python 脚本代码。复杂建模应优先传脚本。'
          },
          script_path: {
            type: 'string',
            description: '可选。已有 Blender Python 脚本路径。'
          },
          blend_path: {
            type: 'string',
            description: '可选。要打开或保存的 .blend 文件路径。'
          },
          operations: {
            type: 'array',
            description: '可选。无需写脚本时的结构化操作列表，例如 material、lighting、render_preview、export_glb。',
            items: { type: 'object' }
          },
          visible: {
            type: 'boolean',
            description: '是否显示 Blender 窗口，默认 true。'
          },
          wait: {
            type: 'boolean',
            description: '是否等待执行完成，默认 true。'
          },
          auto_quit: {
            type: 'boolean',
            description: '执行后是否自动退出 Blender，默认 false。'
          },
          timeout: {
            type: 'number',
            description: '超时时间毫秒。'
          },
          keep_days: {
            type: 'number',
            description: '临时脚本和产物保留天数，默认 1 天。'
          }
        },
        required: ['goal']
      }
    }
  },
]
