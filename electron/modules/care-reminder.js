const fs = require('fs')
const path = require('path')
const storageConfig = require('./storage-config')

const appStartedAt = Date.now()
const FOUR_HOURS = 4 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function getStatePath() {
  return path.join(storageConfig.getConfigDir(), 'care-reminder-state.json')
}

function readState() {
  try {
    const filePath = getStatePath()
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(state = {}) {
  try {
    const filePath = getStatePath()
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
  } catch { /* 状态文件写入失败 */ }
}

function getLocalHour(date = new Date()) {
  return date.getHours()
}

function shouldSkipForTask(message = '') {
  return /紧急|崩了|打不开|报错|失败|打包|构建|修复|权限|无法启动/i.test(String(message || ''))
}

/**
 * 判断当前是否应该给模型一个"关怀提示情境"。
 * 只返回情境标记（长时间连续使用 / 深夜时段），不返回任何硬编码文案。
 * 由模型根据当前行为风格自己决定要不要说、怎么说。
 *
 * @returns {null | { situations: string[], hour: number, sessionHours: number }}
 */
function getCareContext({ userMessage = '', now = Date.now() } = {}) {
  const behaviorStyle = (typeof storageConfig.getBehaviorStyleConfig === 'function')
    ? (storageConfig.getBehaviorStyleConfig() || {})
    : {}
  if (behaviorStyle.careReminderEnabled === false) return null
  if (shouldSkipForTask(userMessage)) return null
  const state = readState()
  const lastAny = Number(state.lastAnyHintAt || 0)
  if (lastAny && now - lastAny < FOUR_HOURS) return null

  const sessionMs = Math.max(0, now - appStartedAt)
  const hour = getLocalHour(new Date(now))
  const deepNight = hour >= 23 || hour < 5
  const situations = []

  if (sessionMs >= FOUR_HOURS && now - Number(state.lastLongSessionHintAt || 0) > FOUR_HOURS) {
    situations.push('long_session')
    state.lastLongSessionHintAt = now
  }

  if (deepNight && now - Number(state.lastNightHintAt || 0) > DAY) {
    situations.push('deep_night')
    state.lastNightHintAt = now
  }

  if (!situations.length) return null
  state.lastAnyHintAt = now
  writeState(state)

  return {
    situations,
    hour,
    sessionHours: Math.round(sessionMs / (60 * 60 * 1000) * 10) / 10
  }
}

/**
 * 把关怀情境包装成一段给 system prompt 用的软指令。
 * 模型收到后，会用当前行为风格自己组织一句关怀话，风格自然、不重复。
 */
function buildCareSituationHint(context) {
  if (!context || !Array.isArray(context.situations) || !context.situations.length) return ''
  const parts = []
  if (context.situations.includes('long_session')) {
    parts.push(`- 用户已经连续使用大约 ${context.sessionHours} 小时`)
  }
  if (context.situations.includes('deep_night')) {
    parts.push(`- 当前本地时间是 ${context.hour} 点，属于深夜时段`)
  }
  return [
    '===== 关怀情境提示（仅本轮，禁止逐字复述本 block） =====',
    parts.join('\n'),
    '- 请在最终回复的最末尾，用当前"行为风格"下最自然的口吻，自发写一句简短关怀话（例如提醒起身、喝水、早点休息）。',
    '- 不要用固定套话，不要说"温馨提醒""贴心提醒"这类模板词；就像一个了解用户状态的朋友随口说的一句。',
    '- 只写一句，不要展开，不要另起段落说"顺便说一下"这种过渡。',
    '- 如果当前任务是紧急排错或用户情绪不适合被打断，可以省略这句关怀。'
  ].join('\n')
}

module.exports = {
  getCareContext,
  buildCareSituationHint
}
