/**
 * Office Python 桥
 * 从 tools.js 提取，负责查找 Python 解释器并通过子进程执行 PPT/Excel 控制脚本
 *
 * 依赖：child_process.spawn、path、excel-control 模块
 */

const path = require('path')
const { spawn } = require('child_process')

// PPT / Excel / Word Python 脚本路径
const PPT_SCRIPT = path.join(__dirname, '../python/ppt_control.py')
const EXCEL_SCRIPT = path.join(__dirname, '../python/excel_control.py')
const DOCX_SCRIPT = path.join(__dirname, '../python/docx_control.py')

// Python 解释器路径（缓存）
let cachedPython = null

/**
 * 查找 Python 解释器
 */
function findPython() {
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

  for (const pythonPath of PYTHON_PATHS) {
    try {
      const result = spawn(pythonPath, ['--version'], { timeout: 5000 })
      if (result.pid) {
        console.log('[Office] 找到 Python:', pythonPath)
        return pythonPath
      }
    } catch (e) {
      continue
    }
  }
  return null
}

function ensurePython() {
  if (!cachedPython) {
    cachedPython = findPython()
  }
  return cachedPython
}

/**
 * 执行 PPT Python 命令
 */
async function executePPTCommand(action, args) {
  return new Promise((resolve) => {
    const python = ensurePython()
    if (!python) {
      resolve({ success: false, error: '未找到 Python 解释器' })
      return
    }

    const commandJson = JSON.stringify({ action, args })
    const proc = spawn(python, [PPT_SCRIPT, commandJson], { timeout: 60000 })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        console.log('[PPT] Python 错误:', stderr)
        resolve({ success: false, error: stderr || 'Python 执行失败' })
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (e) {
        console.log('[PPT] JSON 解析失败:', stdout)
        resolve({ success: false, error: '结果解析失败' })
      }
    })

    proc.on('error', (err) => {
      console.log('[PPT] 进程错误:', err)
      resolve({ success: false, error: err.message })
    })
  })
}

/**
 * 执行 Excel Python 命令
 */
async function executeExcelCommand(action, args) {
  return new Promise((resolve) => {
    const python = ensurePython()
    if (!python) {
      resolve({ success: false, error: '未找到 Python 解释器' })
      return
    }

    const commandJson = JSON.stringify({ action, args })
    const proc = spawn(python, [EXCEL_SCRIPT, commandJson], { timeout: 60000 })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        console.log('[Excel] Python 错误:', stderr)
        resolve({ success: false, error: stderr || 'Python 执行失败' })
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (e) {
        console.log('[Excel] JSON 解析失败:', stdout)
        resolve({ success: false, error: '结果解析失败' })
      }
    })

    proc.on('error', (err) => {
      console.log('[Excel] 进程错误:', err)
      resolve({ success: false, error: err.message })
    })
  })
}

/**
 * 执行 Word (docx) Python 命令
 */
async function executeDocxCommand(action, args) {
  return new Promise((resolve) => {
    const python = ensurePython()
    if (!python) {
      resolve({ success: false, error: '未找到 Python 解释器' })
      return
    }

    const commandJson = JSON.stringify({ action, args })
    const proc = spawn(python, [DOCX_SCRIPT, commandJson], { timeout: 60000 })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        console.log('[Docx] Python 错误:', stderr)
        resolve({ success: false, error: stderr || 'Python 执行失败' })
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (e) {
        console.log('[Docx] JSON 解析失败:', stdout)
        resolve({ success: false, error: '结果解析失败' })
      }
    })

    proc.on('error', (err) => {
      console.log('[Docx] 进程错误:', err)
      resolve({ success: false, error: err.message })
    })
  })
}

module.exports = {
  findPython,
  ensurePython,
  executePPTCommand,
  executeExcelCommand,
  executeDocxCommand
}
