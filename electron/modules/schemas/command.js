/**
 * 工具 Schema - command 类别 (5 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "shell_run",
      "description": "统一命令工具，类似 Codex 的命令执行入口。action=run 执行命令；短命令自动走隐藏的一次性执行，dev server/watch/安装/下载/长时间任务会自动转后台并返回 sessionId。Windows 下 rg/git grep/node --check/tsc 等只读搜索或检查命令会优先走安全执行和内部输出限制，避免复杂正则、引号和管道被 cmd.exe 拆坏。命令工具主要用于验证、构建、测试、运行、只读搜索和批量机械处理；源码修改优先使用 text_edit/apply_patch/edit_file/json_edit/copy_file/move_file。代码定位不要依赖自然语言候选工具；由模型自行提炼具体关键词、DOM id、函数名、错误文本、文件名或路径模式后，再用 shell_run/glob_files/read_many_files 等事实工具收敛证据。复杂多行脚本不要直接塞进 command，先写临时脚本文件再执行。",
      "parameters": {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "enum": [
              "run",
              "status",
              "stop"
            ],
            "description": "操作类型，默认 run"
          },
          "command": {
            "type": "string",
            "description": "action=run 时填写命令"
          },
          "cwd": {
            "type": "string",
            "description": "可选，执行目录；默认当前项目目录"
          },
          "background": {
            "type": "boolean",
            "description": "是否强制作为后台长任务运行。启动服务、watch、构建、测试、安装/下载依赖建议 true；不填时系统自动判断"
          },
          "session_id": {
            "type": "string",
            "description": "可选，后台终端会话 ID；status/stop 时可传"
          },
          "auto_stop_after_ms": {
            "type": "integer",
            "description": "可选，后台命令自动停止时间。适合临时启动 dev server 并交给 runtime_verify 检查，例如 120000。持久开发服务不传，但验证结束必须 action=stop"
          },
          "include_output": {
            "type": "boolean",
            "description": "action=status 时是否返回输出，默认 true"
          },
          "force_refresh": {
            "type": "boolean",
            "description": "action=status 时是否立即刷新；普通等待长命令不要频繁 true"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "run_command",
      "description": "执行短命令。只适合会很快退出的命令；npm install、npm run dev、启动服务器、下载依赖等长任务必须使用 terminal_run。",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string",
            "description": "命令"
          },
          "cwd": {
            "type": "string",
            "description": "执行目录"
          }
        },
        "required": [
          "command"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "terminal_run",
      "description": "启动一个项目隔离的长终端命令，适合 npm install、npm run dev、python app.py、pytest、构建、下载依赖、启动服务器等需要持续监控的命令。工具会立即返回 sessionId，不等待命令结束；后续用 terminal_status 按分钟查看输出和状态。node --check、py_compile、tsc --noEmit、rg/git status 等有限检查命令会自动降级到隐藏短命令，不创建终端会话。",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string",
            "description": "要执行的命令"
          },
          "cwd": {
            "type": "string",
            "description": "可选，执行目录；默认当前项目目录"
          },
          "session_id": {
            "type": "string",
            "description": "可选，指定终端标签/会话；不传则使用当前项目活跃终端，若没有则自动创建"
          },
          "auto_stop_after_ms": {
            "type": "integer",
            "description": "可选，自动停止时间。适合临时服务验证。"
          }
        },
        "required": [
          "command"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "terminal_status",
      "description": "查看当前项目终端任务状态、输出、运行时间、检测到的 URL 和错误摘要。长任务启动后默认每 1 分钟复查一次输出；不要连续高频调用。",
      "parameters": {
        "type": "object",
        "properties": {
          "session_id": {
            "type": "string",
            "description": "可选，会话 ID；不传则查看当前项目活跃终端"
          },
          "include_output": {
            "type": "boolean",
            "description": "是否返回输出，默认 true"
          },
          "force_refresh": {
            "type": "boolean",
            "description": "仅当用户明确要求立即查看终端时使用；普通等待长命令不要传 true"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "terminal_stop",
      "description": "停止当前项目的终端任务。只会停止当前项目指定或活跃的终端会话，不影响其他项目。",
      "parameters": {
        "type": "object",
        "properties": {
          "session_id": {
            "type": "string",
            "description": "可选，会话 ID；不传则停止当前项目活跃终端"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "tool_self_check",
      "description": "只读检查工具系统是否正常。遇到工具突然缺失、调用失败、明显变慢、参数与说明不一致，或路径、Glob、引号处理异常时使用；不要先靠猜测修改业务代码。检查工具注册表、内置 rg 和可选的真实工具网关冒烟调用。",
      "parameters": {
        "type": "object",
        "properties": {
          "deep": {
            "type": "boolean",
            "description": "是否通过真实工具网关额外执行只读 list_files 和 glob_files 冒烟检查。"
          },
          "include_registry": {
            "type": "boolean",
            "description": "是否在摘要之外返回完整工具注册表快照。"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "create_skill_draft",
      "description": "Create an auditable reusable skill draft. Default scope is global/shared so the skill can be reused across projects; use scope=project only for lessons that are strictly tied to the current project. This only writes a draft; it does not install or enable it.",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Stable lowercase skill name, such as project-history-rendering-fix." },
          "title": { "type": "string", "description": "Human readable skill title." },
          "description": { "type": "string", "description": "Short summary of when this skill should be used." },
          "content": { "type": "string", "description": "Complete SKILL.md body or full markdown. Include trigger conditions, steps, validation, and pitfalls." },
          "scope": { "type": "string", "enum": ["global", "project"], "description": "Where to save the draft. Default global means shared across projects. Project means current-project-only." },
          "tags": { "type": "array", "items": { "type": "string" } },
          "source_summary": { "type": "string", "description": "Brief explanation of which task or lesson produced this draft." },
          "related_files": { "type": "array", "items": { "type": "string" }, "description": "Project-relative files that informed this skill." }
        },
        "required": ["title", "content"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "install_skill_draft",
      "description": "Install a reusable skill draft into the global shared skill library by default, or into the current project when scope=project.",
      "parameters": {
        "type": "object",
        "properties": {
          "draft_id": { "type": "string", "description": "Draft id returned by create_skill_draft or listed by list_skill_drafts." },
          "path": { "type": "string", "description": "Optional path to a draft SKILL.md." },
          "name": { "type": "string", "description": "Optional installed skill name override." },
          "scope": { "type": "string", "enum": ["global", "project"], "description": "Install target. Default global means shared across projects." },
          "draft_scope": { "type": "string", "enum": ["global", "project"], "description": "Where the draft currently lives. Defaults to the install target." }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "list_skill_drafts",
      "description": "List reusable skill drafts. Returns globalDrafts and projectDrafts; global drafts are shared across projects.",
      "parameters": {
        "type": "object",
        "properties": {
          "scope": { "type": "string", "enum": ["global", "project"], "description": "Optional filter for the drafts field." }
        },
        "required": []
      }
    }
  }
]
