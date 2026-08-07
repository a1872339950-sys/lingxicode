const fs = require('fs')
const path = require('path')
const config = require('./config')

const REPORT_DIR_NAME = 'agent-collaboration-temp-reports'
const EVENT_FILE_NAME = 'runtime-events.jsonl'
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PROJECT_SESSION_REPORTS = 50
const eventWriteChains = new Map()

function getReportsDir() {
  const basePath = config.getAppDataPath() || process.cwd()
  return path.join(basePath, REPORT_DIR_NAME)
}

function safeName(value = '') {
  const name = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return name || '协作AI汇报'
}

function getSessionReportsDir(session = {}) {
  const projectPart = safeName(session.projectId || 'global')
  const sessionPart = safeName(session.id || 'session')
  return path.join(getReportsDir(), projectPart, sessionPart)
}

function ensureReportsDir(session = null) {
  const dir = session ? getSessionReportsDir(session) : getReportsDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getAgentReportFilePath(session = {}, agent = {}) {
  const dir = ensureReportsDir(session)
  const fileBase = safeName(agent.name || agent.role || agent.id || '协作AI汇报')
  const agentPart = safeName(agent.id || agent.name || agent.role || 'agent')
  return path.join(dir, `${fileBase}-${agentPart}.md`)
}

function isInsideReportsDir(filePath = '') {
  try {
    const dir = path.resolve(getReportsDir())
    const target = path.resolve(String(filePath || ''))
    const relative = path.relative(dir, target)
    return !!target && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  } catch {
    return false
  }
}

function buildReportMarkdown(report = {}, agent = {}, session = {}) {
  const reportContent = String(report.content || '').trim()
  const hasEffectiveReport = reportContent && !/协作 AI 未返回正文报告|未返回正文报告/.test(reportContent)
  const lines = []
  lines.push(`# ${safeName(agent.name || agent.role || report.name || report.role || report.agentId)}`)
  lines.push('')
  lines.push(`- 会话ID：${session.id || ''}`)
  lines.push(`- AI：${agent.name || report.name || ''}`)
  lines.push(`- 角色：${agent.role || report.role || ''}`)
  lines.push(`- 状态：${report.status || agent.status || 'done'}`)
  lines.push(`- 任务：${agent.task || report.task || ''}`)
  lines.push(`- 完成时间：${new Date(report.completedAt || Date.now()).toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('## 汇报内容')
  lines.push('')
  lines.push(hasEffectiveReport ? reportContent : '协作 AI 未形成有效结构化汇报。请查看右侧会话过程，或让主窗口 AI 接手复核。')

  if (report.error) {
    lines.push('')
    lines.push('## 错误信息')
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(report.error, null, 2))
    lines.push('```')
  }

  return lines.join('\n')
}

function writeAgentReport(session = {}, agent = {}, report = {}) {
  if (report.reportFilePath && isInsideReportsDir(report.reportFilePath) && fs.existsSync(report.reportFilePath)) {
    return {
      fileName: path.basename(report.reportFilePath),
      filePath: report.reportFilePath,
      contentLength: fs.statSync(report.reportFilePath).size
    }
  }
  const dir = ensureReportsDir(session)
  const fileBase = safeName(agent.name || agent.role || report.name || report.role || report.agentId)
  const fileName = `${fileBase}-${Date.now().toString(36)}.md`
  const filePath = path.join(dir, fileName)
  const content = buildReportMarkdown(report, agent, session)
  fs.writeFileSync(filePath, content, 'utf-8')
  return { fileName, filePath, contentLength: content.length }
}

function appendRuntimeEvent(session = {}, agentId = '', event = {}) {
  const filePath = path.join(ensureReportsDir(session), EVENT_FILE_NAME)
  let record = {
    ...event,
    agentId: String(agentId || event.agentId || ''),
    sessionId: String(session.id || ''),
    projectId: String(session.projectId || ''),
    recordedAt: Date.now()
  }
  let payload
  try {
    payload = JSON.stringify(record)
  } catch {
    record = {
      type: String(event.type || 'event'),
      title: String(event.title || ''),
      content: String(event.content || event.message || ''),
      agentId: record.agentId,
      sessionId: record.sessionId,
      projectId: record.projectId,
      recordedAt: record.recordedAt,
      serializationFailed: true
    }
    payload = JSON.stringify(record)
  }
  if (Buffer.byteLength(payload, 'utf8') > 262144) {
    record = {
      type: record.type || 'event',
      title: record.title || '',
      content: String(record.content || '').slice(0, 120000),
      agentId: record.agentId,
      sessionId: record.sessionId,
      projectId: record.projectId,
      recordedAt: record.recordedAt,
      truncated: true
    }
    payload = JSON.stringify(record)
  }
  const previous = eventWriteChains.get(filePath) || Promise.resolve()
  const current = previous.catch(() => {}).then(() => fs.promises.appendFile(filePath, `${payload}\n`, 'utf8'))
  eventWriteChains.set(filePath, current)
  current.finally(() => {
    if (eventWriteChains.get(filePath) === current) eventWriteChains.delete(filePath)
  }).catch(() => {})
  return current
}

function cleanupExpiredReports(projectId = null, options = {}) {
  const root = projectId ? path.join(getReportsDir(), safeName(projectId)) : getReportsDir()
  if (!fs.existsSync(root)) return { success: true, deleted: 0 }
  const maxAgeMs = Math.max(60 * 1000, Number(options.maxAgeMs) || EVENT_RETENTION_MS)
  const maxSessions = Math.max(1, Number(options.maxSessions) || MAX_PROJECT_SESSION_REPORTS)
  const now = Date.now()
  let deleted = 0
  const projectDirs = projectId
    ? [root]
    : fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name))
  for (const projectDir of projectDirs) {
    const sessionDirs = fs.existsSync(projectDir)
      ? fs.readdirSync(projectDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
          const target = path.join(projectDir, entry.name)
          return { target, mtimeMs: fs.statSync(target).mtimeMs }
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
      : []
    sessionDirs.forEach((item, index) => {
      if (now - item.mtimeMs <= maxAgeMs && index < maxSessions) return
      fs.rmSync(item.target, { recursive: true, force: true })
      deleted++
    })
  }
  return { success: true, deleted }
}

