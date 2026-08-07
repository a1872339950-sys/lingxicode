/**
 * 主动式上下文管理器
 * - 双机制架构：行为摘要 + 完整记忆
 * - 模块化设计：MemorySystem + BehaviorSummary + VisibilityWindow
 * - 项目隔离存储
 */

const fs = require('fs')
const path = require('path')
const { resolveModelContextLimit } = require('../modules/model-context-policy')

// 引入独立模块
const { MemorySystem } = require('./memory-system')
const { BehaviorSummary } = require('./behavior-summary')
const { VisibilityWindow } = require('./visibility-window')
const memoryOrganizer = require('../modules/memory-organizer')

class ContextManager {
  /**
   * @param {string} storagePath 存储目录（在appData下，安全隔离）
   * @param {string} projectPath 用户项目目录（仅用于显示，不在此存储）
   */
  constructor(storagePath, projectPath = '', options = {}) {
    // 存储目录（安全位置）
    this.storagePath = storagePath
    this.projectPath = projectPath  // 用户项目路径（仅显示）

    // ===== 独立模块（双机制核心） =====
    const moduleOptions = options.deferredInit ? { deferredInit: true } : {}
    this.memory = new MemorySystem(storagePath, moduleOptions)           // 完整记忆系统
    this.summary = new BehaviorSummary(storagePath, moduleOptions)       // 行为摘要系统
    this.window = new VisibilityWindow(storagePath, {}, moduleOptions)   // 可见窗口管理

    // 文件路径（兼容旧版本）
    this.tapePath = path.join(this.storagePath, 'tape.json')
    this.indexPath = path.join(this.storagePath, 'index.json')
    this.memoryPath = path.join(this.storagePath, 'memory.md')
    this.projectInfoPath = path.join(this.storagePath, 'project.json')

    // 内存缓存（兼容层，后续可移除）
    this.tape = []           // 完整历史（已由 memory 模块管理）
    this.index = {}          // 关键词索引（已由 memory 模块管理）

    // 配置（双机制版本）
    this.config = {
      // 现有配置保留
      maxContextRatio: 0.8,

      // 记忆查询配置
      memoryQueryMaxResults: 10  // 记忆查询最大返回数
    }

    // 初始化
    if (!options.deferredInit) {
      this._init()
    }
    this._loaded = !options.deferredInit
  }

  /**
   * 异步懒加载：用于 deferredInit 模式，确保所有子模块数据已加载
   */
  async ensureLoaded() {
    if (this._loaded) return
    this._loaded = true
    // 创建存储目录
    await fs.promises.mkdir(this.storagePath, { recursive: true }).catch(() => {})
    // 保存项目信息
    this._saveProjectInfo()
    // 并行加载子模块
    await Promise.all([
      this.memory.ensureInitAsync(),
      this.summary.ensureInitAsync(),
      this.window.ensureInitAsync()
    ])
    // 加载兼容层数据
    await Promise.all([
      this._loadTapeAsync(),
      this._loadIndexAsync()
    ])
    // 同步数据
    this._syncFromModules()
    // 确保索引文件存在
    try {
      await fs.promises.access(this.indexPath)
    } catch {
      this._saveIndex()
    }
    console.log('[Context] 异步初始化完成（双机制版本）')
    console.log('[Context] 项目:', this.projectPath)
    console.log('[Context] 记忆长度:', this.memory.getLength())
    console.log('[Context] 可见边界:', this.window.getBoundary())
    console.log('[Context] 行为摘要:', this.summary.getStatus())
  }

