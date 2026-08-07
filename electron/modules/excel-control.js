/**
 * Excel 控制模块
 * 通过调用 Python 脚本控制本地 Excel 软件
 */

const { spawn } = require('child_process')
const path = require('path')

// Python 脚本路径
const PYTHON_SCRIPT = path.join(__dirname, '../python/excel_control.py')

// Python 解释器路径（尝试多个可能位置）
const PYTHON_PATHS = [
  'python',
  'python3',
  'C:\\Python39\\python.exe',
  'C:\\Python310\\python.exe',
  'C:\\Python311\\python.exe',
  'C:\\Python312\\python.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python39', 'python.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
]

/**
 * 查找可用的 Python 解释器
 */
function findPython() {
  for (const pythonPath of PYTHON_PATHS) {
    try {
      const result = spawn(pythonPath, ['--version'], { timeout: 5000 })
      if (result.pid) {
        console.log('[ExcelControl] 找到 Python:', pythonPath)
        return pythonPath
      }
    } catch (e) {
      continue
    }
  }
  return null
}

// 缓存找到的 Python 路径
let cachedPython = null

/**
 * 执行 Python 命令
 */
function executePythonCommand(action, args) {
  return new Promise((resolve, reject) => {
    // 查找 Python
    if (!cachedPython) {
      cachedPython = findPython()
    }

    if (!cachedPython) {
      resolve({ success: false, error: '未找到 Python 解释器，请安装 Python' })
      return
    }

    // 构建命令 JSON
    const commandJson = JSON.stringify({ action, args })

    // 启动 Python 进程
    const process = spawn(cachedPython, [PYTHON_SCRIPT, commandJson], {
      timeout: 60000  // 60秒超时
    })

    let stdout = ''
    let stderr = ''

    process.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    process.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    process.on('close', (code) => {
      if (code !== 0) {
        console.log('[ExcelControl] Python 错误:', stderr)
        resolve({ success: false, error: stderr || 'Python 执行失败' })
        return
      }

      try {
        const result = JSON.parse(stdout)
        resolve(result)
      } catch (e) {
        console.log('[ExcelControl] JSON 解析失败:', stdout)
        resolve({ success: false, error: '结果解析失败' })
      }
    })

    process.on('error', (err) => {
      console.log('[ExcelControl] 进程错误:', err)
      resolve({ success: false, error: err.message })
    })
  })
}

/**
 * 打开 Excel
 */
async function openExcel(visible = true) {
  return executePythonCommand('open_excel', { visible })
}

/**
 * 加载文件
 */
async function loadFile(filePath) {
  return executePythonCommand('load_file', { file_path: filePath })
}

/**
 * 创建新工作簿
 */
async function createNew() {
  return executePythonCommand('create_new', {})
}

/**
 * 写入单元格
 */
async function writeCell(row, col, value, showMouse = true) {
  return executePythonCommand('write_cell', { row, col, value, show_mouse: showMouse })
}

/**
 * 批量写入区域
 */
async function writeRange(startRow, startCol, data, showMouse = true) {
  return executePythonCommand('write_range', { start_row: startRow, start_col: startCol, data, show_mouse: showMouse })
}

/**
 * 读取区域数据
 */
async function readRange(startRow, startCol, rows, cols) {
  return executePythonCommand('read_range', { start_row: startRow, start_col: startCol, rows, cols })
}

/**
 * 设置样式
 */
async function setStyle(startRow, startCol, rows, cols, style) {
  return executePythonCommand('set_style', { start_row: startRow, start_col: startCol, rows, cols, style })
}

/**
 * 排序列
 */
async function sortColumn(col, order = 'asc') {
  return executePythonCommand('sort_column', { col, order })
}

/**
 * 保存文件
 */
async function saveFile(filePath = null) {
  return executePythonCommand('save_file', { file_path: filePath })
}

/**
 * 关闭 Excel
 */
async function closeExcel() {
  return executePythonCommand('close_excel', {})
}

module.exports = {
  openExcel,
  loadFile,
  createNew,
  writeCell,
  writeRange,
  readRange,
  setStyle,
  sortColumn,
  saveFile,
  closeExcel,
  findPython
}