function readReport(filePath = '') {
  const dir = path.resolve(getReportsDir())
  const target = path.resolve(String(filePath || ''))
  const relative = path.relative(dir, target)
  if (!target || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { success: false, error: '无效的协作 AI 汇报路径' }
  }
  if (!fs.existsSync(target)) {
    return { success: false, error: '协作 AI 汇报文件不存在或已清理' }
  }
  return {
    success: true,
    fileName: path.basename(target),
    filePath: target,
    content: fs.readFileSync(target, 'utf-8')
  }
}

function readProjectReports(projectId = '') {
  const dir = path.join(getReportsDir(), safeName(projectId || 'global'))
  if (!fs.existsSync(dir)) {
    return { success: false, error: '当前项目没有可用的协作 AI 临时汇报' }
  }
  const reports = []
  const walk = currentDir => {
    for (const item of fs.readdirSync(currentDir)) {
      const target = path.join(currentDir, item)
      try {
        const stat = fs.statSync(target)
        if (stat.isDirectory()) {
          walk(target)
        } else if (stat.isFile() && /\.md$/i.test(item)) {
          reports.push({
            fileName: item,
            filePath: target,
            content: fs.readFileSync(target, 'utf-8')
          })
        }
      } catch { /* 文件读取失败 */ }
    }
  }
  walk(dir)
  reports.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'))
  return { success: true, projectId, reports }
}

function cleanupReports(projectId = null) {
  const dir = getReportsDir()
  if (!fs.existsSync(dir)) return { success: true, deleted: 0 }
  if (projectId) {
    const projectDir = path.join(dir, safeName(projectId))
    if (!fs.existsSync(projectDir)) return { success: true, deleted: 0, projectId }
    fs.rmSync(projectDir, { recursive: true, force: true })
    return { success: true, deleted: 1, projectId }
  }
  let deleted = 0
  for (const item of fs.readdirSync(dir)) {
    const target = path.join(dir, item)
    try {
      fs.rmSync(target, { recursive: true, force: true })
      deleted += 1
    } catch { /* 清理报告目录失败 */ }
  }
  return { success: true, deleted, projectId }
}

function registerIPC(ipcMain) {
  ipcMain.handle('agent-collaboration-report:read', async (event, filePath) => readReport(filePath))
  ipcMain.handle('agent-collaboration-report:read-project', async (event, projectId) => readProjectReports(projectId))
  ipcMain.handle('agent-collaboration-report:cleanup', async (event, projectId = null) => cleanupReports(projectId))
}

module.exports = {
  getReportsDir,
  getSessionReportsDir,
  ensureReportsDir,
  getAgentReportFilePath,
  isInsideReportsDir,
  writeAgentReport,
  appendRuntimeEvent,
  readReport,
  readProjectReports,
  cleanupReports,
  cleanupExpiredReports,
  registerIPC
}
