/**
 * 工具 Schema - software 类别 (2 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "find_software",
      "description": "统一查找本地软件入口。用户要求打开某个新安装的软件、工具、编辑器、浏览器、建模软件时，先用这个工具按名称或路径查找；它会查 PATH、Windows 注册表卸载项、开始菜单和常见安装目录。只查找，不启动软件。",
      "parameters": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "软件名称，例如 Blender、Chrome、VS Code、Photoshop"
          },
          "path": {
            "type": "string",
            "description": "可选，用户已知的 exe/bat/cmd/lnk 路径"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "open_software",
      "description": "统一打开本地软件。用户要求“打开某软件/启动某工具”时使用；后端会先按名称或路径查找软件，然后启动可视化窗口。打开项目外应用前会走 AI 授权弹窗；用户选择后续允许后，同一应用不再询问。",
      "parameters": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "软件名称，例如 Blender、Chrome、VS Code、Photoshop"
          },
          "path": {
            "type": "string",
            "description": "可选，用户已知的 exe/bat/cmd/lnk 路径；有路径时优先使用路径"
          },
          "args": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "可选，传给软件的启动参数"
          },
          "cwd": {
            "type": "string",
            "description": "可选，启动工作目录"
          },
          "visible": {
            "type": "boolean",
            "description": "是否可视化打开窗口，默认 true"
          }
        },
        "required": []
      }
    }
  }
]
