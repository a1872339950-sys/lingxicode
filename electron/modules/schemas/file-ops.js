/**
 * 工具 Schema - file-ops 类别 (17 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "读取文本文件内容。用于验证搜索得到的事实命中文件和行段；大文件必须按 start_line/end_line 或 max_chars 小段读取，不要反复整文件翻找。读取 png/jpg/webp/ico 等图片或其他二进制文件时，只返回安全元数据和图片尺寸，不返回原始二进制内容；需要使用图片时请直接引用返回的 path。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "文件路径"
          },
          "start_line": {
            "type": "integer",
            "description": "可选，起始行号。审查大文件时优先按行段读取。"
          },
          "end_line": {
            "type": "integer",
            "description": "可选，结束行号。"
          },
          "max_chars": {
            "type": "integer",
            "description": "可选，最多返回字符数；超出会提示按行号继续读取。"
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
      "name": "create_file_session",
      "description": "创建大文件分片写入会话。适合超过 write_file 128KB 上限的大 HTML/CSS/JS/Python/文本模板。会先创建临时缓冲区，不直接覆盖目标文件；完成后必须调用 finish_file_session 原子替换并校验。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "最终要写入的文件路径"
          },
          "allow_full_rewrite": {
            "type": "boolean",
            "description": "可选。仅当确实要完整重生成已有大型源码文件时传 true；普通修改不要使用。"
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
      "name": "append_file_chunk",
      "description": "向 create_file_session 创建的会话追加一个文本分片。可多次调用，工具会累计 bytes_received 和 chunks；不要把分片直接写目标文件。",
      "parameters": {
        "type": "object",
        "properties": {
          "session_id": {
            "type": "string",
            "description": "create_file_session 返回的 session_id"
          },
          "content_chunk": {
            "type": "string",
            "description": "本次追加的文本分片"
          }
        },
        "required": [
          "session_id",
          "content_chunk"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "finish_file_session",
      "description": "完成分片写入会话。工具会校验 expected_bytes / expected_sha256，校验通过后原子替换目标文件，并返回 bytes_written/bytesWritten、expected_bytes/expectedBytes、sha256、expected_sha256/expectedSha256、preview_start/previewStart、preview_end/previewEnd 和 postEditDiagnostics。校验失败时不替换目标文件。",
      "parameters": {
        "type": "object",
        "properties": {
          "session_id": {
            "type": "string",
            "description": "create_file_session 返回的 session_id"
          },
          "expected_bytes": {
            "type": "integer",
            "description": "可选。完整内容按 UTF-8 编码后的预期字节数。"
          },
          "expected_sha256": {
            "type": "string",
            "description": "可选。完整内容的 sha256，用于强校验。"
          }
        },
        "required": [
          "session_id"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_many_files",
      "description": "Codex 风格批量读取工具。用于一次读取多个事实命中文件或多个小行段，减少反复工具调用。适合搜索、glob_files 或 shell_run 只读补查返回多个路径后批量验证；也适合统一文案、命名迁移、同类字段/API/状态调整前，一次读齐目标文件并划清要改/不改边界。每项仍遵守 read_file 的安全规则。最多 20 个文件，大文件必须给 start_line/end_line 或 max_chars。",
      "parameters": {
        "type": "object",
        "properties": {
          "files": {
            "type": "array",
            "description": "要读取的文件列表。每项包含 path，可选 start_line/end_line/max_chars。",
            "items": {
              "type": "object",
              "properties": {
                "path": {
                  "type": "string"
                },
                "start_line": {
                  "type": "integer"
                },
                "end_line": {
                  "type": "integer"
                },
                "max_chars": {
                  "type": "integer"
                }
              },
              "required": [
                "path"
              ]
            }
          },
          "max_chars_per_file": {
            "type": "integer",
            "description": "可选，每个文件默认最大字符数；单项 max_chars 优先。"
          }
        },
        "required": [
          "files"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "find_in_file",
      "description": "Codex 风格单文件查找工具。用于在一个已知文件内查找关键词或正则，返回行号和上下文片段；比跨项目定位更轻，适合已定位到文件后继续找局部内容。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "要查找的文件路径"
          },
          "pattern": {
            "type": "string",
            "description": "要查找的文本或正则模式"
          },
          "regex": {
            "type": "boolean",
            "description": "pattern 是否按正则解释，默认 false"
          },
          "case_sensitive": {
            "type": "boolean",
            "description": "是否区分大小写，默认 false"
          },
          "context_lines": {
            "type": "integer",
            "description": "每条命中前后返回多少行上下文，默认 0，最大 8"
          },
          "max_results": {
            "type": "integer",
            "description": "最多返回多少条命中，默认 30，最大 100"
          }
        },
        "required": [
          "path",
          "pattern"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "write_file",
      "description": "写入文件。写入前有 128KB 硬限制，超过会返回 CONTENT_TOO_LARGE_USE_CHUNKED_WRITE，请改用 create_file_session / append_file_chunk / finish_file_session。写入使用原子替换并返回 bytes_written/bytesWritten、expected_bytes/expectedBytes、sha256、expected_sha256/expectedSha256、preview_start/previewStart、preview_end/previewEnd；如果 requires_fix 为 true，必须先修复诊断问题。普通修改优先 text_edit/apply_patch。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "文件路径"
          },
          "content": {
            "type": "string",
            "description": "文件内容"
          },
          "allow_full_rewrite": {
            "type": "boolean",
            "description": "可选。仅当确实要完整重生成已有大型源码文件时传 true；普通修改不要使用，优先 text_edit/apply_patch"
          }
        },
        "required": [
          "path",
          "content"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "edit_file",
      "description": "编辑文件。替换文件中的指定内容。适合单点精确替换或一处小修；同一任务涉及多文件、多段、统一文案/命名/字段/API/状态调整时，先盘点事实命中并优先用 apply_patch 合并修改，避免多轮 edit_file + grep 循环。编辑后会立刻返回 postEditDiagnostics；如果 requires_fix 为 true，必须先修复诊断问题。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "文件路径"
          },
          "old_content": {
            "type": "string",
            "description": "要替换的内容"
          },
          "new_content": {
            "type": "string",
            "description": "替换后的内容"
          }
        },
        "required": [
          "path",
          "old_content",
          "new_content"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "text_edit",
      "description": "Codex 风格精确文本编辑工具。用于按锚点、正则、行号插入/替换/删除。优先用它做局部修改；当精确字符串因为缩进、换行、不可见字符不匹配时，改用 replace_lines/insert_at_line 或 *_regex，不要退化成 shell/cat -A 或整文件重写。失败结果会返回 candidate_lines，可直接用于行号编辑。写入成功后会立刻返回 postEditDiagnostics；如果 requires_fix 为 true，必须先按 read_hints 修复诊断问题。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "文本文件路径"
          },
          "edits": {
            "type": "array",
            "description": "编辑操作列表，按顺序执行",
            "items": {
              "type": "object",
              "properties": {
                "op": {
                  "type": "string",
                  "enum": [
                    "replace",
                    "replace_all",
                    "insert_before",
                    "insert_after",
                    "delete",
                    "replace_regex",
                    "insert_before_regex",
                    "insert_after_regex",
                    "delete_regex",
                    "replace_lines",
                    "insert_at_line"
                  ],
                  "description": "replace 精确替换一次；replace_all 替换全部；insert_before/insert_after 按锚点插入；delete 删除精确文本；*_regex 按正则操作；replace_lines 按行号替换；insert_at_line 在指定行前插入"
                },
                "old_content": {
                  "type": "string",
                  "description": "replace/replace_all/delete 使用的精确原文"
                },
                "new_content": {
                  "type": "string",
                  "description": "replace/replace_all 使用的新文本"
                },
                "anchor": {
                  "type": "string",
                  "description": "insert_before/insert_after 使用的精确锚点文本"
                },
                "content": {
                  "type": "string",
                  "description": "insert_before/insert_after 插入的文本"
                },
                "pattern": {
                  "type": "string",
                  "description": "replace_regex/insert_before_regex/insert_after_regex/delete_regex 使用的正则表达式"
                },
                "flags": {
                  "type": "string",
                  "description": "可选正则 flags，例如 m、s、i；g 会自动补上"
                },
                "start_line": {
                  "type": "integer",
                  "description": "replace_lines 使用的起始行号"
                },
                "end_line": {
                  "type": "integer",
                  "description": "replace_lines 使用的结束行号"
                },
                "line": {
                  "type": "integer",
                  "description": "insert_at_line 使用的行号，在该行前插入"
                },
                "expected_occurrences": {
                  "type": "integer",
                  "description": "可选。期望命中次数；不匹配时拒绝写入，避免误改"
                }
              },
              "required": [
                "op"
              ]
            }
          }
        },
        "required": [
          "path",
          "edits"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "apply_patch",
      "description": "Codex 风格文本补丁工具。适合一次性新增、删除或修改多个文本文件；尤其适合同类批量改动、统一文案/命名、跨文件入口接线、样式或配置同步。使用前应先通过具体关键词/路径模式搜索和 read_many_files 盘点事实命中范围并划清不该改的注释、文档、测试、日志和备份；确实需要命令级只读补查时再用 shell_run。系统会在写入前创建安全恢复点并记录本轮改动，写入后会立刻返回 postEditDiagnostics。补丁必须包含 *** Begin Patch 和 *** End Patch。不要用它处理图片、音频、视频、压缩包等二进制文件。如果 requires_fix 为 true，必须先按 read_hints 修复诊断问题。注意：patch 适合小到中等补丁；大型整文件生成不要用超长 patch，一次只改相关片段。",
      "parameters": {
        "type": "object",
        "properties": {
          "patch": {
            "type": "string",
            "description": "补丁文本。支持 *** Add File: path、*** Delete File: path、*** Update File: path，以及行前缀空格/+/ - 的上下文补丁。"
          }
        },
        "required": [
          "patch"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "json_edit",
      "description": "Codex 风格 JSON 安全编辑工具。按 JSON 路径设置、删除或追加字段，自动解析和格式化 JSON，写入前创建安全恢复点并记录本轮改动，写入后会立刻返回 postEditDiagnostics。适合 package.json、配置文件、模型列表等结构化 JSON；复杂 JS/JSONC 仍用 apply_patch。如果 requires_fix 为 true，必须先修复诊断问题。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "JSON 文件路径"
          },
          "operations": {
            "type": "array",
            "description": "编辑操作列表，按顺序执行",
            "items": {
              "type": "object",
              "properties": {
                "op": {
                  "type": "string",
                  "enum": [
                    "set",
                    "delete",
                    "append"
                  ],
                  "description": "set 设置字段，delete 删除字段，append 向数组追加值"
                },
                "json_path": {
                  "type": "string",
                  "description": "点号路径，例如 scripts.verify 或 models.0.name。数组下标用数字。"
                },
                "value": {
                  "description": "set/append 使用的值，可为字符串、数字、布尔、对象或数组"
                }
              },
              "required": [
                "op",
                "json_path"
              ]
            }
          },
          "indent": {
            "type": "integer",
            "description": "格式化缩进空格数，默认 2"
          }
        },
        "required": [
          "path",
          "operations"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "create_directory",
      "description": "创建目录",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "文件路径"
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
      "name": "delete_file",
      "description": "删除文件",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "文件路径"
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
      "name": "copy_file",
      "description": "Codex 风格安全复制文件工具。复制单个文件到新路径，写入前创建安全恢复点并记录本轮改动。目录复制、批量复制或复杂重排请先说明计划，不要用 shell_run 绕过安全快照。",
      "parameters": {
        "type": "object",
        "properties": {
          "source": {
            "type": "string",
            "description": "源文件路径"
          },
          "destination": {
            "type": "string",
            "description": "目标文件路径"
          },
          "overwrite": {
            "type": "boolean",
            "description": "目标已存在时是否覆盖，默认 false"
          }
        },
        "required": [
          "source",
          "destination"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "move_file",
      "description": "Codex 风格安全移动/重命名文件工具。移动或重命名单个文件，写入前创建安全恢复点并记录源文件删除和目标文件创建。目录移动或批量移动请先说明计划，不要用 shell_run 绕过安全快照。",
      "parameters": {
        "type": "object",
        "properties": {
          "source": {
            "type": "string",
            "description": "源文件路径"
          },
          "destination": {
            "type": "string",
            "description": "目标文件路径"
          },
          "overwrite": {
            "type": "boolean",
            "description": "目标已存在时是否覆盖，默认 false"
          }
        },
        "required": [
          "source",
          "destination"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "list_files",
      "description": "列出某个已知目录下的文件。仅用于确认目录结构、查看某个已知目录内容或搜索召回不足后的补查；不要把它当成代码定位第一步，也不要逐级遍历整个项目。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "目录路径"
          },
          "pattern": {
            "type": "string",
            "description": "可选文件名/路径通配模式。普通 *.js 匹配当前目录；包含 ** 或路径分隔符时会按目录内递归匹配。"
          },
          "recursive": {
            "type": "boolean",
            "description": "可选，是否递归列出；默认 false，但 pattern 含 ** 或路径分隔符时会自动递归"
          },
          "limit": {
            "type": "integer",
            "description": "可选，最多返回数量，默认 500，最大 1000"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "glob_files",
      "description": "高速文件名/路径匹配（优先 ripgrep --files）。用于按模式找文件，例如 **/*.js、frontend/**/*.css、**/chat-*.js。只匹配路径不搜内容；请尽量限定 path 以加速。",
      "parameters": {
        "type": "object",
        "properties": {
          "pattern": {
            "type": "string",
            "description": "Glob 模式，例如 **/*.js、frontend/**/*.css、**/package.json"
          },
          "path": {
            "type": "string",
            "description": "可选，限定搜索目录；默认项目根目录"
          },
          "limit": {
            "type": "integer",
            "description": "最多返回多少个文件，默认 100，最大 500"
          },
          "include_hidden": {
            "type": "boolean",
            "description": "是否包含隐藏文件/目录，默认 false"
          }
        },
        "required": [
          "pattern"
        ]
      }
    }
  }
]
