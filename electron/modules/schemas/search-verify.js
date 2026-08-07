/**
 * 工具 Schema - search-verify 类别
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "locate_code",
      "description": "事实型代码定位工具。它不解释自然语言、不推荐候选文件、不决定实现路径；只根据模型提供的具体关键词、DOM id、函数名、错误文本、文件名或路径片段返回字面命中和路径证据。返回路径只是 evidenceFiles，不是修改建议。模型必须自行核对源码、import/link/script 加载关系、调用链和运行事实后再判断。",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "用户原始需求、错误信息、UI 文案、函数名、DOM id、文件名或路径。可以混合中文和英文关键词。"
          },
          "terms": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "可选，模型已经提炼好的具体事实搜索词，例如 DOM id、函数名、按钮文案、错误文本、文件名或路径片段。工具只按这些词搜索，不做自然语言理解。"
          },
          "limit": {
            "type": "integer",
            "description": "最多返回多少个证据文件，默认 12，最大 24"
          }
        },
        "required": [
          "query"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "search_project",
      "description": "底层事实搜索工具。用于按模型提供的具体关键词、按钮文案、DOM id、API/IPC、函数名、错误文本、文件名或路径片段并行搜索。它只返回命中片段和来源证据，不做自然语言理解，不推荐修改文件。宽泛排查和冷启动修复不要先从 app/main/index 这类大文件整文件翻找。",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "用户需求、错误信息、功能描述、文件名、函数名、DOM id 或关键词"
          },
          "limit": {
            "type": "integer",
            "description": "最多返回多少条事实命中，默认由系统控制"
          }
        },
        "required": [
          "query"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "grep_code",
      "description": "高速代码内容搜索（内置 ripgrep）。用于具体关键词/函数名/DOM id/错误文本等字面命中；不做自然语言理解。默认固定字符串匹配（快）；仅当 regex=true 才按正则。多关键词一次传 patterns（单次 rg 多 -e）。请尽量限定 path，避免宽泛词扫全库。不要为同一定位连续多次单词调用。",
      "parameters": {
        "type": "object",
        "properties": {
          "pattern": {
            "type": "string",
            "description": "单个搜索词。多个相关词请用 patterns。"
          },
          "patterns": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "多个搜索词（最多 10），一次调用内合并搜索。"
          },
          "path": {
            "type": "string",
            "description": "强烈建议：限定目录或文件，缩小范围显著更快。"
          },
          "file_type": {
            "type": "string",
            "description": "可选，限定类型：js、ts、html、css、py 等"
          },
          "case_sensitive": {
            "type": "boolean",
            "description": "是否区分大小写，默认 false"
          },
          "regex": {
            "type": "boolean",
            "description": "是否按正则解释 pattern。默认 false（固定字符串，更快更稳）。"
          },
          "context_lines": {
            "type": "integer",
            "description": "匹配行上下文行数，默认 0，最大 5"
          },
          "max_results": {
            "type": "integer",
            "description": "最多返回条数，默认 25，最大 100"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "find_references",
      "description": "查找函数、变量、类或 IPC 通道在项目中的所有引用/使用位置。利用代码地图的符号索引加速定位，并用实时搜索验证。修改符号前必须先用此工具确认影响范围。",
      "parameters": {
        "type": "object",
        "properties": {
          "symbol": {
            "type": "string",
            "description": "要查找引用的符号名（函数名、类名、变量名、IPC 通道名等）"
          },
          "include_definitions": {
            "type": "boolean",
            "description": "是否同时返回定义位置，默认 true"
          }
        },
        "required": [
          "symbol"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "inspect_runtime_errors",
      "description": "Inspect recent real runtime diagnostics captured from Electron BrowserWindow/WebContents console messages, page load failures, render-process crashes, unresponsive windows, preload errors, main-process console.error/console.warn, uncaughtException and unhandledRejection. Use this for UI click-no-response, dropdown/modal invisible, F12 red errors, backend log errors, or after frontend/Electron edits. This is evidence, not a hard gate.",
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "integer",
            "description": "Maximum events to return, default 40, max 200."
          },
          "since_ms": {
            "type": "integer",
            "description": "Only return events newer than this many milliseconds."
          },
          "include_info": {
            "type": "boolean",
            "description": "Also include info/debug logs. Default false."
          },
          "url_contains": {
            "type": "string",
            "description": "Optional URL substring filter."
          },
          "severities": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Optional severities filter, for example error or warning."
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "check_syntax",
      "description": "验证单个文件的语法正确性。支持 JS/TS（node --check）、HTML（标签闭合检查）、CSS（括号平衡）、JSON（解析验证）。修改文件后建议调用此工具确认语法无误。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "要检查的文件路径"
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
      "name": "dev_workflow",
      "description": "通用开发诊断集成工具。把项目语法扫描、改后综合验证、修复质量审查和宽泛健康检查收束成一个入口。它不自动修改文件；diagnostic_navigation 只是事实证据包，不是候选指令；next_action 是兼容旧调用的提示字段，不是命令。模型必须读取源码、比较反证并自行判断后，才使用 text_edit/apply_patch/edit_file 做最小改动。",
      "parameters": {
        "type": "object",
        "properties": {
          "mode": {
            "type": "string",
            "enum": [
              "health",
              "triage",
              "locate",
              "syntax",
              "verify",
              "review"
            ],
            "description": "工作流模式。宽泛/陌生项目/试验场/运行时/UI/CSS-DOM/IPC/路径污染/状态同步等综合排查优先用 health；triage 是兼容入口，也会附带 project_health_scan，不应只停在语法和逻辑审查。语法/编译错误用 syntax，修改后复查用 verify，指定文件修复质量审查用 review。"
          },
          "query": {
            "type": "string",
            "description": "用户需求、错误信息、功能描述、按钮/文案/DOM/API/函数名等定位线索。locate/triage/health 推荐传，便于同时返回定位证据和综合健康扫描证据。"
          },
          "files": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "mode=verify 时可选，指定要验证的文件；不传则验证当前改动会话。"
          },
          "roots": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "mode=syntax 时可选，限定扫描目录。通常不要传。"
          },
          "max_failures": {
            "type": "integer",
            "description": "mode=syntax/triage max failed files to return."
          },
          "project_path": {
            "type": "string",
            "description": "Optional absolute target project path. Use when the user explicitly names a directory."
          },
          "root_path": {
            "type": "string",
            "description": "Alias of project_path."
          },
          "runtime_probe": {
            "type": "boolean",
            "description": "mode=health: run a bounded runtime probe and merge stdout/stderr errors into findings."
          },
          "launch_if_needed": {
            "type": "boolean",
            "description": "Runtime probe safety switch. Only starts a process when true."
          },
          "runtime_command": {
            "type": "string",
            "description": "Explicit runtime probe command, for example npm run dev, python app.py, cargo run, go run ./cmd/server."
          },
          "npm_script": {
            "type": "string",
            "description": "NPM script name for runtime_probe, for example start, dev, health:probe."
          },
          "runtime_timeout_ms": {
            "type": "integer",
            "description": "Runtime probe timeout in milliseconds. The probe stops only its own child process."
          },
          "runtime_limit": {
            "type": "integer",
            "description": "Maximum runtime/F12/main-process diagnostic events to include."
          },
          "runtime_closure": {
            "type": "boolean",
            "description": "mode=health: open runtime_url/html_path or a URL inferred from runtime_probe output, then collect browser console/page/resource errors."
          },
          "runtime_url": {
            "type": "string",
            "description": "mode=health runtime closure URL, for example http://127.0.0.1:5173."
          },
          "html_path": {
            "type": "string",
            "description": "mode=health runtime closure local HTML file to load in a hidden browser."
          },
          "ui_checks": {
            "type": "array",
            "description": "Optional real UI click lifecycle checks for runtime_closure. Each item can include click_selector, expected_visible_selector, close_selector, repeat_open, inspect_selectors.",
            "items": {
              "type": "object"
            }
          },
          "top_limit": {
            "type": "integer",
            "description": "Maximum top health findings to return. health/triage also writes a temporary evidence bundle with manifest.md and classified documents when findings are long; read manifest_path first before making final claims."
          },
          "include_ipc": {
            "type": "boolean",
            "description": "Set false to skip IPC/bridge contract checks. Default true."
          }
        },
        "required": [
          "mode"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "check_project_syntax",
      "description": "项目级语法扫描工具。用户说项目有语法错误、编译错误、启动前先查语法、或需要全面修复语法问题时优先调用本工具，不要自己创建临时 Node/Python/PowerShell 扫描脚本。工具会扫描 electron/frontend/scripts 等生产源码目录，自动跳过 node_modules、temp、dist、build、codemap、.git、.lingua、change-sessions 等噪声目录，并返回 failed_files、code_frames、repair_hints 与 read_hints。code_frames/repair_hints 已包含错误行和可能未闭合块线索，优先直接批量最小修复；只有上下文不足时每个失败文件最多按 read_hints 读取一次，禁止反复读同一文件相邻片段。修复 failed_files 后再次调用本工具验证通过。",
      "parameters": {
        "type": "object",
        "properties": {
          "roots": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "可选。要扫描的项目相对目录，默认 electron/frontend/scripts。通常不要传，除非用户明确限定目录。"
          },
          "max_failures": {
            "type": "integer",
            "description": "最多返回多少个失败文件，默认 12，最大 50。"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "git_diff",
      "description": "Codex 风格 Git 差异查看工具。只读取差异，不修改仓库。用于查看本轮未提交改动、暂存区改动或单个文件 diff；大 diff 会截断，必要时传 path 查看单文件。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "可选，只查看某个文件的 diff"
          },
          "staged": {
            "type": "boolean",
            "description": "是否查看暂存区 diff，默认 false"
          },
          "stat": {
            "type": "boolean",
            "description": "是否只返回统计摘要，默认 false"
          },
          "max_chars": {
            "type": "integer",
            "description": "最多返回字符数，默认 12000，最大 50000"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "post_change_verify",
      "description": "改动完成后的静态综合验证。检查语法、导入、跨文件 API、遗留引用与 IPC。一轮修改结束后调用；前端/点击状态类改动不能把静态通过当成运行通过，应继续调用统一 runtime_verify 检查已绑定开发运行实例，由工具自动选择实时检查或语义交互链。",
      "parameters": {
        "type": "object",
        "properties": {
          "files": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "可选，指定要验证的文件路径列表。不传则自动验证本轮 change-session 中所有被改文件。"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "recall_history",
      "description": "查询当前项目的历史记忆。当用户提到继续、刚才、之前、上次、那个问题、原来的方案，或当前上下文提示旧对话已被压缩时，必须先调用本工具，不要凭印象猜。\n\n支持三种查询模式，按优先级使用：\n1. 关键词查询（query）：搜功能/文件名/错误信息/决策。\n2. 时间序查询（order）：用户说\"最早的/最开始的/第一句/最近几次\"等元描述词时，不要用 query 猜关键词，改用 order='asc' 拿最老的，order='desc' 拿最新的。\n3. 轮次直取（turn）：用户说\"第 N 轮/第 N 句\"时，直接用 turn=N 精确取。\n\n当用户用元描述词（第一句、最开始、最早、最近、上一轮等）时，query 往往 0 命中——此时必须改用 order 或 turn 参数，而不是反复换关键词。",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "查询关键词。应包含用户提到的功能、文件名、错误信息、决策或任务名称。若用 order 或 turn 参数，query 可省略。"
          },
          "order": {
            "type": "string",
            "enum": ["asc", "desc"],
            "description": "按时间序直接检索，不依赖关键词。asc=从最老开始（用户说\"最早的/最开始的/第一句\"时用），desc=从最新开始（用户说\"最近几次/上次\"时用）。与 query 互斥，优先级高于 query。"
          },
          "turn": {
            "type": "integer",
            "description": "直接取指定轮次（turn ID）。用户说\"第 N 轮/第 N 句\"时用。与 query、order 互斥，优先级最高。"
          },
          "time_range": {
            "type": "object",
            "description": "按时间戳范围检索（毫秒）。与 query/order/turn 互斥。",
            "properties": {
              "start": {"type": "number", "description": "起始时间戳（毫秒）"},
              "end": {"type": "number", "description": "结束时间戳（毫秒）"}
            }
          },
          "max_results": {
            "type": "integer",
            "description": "最大返回数量。默认 10。"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_task_ledger_entry",
      "description": "按项目账本编号读取任务档案或方案纪要详情。看到【项目账本索引】里的 task-... 或 discussion-... 编号，且用户要求了解该旧任务/旧方案细节时，优先调用本工具；不要凭索引摘要猜完整内容。",
      "parameters": {
        "type": "object",
        "properties": {
          "entry_id": {
            "type": "string",
            "description": "账本编号，例如 task-20260603054624-xxxx 或 discussion-20260603054150-xxxx"
          }
        },
        "required": [
          "entry_id"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_latest_change_session",
      "description": "读取当前项目最近一次 AI 文件修改记录。用户说刚才改坏了、上一轮有问题、撤回、恢复、回到改之前、刚才那个不要了时，优先调用本工具查看变更记录和 Git 恢复点，不要凭印象猜。",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "rollback_latest_change_session",
      "description": "把当前项目最近一次 AI 文件修改回退到修改前。只在用户明确要求撤回、恢复到 AI 修改前、回到改之前、刚才那个不要了时调用；如果用户只是说出问题，应先读取变更记录并判断是修复还是回退。用户说“只恢复某个文件/页面/CSS/JS”时，传 paths 只回退指定文件。",
      "parameters": {
        "type": "object",
        "properties": {
          "force": {
            "type": "boolean",
            "description": "兼容旧调用的保留字段。即使为 true，也不会覆盖 AI 修改后由用户或外部软件产生的冲突内容。"
          },
          "paths": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "可选。只回退这些文件；支持相对项目路径、绝对路径或明确文件名。为空则回退最近一次 AI 修改的全部文件。"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "trace_call_chain",
      "description": "追踪函数调用链。当已经知道函数或符号名，但不清楚谁调用它、它又调用了谁、修改会影响哪些入口，或事件/IPC/API 存在多层包装时使用。支持 callers、callees 双向递归，最多 5 层并自动检测环。结果是 rg 文本搜索与 AST 结构定位形成的事实线索，不是完整语义分析；复杂动态调用仍需读取源码核对。",
      "parameters": {
        "type": "object",
        "properties": {
          "symbol": {
            "type": "string",
            "description": "要追踪的函数名或符号名"
          },
          "direction": {
            "type": "string",
            "enum": ["callers", "callees", "both"],
            "description": "追踪方向：callers=找谁调了这个函数，callees=找这个函数调用了谁，both=双向。默认 callers"
          },
          "depth": {
            "type": "integer",
            "description": "递归深度，默认 3，最大 5"
          }
        },
        "required": ["symbol"]
      }
    }
  }
]
