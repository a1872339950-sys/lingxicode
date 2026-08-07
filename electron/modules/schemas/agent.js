/**
 * 工具 Schema - agent 类别 (2 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "request_agent_collaboration",
      "description": "在协作画布中启动一次性多 AI 任务。最多 4 个 AI 按串行或并行关系执行；每个 AI 复用主聊天窗口的后端工具、思考块和工具块，但不显示输入框、不恢复历史，最终只把汇报写入临时文件。临时 AI 可以运行本地检查/测试命令，但不能下载、安装依赖或拉取外部代码；需要依赖时只能写进汇报交给主窗口 AI/用户决定。适合把复杂任务拆给多个临时 AI 分工处理。",
      "parameters": {
        "type": "object",
        "properties": {
          "reason": {
            "type": "string",
            "description": "为什么需要临时多 AI 执行"
          },
          "recommendation": {
            "type": "string",
            "enum": [
              "serial",
              "parallel"
            ],
            "description": "推荐执行方式，默认 parallel"
          },
          "coordinationNote": {
            "type": "string",
            "description": "给所有临时 AI 的协作边界和注意事项"
          },
          "plan": {
            "type": "array",
            "description": "主计划步骤",
            "items": {
              "type": "string"
            }
          },
          "agents": {
            "type": "array",
            "description": "要打开的临时 AI，最多 4 个",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "role": {
                  "type": "string"
                },
                "task": {
                  "type": "string"
                },
                "focusPaths": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "task"
              ]
            }
          }
        },
        "required": [
          "agents"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_agent_collaboration_status",
      "description": "读取协作画布中一次性多 AI 任务的状态。不要连续轮询；只在需要确认是否完成或读取错误状态时调用。",
      "parameters": {
        "type": "object",
        "properties": {
          "sessionId": {
            "type": "string",
            "description": "可选，会话 ID。不传则读取当前项目最近一次临时多 AI 执行。"
          }
        }
      }
    }
  }
]