  /**
   * 初始化：创建目录、加载已有数据、同步模块
   */
  _init() {
    // 创建存储目录
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true })
      console.log('[Context] 创建存储目录:', this.storagePath)
    }

    // 保存项目信息（记录对应的项目路径）
    this._saveProjectInfo()

    // 加载兼容层数据（后续可移除）
    this._loadTape()
    this._loadIndex()

    // 同步数据：从新模块获取数据填充兼容层
    this._syncFromModules()

    // 确保索引文件存在（即使是空的）
    if (!fs.existsSync(this.indexPath)) {
      this._saveIndex()
    }

    console.log('[Context] 初始化完成（双机制版本）')
    console.log('[Context] 项目:', this.projectPath)
    console.log('[Context] 记忆长度:', this.memory.getLength())
    console.log('[Context] 可见边界:', this.window.getBoundary())
    console.log('[Context] 行为摘要:', this.summary.getStatus())
  }

  /**
   * 从新模块同步数据到兼容层
   */
  _syncFromModules() {
    // 同步 tape
    this.tape = typeof this.memory.getRecentHistory === 'function'
      ? this.memory.getRecentHistory()
      : (Array.isArray(this.memory.tape) ? this.memory.tape.slice() : [])

    // 同步 index
    this.index = this.memory.index || {}
  }

  /**
   * 保存项目信息
   */
  _saveProjectInfo() {
    try {
      const info = {
        projectPath: this.projectPath,
        storagePath: this.storagePath,
        createdAt: Date.now(),
        lastAccess: Date.now()
      }
      fs.writeFileSync(this.projectInfoPath, JSON.stringify(info, null, 2))
    } catch (e) {
      console.error('[Context] 保存项目信息失败:', e.message)
    }
  }

  /**
   * 加载 tape（完整历史）
   */
  _loadTape() {
    try {
      if (fs.existsSync(this.tapePath)) {
        const data = fs.readFileSync(this.tapePath, 'utf-8')
        this.tape = JSON.parse(data)
      }
    } catch (e) {
      console.error('[Context] 加载tape失败:', e.message)
      this.tape = []
    }
  }

  async _loadTapeAsync() {
    try {
      const data = await fs.promises.readFile(this.tapePath, 'utf-8')
      this.tape = JSON.parse(data)
    } catch {
      this.tape = []
    }
  }



  /**
   * 加载关键词索引
   */
  _loadIndex() {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = fs.readFileSync(this.indexPath, 'utf-8')
        this.index = JSON.parse(data)
      }
    } catch (e) {
      console.error('[Context] 加载index失败:', e.message)
      this.index = {}
    }
  }

  async _loadIndexAsync() {
    try {
      const data = await fs.promises.readFile(this.indexPath, 'utf-8')
      this.index = JSON.parse(data)
    } catch {
      this.index = {}
    }
  }

  /**
   * 保存 tape
   */
  _saveTape() {
    try {
      fs.writeFileSync(this.tapePath, JSON.stringify(this.tape, null, 2))
    } catch (e) {
      console.error('[Context] 保存tape失败:', e.message)
    }
  }



  /**
   * 保存索引
   */
  _saveIndex() {
    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2))
    } catch (e) {
      console.error('[Context] 保存index失败:', e.message)
    }
  }

  // ==================== 核心功能 ====================

  /**
   * 记录对话（双机制版本）
   * @param {string} userMessage 用户消息
   * @param {string} aiMessage AI回复
   * @param {string} modelName 模型名称
   * @param {object} toolCalls 工具调用记录（可选）
   * @returns {object} 记录结果，包含 turnId 和 visibilityAdjustment
   */
  recordTurn(userMessage, aiMessage, modelName, toolCalls = null) {
    const plainUserMessage = this._toPlainText(userMessage)
    const plainAiMessage = this._toPlainText(aiMessage)

    // 1. 记录到记忆系统（完整历史）
    const turnId = this.memory.record(plainUserMessage, plainAiMessage, toolCalls || [], modelName)

    // 2. 更新行为摘要（从工具调用提取）
    if (toolCalls && toolCalls.length > 0) {
      this.summary.extractFromToolCalls(toolCalls, turnId)
    }
    this.summary.extractFromContent(plainUserMessage, plainAiMessage, turnId)

    // 3. 同步数据
    this._syncFromModules()

    return {
      turnId,
      summary: this.summary.getStatus(),
      memory: this.memory.getStatus()
    }
  }

  /**
   * Token估算（简化版）
   */
  estimateTokens(text) {
    const plainText = this._toPlainText(text)
    if (!plainText) return 0
    const chineseChars = (plainText.match(/[^\x00-\xff]/g) || []).length
    const englishChars = plainText.length - chineseChars
    return Math.ceil(chineseChars / 2 + englishChars / 4)
  }

  _toPlainText(content) {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map(part => {
        if (typeof part === 'string') return part
        if (part?.type === 'text') return part.text || ''
        if (part?.type === 'image_url') return '[图片]'
        return ''
      }).join('\n')
    }
    try {
      return JSON.stringify(content)
    } catch (e) {
      return String(content)
    }
  }

  /**
   * 估算历史总token
   */
  estimateHistoryTokens(history) {
    return history.reduce((sum, msg) => {
      return sum + this.estimateTokens(msg.content || '')
    }, 0)
  }

  /**
   * 获取模型上下文上限
   */
  getModelLimit(modelName) {
    return resolveModelContextLimit(modelName)
  }

  /**
   * 检查是否需要压缩上下文
   */
  needsCompression(history, modelName) {
    const limit = this.getModelLimit(modelName)
    const currentTokens = this.estimateHistoryTokens(history)
    const threshold = limit * this.config.maxContextRatio

    console.log('[Context] Token估算:', currentTokens, '上限:', limit, '阈值:', threshold)

    return currentTokens > threshold
  }

  // ==================== 自动分割机制 ====================

  /**
   * 检查是否需要自动分割（达到60%触发）
   * @param {array} history 历史消息
   * @param {string} modelName 模型名称
   * @returns {object} { needed, ratio, currentTokens, limit }
   */
  checkAutoSplit(history, modelName) {
    const limit = this.getModelLimit(modelName)
    const currentTokens = this.estimateHistoryTokens(history)
    const ratio = currentTokens / limit
    const thresholdRatio = 0.6  // 60%触发分割

    return {
      needed: ratio >= thresholdRatio,
      ratio,
      currentTokens,
      limit,
      thresholdRatio
    }
  }

  /**
   * 执行自动分割
   * @param {array} history 历史消息
   * @param {number} targetRatio 目标比例（分割后降到这个比例）
   * @returns {object} { splitHistory, summary, splitIndex }
   */
  performAutoSplit(history, targetRatio = 0.3) {
    if (!history || history.length < 4) {
      return { splitHistory: history, summary: null, splitIndex: 0 }
    }

    // 计算要删除多少条消息才能降到目标比例
    const totalMessages = history.length
    // 简单策略：删除前一半的消息
    const splitIndex = Math.floor(totalMessages / 2)
    const messagesToDelete = history.slice(0, splitIndex)
    const splitHistory = history.slice(splitIndex)

    // 从删除的消息中提取摘要
    const summary = this._extractSplitSummary(messagesToDelete)

    console.log('[Context] 自动分割：删除前', splitIndex, '条消息，生成摘要')

    return {
      splitHistory,
      summary,
      splitIndex,
      deletedCount: splitIndex
    }
  }

  /**
   * 从删除的消息中提取摘要
   */
  _extractSplitSummary(messages) {
    const summary = {
      completed: [],      // 已完成
      pending: [],        // 待办
      issues: [],         // 遇到的问题
      decisions: [],      // 关键决策
      files: []           // 涉及文件
    }

    // 提取关键词
    const patterns = {
      completed: [/完成了|已实现|解决了|成功|好了|没问题了/gi],
      pending: [/需要|请帮我|要实现|想要|能不能/gi],
      issues: [/报错|错误|bug|问题|不行|失败/gi],
      decisions: [/决定|选择|采用|使用.*方案|方案是/gi]
    }

    // 文件路径匹配
    const fileRegex = /[a-zA-Z0-9_\-]+\.(js|ts|html|css|json|md|py|vue)/gi

    messages.forEach(msg => {
      const content = this._toPlainText(msg.content)

      // 提取各类信息
      for (const [type, regexList] of Object.entries(patterns)) {
        regexList.forEach(regex => {
          regex.lastIndex = 0
          let match
          while ((match = regex.exec(content)) !== null) {
            const context = content.substring(Math.max(0, match.index - 20), match.index + 50)
            if (!summary[type].some(s => s.includes(match[0]))) {
              summary[type].push(context.trim().substring(0, 60))
            }
          }
        })
      }

      // 提取文件
      fileRegex.lastIndex = 0
      let fileMatch
      while ((fileMatch = fileRegex.exec(content)) !== null) {
        if (!summary.files.includes(fileMatch[0])) {
          summary.files.push(fileMatch[0])
        }
      }
    })

    // 去重和限制数量
    summary.completed = summary.completed.slice(0, 5)
    summary.pending = summary.pending.slice(0, 5)
    summary.issues = summary.issues.slice(0, 5)
    summary.decisions = summary.decisions.slice(0, 5)
    summary.files = summary.files.slice(0, 10)

    return summary
  }

  /**
   * 格式化分割摘要给API
   */
  formatSplitSummaryForAPI(summary) {
    if (!summary) return ''

    let text = '## 历史对话摘要（已从上下文中移除）\n\n'

    if (summary.completed.length > 0) {
      text += '### 已完成\n'
      summary.completed.forEach(c => text += `- ${c}\n`)
      text += '\n'
    }

    if (summary.pending.length > 0) {
      text += '### 待办事项\n'
      summary.pending.forEach(p => text += `- ${p}\n`)
      text += '\n'
    }

    if (summary.issues.length > 0) {
      text += '### 遇到的问题\n'
      summary.issues.forEach(i => text += `- ${i}\n`)
      text += '\n'
    }

    if (summary.decisions.length > 0) {
      text += '### 关键决策\n'
      summary.decisions.forEach(d => text += `- ${d}\n`)
      text += '\n'
    }

    if (summary.files.length > 0) {
      text += `### 涉及文件: ${summary.files.join(', ')}\n`
    }

    text += '\n> 如需了解更多历史细节，可使用 recall_history 工具查询\n'

    return text
  }

  // ==================== 摘要生成 ====================





  // ==================== 上下文组装 ====================

  // ==================== 工具结果压缩 ====================

  /**
   * 压缩单条工具结果
   * @param {string} toolName 工具名称
   * @param {string} rawResult 原始结果JSON字符串
   */
  _compressToolResult(toolName, rawResult) {
    try {
      const result = JSON.parse(rawResult)

      switch (toolName) {
        case 'read_file':
          if (result.error) return `读取失败: ${result.error}`
          const lines = result.content ? result.content.split('\n').length : 0
          const preview = result.content ? result.content.substring(0, 100).replace(/\n/g, ' ') : ''
          return `已读取 ${result.path || '文件'}，共${lines}行。预览: "${preview}..."`

        case 'write_file':
          if (result.error) return `写入失败: ${result.error}`
          return `已写入 ${result.path || '文件'}，${result.bytes || 0}字节`

        case 'execute_command':
          if (result.error) return `执行失败: ${result.error}`
          const outputPreview = result.stdout ? result.stdout.substring(0, 80).replace(/\n/g, ' ') : ''
          return `命令完成。输出: "${outputPreview}..."`

        case 'web_search':
          if (result.error) return `搜索失败: ${result.error}`
          return `搜索完成，找到${result.results?.length || 0}个结果`

        case 'list_files':
          if (result.error) return `列出失败: ${result.error}`
          return `列出 ${result.path || ''}，共${result.files?.length || 0}个文件`

        case 'grep_search':
          if (result.error) return `搜索失败: ${result.error}`
          return `搜索"${result.pattern || ''}"，${result.matches?.length || 0}个匹配`

        default:
          if (result.error) return `失败: ${result.error}`
          if (result.status) return `状态: ${result.status}`
          const str = JSON.stringify(result)
          return str.length > 150 ? str.substring(0, 150) + '...' : str
      }
    } catch (e) {
      return rawResult.length > 150 ? rawResult.substring(0, 150) + '...' : rawResult
    }
  }

  /**
   * 压缩历史中的工具结果（用于正常模式）
   * @param {Array} history 原始历史
   */
  compressHistory(history) {
    const toolCallMap = new Map()

    return history.map(msg => {
      const compressed = { ...msg }

      // 记录工具调用映射
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCallMap.set(tc.id, tc.function.name)
        }
      }

      // 压缩tool消息
      if (msg.role === 'tool') {
        const toolName = toolCallMap.get(msg.tool_call_id) || 'unknown'
        compressed.content = this._compressToolResult(toolName, msg.content)
      }

      return compressed
    })
  }

  /**
   * 组装发送给API的上下文（简化版，只返回历史消息）
   * - 自动分割超限历史
   * - 压缩工具结果
   * - 保留最近的重要消息
   * @param {Array} history 完整历史（来自 instance.messagesHistory）
   * @param {string} modelName 模型名称
   * @returns {Array} 压缩后的历史消息数组（不含系统提示）
   */
  assembleContextForAPI(history, modelName) {
    const limit = this.getModelLimit(modelName)
    const targetTokens = limit * 0.6  // 目标60%上限，留40%给响应

    // 1. 先压缩工具结果
    let compressedHistory = this.compressHistory(history)
    let currentTokens = this.estimateHistoryTokens(compressedHistory)

    console.log('[Context] 压缩后token估算:', currentTokens, '上限:', limit)

    // 2. 如果仍超限，从最早的user消息开始移除
    if (currentTokens > targetTokens) {
      console.log('[Context] 超限，开始移除旧消息')
      // 保留最近5轮对话（至少）
      const minTurns = 5
      // 找到所有user消息的位置
      let userPositions = compressedHistory
        .map((msg, i) => msg.role === 'user' ? i : -1)
        .filter(i => i >= 0)

      // 从最早的user开始移除，直到满足targetTokens
      while (currentTokens > targetTokens && userPositions.length > minTurns && compressedHistory.length > 0) {
        const firstUserPos = userPositions[0]

        // 移除这条user消息
        if (firstUserPos < compressedHistory.length) {
          const removed = compressedHistory.splice(firstUserPos, 1)
          currentTokens -= this.estimateTokens(removed[0]?.content || '')

          // 移除后续的 assistant/tool 消息（直到下一个user或数组结束）
          let removeCount = 0
          while (compressedHistory.length > firstUserPos && compressedHistory[firstUserPos]?.role !== 'user') {
            const removedAssistant = compressedHistory.splice(firstUserPos, 1)
            currentTokens -= this.estimateTokens(removedAssistant[0]?.content || '')
            removeCount++
          }

          // 更新user位置列表（索引需要减去移除的数量）
          userPositions.shift()
          userPositions = userPositions.map(i => i - (1 + removeCount))
        } else {
          break
        }
      }

      console.log('[Context] 移除后token估算:', currentTokens, '剩余消息:', compressedHistory.length)
    }

    // 3. 最终检查：如果单条消息超长，截断
    for (const msg of compressedHistory) {
      const plainContent = this._toPlainText(msg.content)
      if (plainContent && plainContent.length > 5000) {
        msg.content = '...[内容过长已截断]...\n' + plainContent.substring(plainContent.length - 2000)
        msg._truncated = true
      }
    }

    return compressedHistory
  }

  /**
   * 组装发送给API的上下文（双机制版本）
   * - 使用行为摘要替代旧的摘要格式
   * - 使用可见窗口控制AI可见范围
   * @param {Array} history 原始历史
   * @param {string} modelName 当前模型
   * @param {string} newMessage 新消息（可选）
   * @returns {object} { messages, visibilityStats, estimatedTokens }
   */
  assembleContext(history, modelName, newMessage = '') {
    const limit = this.getModelLimit(modelName)
    const targetTokens = limit * 0.7

    let messages = []
    let estimatedTokens = 0

    // ===== 1. 系统提示（固定） =====
    const systemPrompt = this._getSystemPrompt()
    messages.push({ role: 'system', content: systemPrompt })
    estimatedTokens += this.estimateTokens(systemPrompt)

    // ===== 2. 项目记忆 =====
    const memory = this._loadMemory()
    if (memory) {
      messages.push({ role: 'system', content: `[项目记忆]\n${memory}` })
      estimatedTokens += this.estimateTokens(memory)
    }

    const organizedMemory = memoryOrganizer.formatForContext(memoryOrganizer.load({ storagePath: this.storagePath }), { query: newMessage })
    if (organizedMemory) {
      messages.push({ role: 'system', content: organizedMemory })
      estimatedTokens += this.estimateTokens(organizedMemory)
    }

    // ===== 3. 行为摘要（新格式） =====
    const behaviorSummary = this.summary.formatForAPI()
    if (behaviorSummary && behaviorSummary.length > 50) {
      messages.push({ role: 'system', content: behaviorSummary })
      estimatedTokens += this.estimateTokens(behaviorSummary)
    }

    // ===== 4. 可见窗口处理 =====
    // 检查是否需要调整窗口
    const totalTokens = this.estimateHistoryTokens(history || [])
    const adjustCheck = this.window.shouldAdjust(totalTokens, limit)

    if (adjustCheck.needed) {
      // 计算新边界
      const newBoundary = this.window.calculateBoundary(history, totalTokens, limit)
      if (newBoundary > this.window.getBoundary()) {
        this.window.shiftBoundary(newBoundary)
      }
    }

    // 获取AI可见的消息
    const visibleHistory = this.window.getVisibleMessages(history || [])
    const visibilityStats = this.window.getVisibilityStats(history)

    console.log('[Context] 可见窗口:', visibilityStats)

    // ===== 5. 处理可见历史消息（压缩工具结果） =====
    const toolCallMap = new Map()

    for (const msg of visibleHistory) {
      let compressedMsg = { ...msg }

      // 处理assistant消息中的tool_calls
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCallMap.set(tc.id, tc.function.name)
        }
        compressedMsg.tool_calls = msg.tool_calls
      }

      // 处理tool消息 - 压缩工具结果
      if (msg.role === 'tool') {
        const toolName = toolCallMap.get(msg.tool_call_id) || 'unknown'
        compressedMsg.content = this._compressToolResult(toolName, msg.content)
      }

      // 处理超长的assistant/user消息（保留结构，不压缩内容）
      // 注意：双机制下不压缩发言内容，只在超长时截断
      const plainContent = this._toPlainText(msg.content)
      if (plainContent && plainContent.length > 4000 && msg.role !== 'tool') {
        // 保留最近部分，标记截断
        compressedMsg.content = '...[内容过长已截断]...\n' + plainContent.substring(plainContent.length - 1500)
        compressedMsg._truncated = true
      }

      messages.push(compressedMsg)
      estimatedTokens += this.estimateTokens(compressedMsg.content || '')
    }

    // 如果仍超限，逐步移除最早可见消息
    while (estimatedTokens > targetTokens && messages.length > 15) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && i > 6) {
          messages.splice(i, 1)
          while (i < messages.length && messages[i].role !== 'user') {
            const removed = messages.splice(i, 1)[0]
            estimatedTokens -= this.estimateTokens(removed.content || '')
          }
          break
        }
      }
    }

    console.log('[Context] 组装完成，消息数:', messages.length, '估算token:', estimatedTokens)

    return {
      messages,
      visibilityStats,
      estimatedTokens,
      behaviorSummaryUsed: behaviorSummary.length > 50
    }
  }

  /**
   * 系统提示（压缩模式专用）
   */
  _getSystemPrompt() {
    const now = new Date()
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const day = now.getDate()
    const weekday = weekDays[now.getDay()]
    const hours = String(now.getHours()).padStart(2, '0')
    const startMinute = now.getMinutes() < 30 ? '00' : '30'
    const endMinute = now.getMinutes() < 30 ? '29' : '59'
    const timeBucket = `${hours}:${startMinute}-${hours}:${endMinute}`

    return `当前时间：${year}年${month}月${day}日 星期${weekday} ${timeBucket}
当前项目路径：${this.projectPath || '未指定'}

===== 路径处理规则 =====
- 如果用户指定了完整路径，优先使用用户路径
- 相对路径基于项目路径 "${this.projectPath}" 解析

===== 搜索规则 =====
- 用户查询默认为最新信息，搜索关键词需包含时间（如"xxx ${year}年${month}月"）
- "最近"、"最新"指${year}年${month}月`
  }

  /**
   * 加载项目记忆
   */
  _loadMemory() {
    try {
      if (fs.existsSync(this.memoryPath)) {
        return fs.readFileSync(this.memoryPath, 'utf-8')
      }
    } catch (e) {
      // 忽略
    }
    return null
  }

  /**
   * 格式化摘要给API
   */
  _formatSummary(summary) {
    let text = `【摘要范围：Turn ${summary.range.start}-${summary.range.end}】\n\n`

    if (summary.requirements.length > 0) {
      text += `需求:\n`
      summary.requirements.forEach(r => {
        text += `  - Turn${r.turn}: ${r.context}\n`
      })
      text += '\n'
    }

    if (summary.decisions.length > 0) {
      text += `决策:\n`
      summary.decisions.forEach(d => {
        text += `  - Turn${d.turn}: ${d.context}\n`
      })
      text += '\n'
    }

    if (summary.problems.length > 0) {
      text += `问题:\n`
      summary.problems.forEach(p => {
        text += `  - Turn${p.turn}: ${p.context}\n`
      })
      text += '\n'
    }

    if (summary.progress.length > 0) {
      text += `进度:\n`
      summary.progress.forEach(p => {
        text += `  - Turn${p.turn}: ${p.context}\n`
      })
      text += '\n'
    }

    if (summary.files.length > 0) {
      text += `涉及文件: ${summary.files.slice(0, 10).join(', ')}\n`
    }

    return text
  }

  /**
   * 格式化相关历史片段
   */
  _formatFragments(fragments) {
    return fragments.map(f => {
      const content = this._toPlainText(f.content)
      return `Turn${f.turn}: [${f.role}] ${content.substring(0, 200)}`
    }).join('\n')
  }

  // ==================== 索引机制 ====================

  /**
   * 更新关键词索引
   */
  _updateIndex(turn) {
    // 提取关键词
    const keywords = this._extractKeywords(turn.user + ' ' + (turn.ai || ''))

    for (const keyword of keywords) {
      if (!this.index[keyword]) {
        this.index[keyword] = []
      }
      // 记录turn位置
      if (!this.index[keyword].includes(turn.id)) {
        this.index[keyword].push(turn.id)
      }
    }

    // 每次都保存索引（确保实时性）
    this._saveIndex()
  }

  /**
   * 提取关键词（简化版）
   */
  _extractKeywords(text) {
    const keywords = []

    // 1. 文件路径
    const fileRegex = /[a-zA-Z0-9_\-]+\.(js|ts|html|css|json|md|py)/gi
    let match
    while ((match = fileRegex.exec(text)) !== null) {
      keywords.push(match[0])
    }

    // 2. 中文关键词（2-6字）
    const chineseRegex = /[一-龥]{2,6}/g
    chineseRegex.lastIndex = 0
    while ((match = chineseRegex.exec(text)) !== null) {
      const word = match[0]
      // 过滤常见无意义词
      const stopWords = ['然后', '所以', '但是', '因为', '还是', '什么', '这个', '那个', '可以', '需要', '已经', '就是']
      if (!stopWords.includes(word)) {
        keywords.push(word)
      }
    }

    // 3. 英文技术词汇
    const techRegex = /\b(function|class|const|let|var|import|export|async|await|error|bug|api|config|model)\b/gi
    techRegex.lastIndex = 0
    while ((match = techRegex.exec(text)) !== null) {
      keywords.push(match[0].toLowerCase())
    }

    return keywords.slice(0, 20)  // 限制数量
  }

  /**
   * 检索相关历史片段
   */
  _retrieveRelevantHistory(query) {
    const fragments = []
    const queryKeywords = this._extractKeywords(query)

    // 找到匹配的turn
    const matchedTurns = new Set()
    for (const keyword of queryKeywords) {
      if (this.index[keyword]) {
        this.index[keyword].forEach(turnId => matchedTurns.add(turnId))
      }
    }

    // 提取相关片段（最多5个）
    const turnIds = Array.from(matchedTurns).sort((a, b) => b - a).slice(0, 5)

    for (const turnId of turnIds) {
      const turn = this.tape[turnId - 1]  // turn编号从1开始
      if (turn) {
        fragments.push({
          turn: turnId,
          role: 'user',
          content: turn.user
        })
        if (turn.ai) {
          fragments.push({
            turn: turnId,
            role: 'assistant',
            content: turn.ai
          })
        }
      }
    }

    return fragments
  }

  // ==================== 工具接口 ====================

  /**
   * AI主动查询历史（recall_history工具）
   * 支持三种查询模式：关键词 / 时间序(order) / 轮次直取(turn)
   * 搜不到时自动降级返回最近 N 条
   */
  recallHistory(args, legacyMaxResults) {
    // 兼容旧签名 recallHistory(query, maxResults)
    const opts = (typeof args === 'object' && args !== null && !Array.isArray(args))
      ? args
      : { query: args, maxResults: legacyMaxResults }

    // 转换 schema 的 time_range → 内部 timeRange
    const internalOpts = {
      query: opts.query,
      order: opts.order,
      turn: opts.turn,
      timeRange: opts.time_range,   // schema 用 snake_case，内部用 camelCase
      maxResults: opts.max_results || legacyMaxResults || 10
    }

    const result = this.memory.recall(internalOpts)

    // 格式化结果给AI
    let formattedText = `## 记忆查询结果\n\n查询: ${result.query}\n找到 ${result.count} 条相关记录\n\n`

    if (result.results.length > 0) {
      result.results.forEach(f => {
        const time = f.timestamp ? new Date(f.timestamp).toLocaleString('zh-CN') : ''
        formattedText += `--- Turn ${f.turn} ${time} ---\n`
        formattedText += `用户: ${f.user}\n`
        if (f.ai) {
          formattedText += `AI: ${f.ai}\n`
        }
        formattedText += '\n'
      })
    } else {
      formattedText += `提示: ${result.hint}\n`
    }

    if (result.hint && result.results.length > 0) {
      formattedText += `\n提示: ${result.hint}\n`
    }

    return {
      ...result,
      text: formattedText
    }
  }

  /**
   * 按时间范围查询历史
   */
  recallByTime(startTime, endTime, maxResults = 20) {
    return this.memory.recallByTime(startTime, endTime, maxResults)
  }

  /**
   * 按Turn范围查询历史
   */
  recallByTurnRange(startTurn, endTurn, maxResults = 20) {
    return this.memory.recallByTurnRange(startTurn, endTurn, maxResults)
  }

  /**
   * 获取可见边界状态
   */
  getVisibilityBoundary() {
    return this.window.getBoundary()
  }

  /**
   * 重置可见边界（让所有消息可见）
   */
  resetVisibilityBoundary() {
    this.window.resetBoundary()
    return { success: true, newIndex: 0 }
  }

  /**
   * 获取上下文状态（双机制版本）
   */
  getStatus(modelName = null) {
    // 确保数据同步（前端可能在任何时候调用此方法）
    this._syncFromModules()

    // 从记忆系统获取数据
    const memoryStatus = this.memory.getStatus()
    const summaryStatus = this.summary.getStatus()
    const windowStatus = this.window.getStatus()

    // 根据模型获取上限
    const limit = modelName ? this.getModelLimit(modelName) : 128000

    // 估算当前上下文 token 数量（使用记忆系统的tape）
    const tape = this.memory.tape
    let estimatedTokens = 0
    tape.forEach(turn => {
      estimatedTokens += this.estimateTokens(turn.user || '')
      estimatedTokens += this.estimateTokens(turn.ai || '')
      if (turn.toolCalls) {
        turn.toolCalls.forEach(tc => {
          estimatedTokens += this.estimateTokens(tc.name || '')
          estimatedTokens += this.estimateTokens(JSON.stringify(tc.args || {}))
          estimatedTokens += this.estimateTokens(JSON.stringify(tc.result || {}))
        })
      }
    })

    // 计算上下文比例
    const contextRatio = Math.min(estimatedTokens / limit, 1)

    console.log('[Context] getStatus: tape长度=', tape.length, '估算tokens=', estimatedTokens, '模型上限=', limit)

    return {
      // 记忆系统状态
      tapeLength: memoryStatus.tapeLength,
      indexSize: memoryStatus.indexSize,
      lastTurnId: memoryStatus.lastTurnId,
      lastTurnTime: memoryStatus.lastTurnTime,

      // 上下文使用情况
      estimatedTokens: Math.round(estimatedTokens),
      contextRatio: contextRatio,
      modelLimit: limit,

      // 行为摘要状态
      summary: {
        completedCount: summaryStatus.completedCount,
        inProgressCount: summaryStatus.inProgressCount,
        pendingCount: summaryStatus.pendingCount,
        filesCreatedCount: summaryStatus.filesCreatedCount,
        filesModifiedCount: summaryStatus.filesModifiedCount,
        filesDeletedCount: summaryStatus.filesDeletedCount,
        issuesCount: summaryStatus.issuesCount,
        decisionsCount: summaryStatus.decisionsCount,
        lastUpdateTurn: summaryStatus.lastUpdateTurn
      },

      // 可见窗口状态
      visibility: {
        visibleStartIndex: windowStatus.visibleStartIndex,
        config: windowStatus.config
      },

      // 兼容层状态
      summaryCount: 0, // summaryCache 已移除      modelsUsed: this._getAllModelsUsed(),

      // 项目信息
      projectPath: this.projectPath,
      storagePath: this.storagePath
    }
  }

  /**
   * 获取所有使用过的模型
   */
  _getAllModelsUsed() {
    const models = new Set()
    const tape = this.memory.tape
    tape.forEach(turn => {
      if (turn.model) models.add(turn.model)
    })
    return Array.from(models)
  }

  /**
   * 清空上下文（只清空发给API的历史，不清空记忆系统）
   */
  clearContext() {
    // 不清空记忆系统！记忆系统用于查询，应该保留
    // this.memory.clear()  // 移除这行

    // 重置可见窗口
    this.window.resetBoundary()

    // 清空兼容层（发给API的历史）
    this.tape = []
    this.index = {}

    console.log('[Context] 已清空上下文（记忆系统保留）')
  }

  /**
   * 清空所有（包括记忆系统，慎用！）
   */
  clearAll() {
    // 清空记忆系统
    this.memory.clear()
    memoryOrganizer.clear({ storagePath: this.storagePath })

    // 清空行为摘要
    this.summary.clear()

    // 重置可见窗口
    this.window.resetBoundary()

    // 清空兼容层
    this.tape = []
    this.index = {}
    this._saveTape()
    this._saveIndex()

    console.log('[Context] 已清空所有（包括记忆系统）')
  }

  /**
   * 旧版本clear（兼容）
   */
  clear() {
    this.clearContext()
  }
}

module.exports = { ContextManager }
