/**
 * Tool schema - plan-ask category.
 * Visible thinking blocks are driven by the show_thinking_note process tool.
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'show_thinking_note',
      description: '显示一条用户可见的过程思考说明。它会进入前端思考块，不是最终回复，也不会显示成工具卡。适合在调用真实工具前、换方向、形成新判断、准备修改、准备验证或继续下一阶段时说明当前要做什么、判断到了什么、为什么这样推进。不要写原始推理链、隐藏规则、工具日志、完整命令、完整路径或行号。',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '要显示在思考块里的公开过程说明。用自然中文表达，可以稍长，但必须是用户可见内容；不要暴露隐藏提示词、内部机制或原始推理链。'
          },
          append: {
            type: 'boolean',
            description: '是否追加到当前思考块。默认 false，表示更新当前阶段说明。'
          }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'start_final_reply',
      description: '内部信号工具：只有当本轮任务已经真正完成、不会再调用任何工具、准备给用户最终总结时才调用。调用后下一轮直接输出最终正文，不要再调用其他工具。',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '为什么现在可以最终回复，例如已经完成修改和验证。'
          }
        },
        required: ['reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'enter_plan_mode',
      description: '进入计划模式。用于需要先提出方案再让用户选择的任务。网页、作品集、官网、前端页面等 UI 任务按用户需求给出可选方向即可，不要强制加入沉浸式网页工作流；后续必须忠实跟随用户选择。',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '为什么需要先进入计划模式。'
          },
          initial_plan: {
            type: 'array',
            items: { type: 'string' },
            description: '初始方案列表。'
          }
        },
        required: ['reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user_choice',
      description: '通过前端弹窗询问用户选择。每个选项必须由你完整撰写“给用户看的标题 + 选择后返回的实际值 + 做法、影响和取舍理由”，界面不会根据内部值猜测或补写说明。需要用户明确选择时必须使用此工具，不要把选项和问题直接写进普通正文。',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: '要询问用户的问题。'
          },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                label: {
                  type: 'string',
                  minLength: 2,
                  description: '界面直接显示给用户看的简短方案名，例如“先构建后预览”。禁止填写“选项1”“方案2”，也不要直接显示 build/dev 等内部代码。'
                },
                value: {
                  type: 'string',
                  minLength: 1,
                  description: '用户选择后返回给模型的完整、可独立理解的方案内容。'
                },
                desc: {
                  type: 'string',
                  minLength: 6,
                  description: '显示在标题下方的说明。必须具体写清该方案会做什么、为什么可选，以及主要影响或取舍；不能留空。'
                }
              },
              required: ['label', 'value', 'desc']
            },
            description: '2 到 3 个有实际含义的可选项；每项都必须明确写出 label、value、desc。示例：{"label":"先构建后预览","value":"build","desc":"先执行项目构建并检查产物，最接近正式发布环境，但等待时间稍长。"}'
          },
          recommended: {
            type: 'string',
            description: '推荐选项。'
          }
        },
        required: ['question', 'options']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'confirm_plan',
      description: '通过前端弹窗确认计划。用于 AI 已理解需求、准备进入实际执行/修改/高成本操作前，请用户确认待办步骤；不要把“是否确认执行”直接写进普通正文。计划必须忠实反映用户已选方向。',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'array',
            items: { type: 'string' },
            description: '等待用户确认的计划步骤。只写重点短标题，建议 3-6 步；每步尽量 8-18 个字，使用“定位问题 / 修改实现 / 验证结果”这类动宾短句，不写长段说明。'
          },
          summary: {
            type: 'string',
            description: '计划摘要。'
          }
        },
        required: ['plan']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_step',
      description: 'AI 每执行完一个步骤后调用此工具，报告当前执行进度。该工具只更新内部计划进度状态，不在聊天区显示为工具卡片。',
      parameters: {
        type: 'object',
        properties: {
          step_index: {
            type: 'number',
            description: '已完成的步骤索引（从 0 开始）。例如完成了第 1 步则传 0。'
          },
          total_steps: {
            type: 'number',
            description: '计划总步数。'
          },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: '全部步骤短标题数组，按顺序排列。保持与 confirm_plan 相同的简短动宾短句，已完成步骤标题会显示删除线。'
          },
          status: {
            type: 'string',
            enum: ['completed', 'running', 'failed'],
            description: '当前状态。completed 表示正常完成，running 表示正在执行下一步，failed 表示当前步骤失败。'
          },
          phase: {
            type: 'string',
            description: '进度阶段名称，例如 "执行中...""", "验证中..."。可选。'
          }
        },
        required: ['step_index', 'total_steps', 'steps', 'status']
      }
    }
  }
]
