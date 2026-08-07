/**
 * 记忆系统模块
 * - 保留近期 AI 运行记忆（用户可见历史由 messagesHistory 负责）
 * - 关键词索引快速检索
 * - 提供查询接口给AI
 */

const fs = require('fs')
const path = require('path')

class MemorySystem {
  /**
   * @param {string} storagePath 存储目录（项目独立）
   */
  constructor(storagePath, options = {}) {
    this.storagePath = storagePath
    this.tapePath = path.join(storagePath, 'tape.json')
    this.indexPath = path.join(storagePath, 'index.json')

    // 内存缓存
    this.tape = []       // 近期 AI 运行记忆，不作为用户可见聊天历史
    this.index = {}      // 关键词索引

    // 配置
    this.config = {
      maxQueryResults: 10,     // 查询最大返回数
      minKeywordLength: 2,     // 最小关键词长度
      indexUpdateInterval: 3,  // 每3轮更新索引
      maxTapeTurns: 100        // tape 只保留近期运行记忆
    }
    // 延迟保存：合并短时间内的多次写入，避免每轮都同步写盘
    this._saveTimer = null
    this._dirty = false
    this._indexDirty = false
    this._writing = false

    if (!options.deferredInit) {
      this._init()
    }
  }

  /**
   * 异步初始化（用于 deferredInit 模式）
   */
  async ensureInitAsync() {
    await fs.promises.mkdir(this.storagePath, { recursive: true }).catch(() => {})
    await this._loadTapeAsync()
    await this._loadIndexAsync()
    const trimmed = this._trimTapeIfNeeded()
    if (trimmed) this._scheduleSave()
    console.log('[Memory] 异步初始化完成，历史长度:', this.tape.length, '索引关键词:', Object.keys(this.index).length)
  }

  async _loadTapeAsync() {
    try {
      const data = await fs.promises.readFile(this.tapePath, 'utf-8')
      this.tape = JSON.parse(data)
    } catch {
      this.tape = []
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
   * 初始化：加载已有数据
   */
  _init() {
    // 确保目录存在
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true })
    }

    // 加载 tape
    this._loadTape()

    // 加载索引
    this._loadIndex()

    const trimmed = this._trimTapeIfNeeded()
    if (trimmed) this._scheduleSave()

    console.log('[Memory] 初始化完成，历史长度:', this.tape.length, '索引关键词:', Object.keys(this.index).length)
  }

  /**
   * 加载 tape
   */
  _loadTape() {
    try {
      if (fs.existsSync(this.tapePath)) {
        const data = fs.readFileSync(this.tapePath, 'utf-8')
        this.tape = JSON.parse(data)
      }
    } catch (e) {
      console.error('[Memory] 加载tape失败:', e.message)
      this.tape = []
    }
  }

  /**
   * 加载索引
   */
  _loadIndex() {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = fs.readFileSync(this.indexPath, 'utf-8')
        this.index = JSON.parse(data)
      }
    } catch (e) {
      console.error('[Memory] 加载index失败:', e.message)
      this.index = {}
    }
  }

  /**
   * 延迟保存——合并短时间内的多次写入，避免每轮都同步写盘
   */
  _scheduleSave() {
    this._dirty = true
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this.flush()
    }, 500)
  }

  _trimTapeIfNeeded() {
    const maxTurns = this.config.maxTapeTurns
    if (!Number.isFinite(maxTurns) || maxTurns <= 0 || this.tape.length <= maxTurns) return false
    this.tape = this.tape.slice(-maxTurns)
    this._rebuildIndex()
    this._dirty = true
    this._indexDirty = true
    return true
  }

  _rebuildIndex() {
    this.index = {}
    for (const turn of this.tape) {
      this._updateIndex(turn)
    }
  }

  _findTurnById(turnId) {
    return this.tape.find(turn => turn.id === turnId)
  }

  /**
   * 立即异步保存所有脏数据到磁盘
   */
  async flush() {
    if (this._writing) return
    this._writing = true
    try {
      const tasks = []
      if (this._dirty) {
        const json = JSON.stringify(this.tape, null, 2)
        tasks.push(fs.promises.writeFile(this.tapePath, json, 'utf-8'))
        this._dirty = false
      }
      if (this._indexDirty) {
        const idxJson = JSON.stringify(this.index, null, 2)
        tasks.push(fs.promises.writeFile(this.indexPath, idxJson, 'utf-8'))
        this._indexDirty = false
      }
      if (tasks.length > 0) await Promise.all(tasks)
    } catch (e) {
      console.error('[Memory] 异步保存失败:', e.message)
    } finally {
      this._writing = false
    }
  }

  /**
   * 保存 tape（同步版本，仅用于 clear 等需要立即写入的场景）
   */
  _saveTape() {
    try {
      fs.writeFileSync(this.tapePath, JSON.stringify(this.tape, null, 2))
    } catch (e) {
      console.error('[Memory] 保存tape失败:', e.message)
    }
  }

  /**
   * 保存索引（同步版本，仅用于 clear 等需要立即写入的场景）
   */
  _saveIndex() {
    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2))
    } catch (e) {
      console.error('[Memory] 保存index失败:', e.message)
    }
  }

  // ==================== 核心功能 ====================

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
   * 记录对话（追加到近期 tape）
   * @param {string} userMessage 用户消息
   * @param {string} aiMessage AI回复
   * @param {array} toolCalls 工具调用记录（可选）
   * @param {string} modelName 模型名称（可选）
   */
  record(userMessage, aiMessage, toolCalls = [], modelName = '') {
    const plainUserMessage = this._toPlainText(userMessage)
    const plainAiMessage = this._toPlainText(aiMessage)

    const turn = {
      id: this.tape.length > 0 ? this.tape[this.tape.length - 1].id + 1 : 1,
      timestamp: Date.now(),
      user: plainUserMessage,
      ai: plainAiMessage,
      toolCalls: toolCalls,
      model: modelName
    }

    this.tape.push(turn)
    const trimmed = this._trimTapeIfNeeded()

    // 延迟保存——不再每次都同步写盘 + 读回验证
    this._scheduleSave()

    // 更新关键词索引（内存操作，不写盘）
    this._updateIndex(turn)
    // 每 N 轮标记索引需要保存
    if (trimmed || this.tape.length % this.config.indexUpdateInterval === 0) {
      this._indexDirty = true
      this._scheduleSave()
    }

    return turn.id
  }


  /**
   * 获取历史长度
   */
  getLength() {
    return this.tape.length
  }

  /**
   * 获取近期 tape 快照，仅供内部兼容层同步状态使用。
   * tape 不是用户可见完整聊天历史，调用方不能把它当完整历史。
   */
  getRecentHistory() {
    return Array.isArray(this.tape) ? this.tape.slice() : []
  }

  // ==================== 查询功能 ====================

  /**
   * 查询历史（供AI调用）
   * 兼容旧签名 recall(query, maxResults)，也支持新签名 recall(options)
   * @param {string|object} queryOrOptions 查询关键词 或 选项对象
   * @param {number} maxResults 最大返回数（仅旧签名生效）
   */
  recall(queryOrOptions, maxResults = 10) {
    // 归一化参数：支持旧签名 recall(query, maxResults) 和新签名 recall({query, order, turn, timeRange, maxResults})
    const opts = (typeof queryOrOptions === 'object' && queryOrOptions !== null && !Array.isArray(queryOrOptions))
      ? queryOrOptions
      : { query: queryOrOptions, maxResults }

    const query = String(opts.query || '').trim()
    const limit = Math.max(1, Number(opts.maxResults) || maxResults)

    // 优先级 1：turn 直取
    if (opts.turn != null && !Number.isNaN(Number(opts.turn))) {
      return this._recallByTurn(Number(opts.turn))
    }

    // 优先级 2：时间范围
    if (opts.timeRange && (opts.timeRange.start != null || opts.timeRange.end != null)) {
      const start = Number(opts.timeRange.start) || 0
      const end = Number(opts.timeRange.end) || Date.now()
      return this.recallByTime(start, end, limit)
    }

    // 优先级 3：时间序直取（order）
    if (opts.order === 'asc' || opts.order === 'desc') {
      return this._recallByOrder(opts.order, limit)
    }

    // 优先级 4：关键词查询（原逻辑，含降级兜底）
    return this._recallByKeyword(query, limit)
  }

  /**
   * 按轮次 ID 精确取一条
   */
  _recallByTurn(turnId) {
    const turn = this._findTurnById(turnId)
    if (!turn) {
      return {
        success: true,
        query: `turn=${turnId}`,
        results: [],
        count: 0,
        hint: `未找到 turn ${turnId}（tape 现存 ${this.tape.length} 条，ID 范围 ${this.tape.length > 0 ? `${this.tape[0].id}-${this.tape[this.tape.length - 1].id}` : '空'}）。提示：超过 100 轮前的对话已转存到 chat-chunk-store，tape 不保留。`
      }
    }
    const user = this._toPlainText(turn.user)
    const ai = this._toPlainText(turn.ai)
    return {
      success: true,
      query: `turn=${turnId}`,
      results: [{
        turn: turn.id,
        timestamp: turn.timestamp,
        user: user.substring(0, 500),
        ai: ai.substring(0, 500),
        toolCalls: turn.toolCalls?.slice(0, 5) || [],
        model: turn.model
      }],
      count: 1,
      hint: `找到 turn ${turnId}`
    }
  }

  /**
   * 按时间序直接取（不依赖关键词）
   * @param {'asc'|'desc'} order asc=从最老开始，desc=从最新开始
   */
  _recallByOrder(order, maxResults) {
    const sorted = order === 'asc'
      ? this.tape.slice()                          // 正序：最老在前
      : this.tape.slice().reverse()                // 倒序：最新在前
    const picks = sorted.slice(0, maxResults)
    const fragments = picks.map(turn => ({
      turn: turn.id,
      timestamp: turn.timestamp,
      user: this._toPlainText(turn.user).substring(0, 500),
      ai: this._toPlainText(turn.ai).substring(0, 500),
      toolCalls: turn.toolCalls?.slice(0, 5) || [],
      model: turn.model
    }))
    return {
      success: true,
      query: `order=${order}`,
      results: fragments,
      count: fragments.length,
      hint: fragments.length > 0
        ? `按时间序（${order === 'asc' ? '最早' : '最新'}）返回 ${fragments.length} 条`
        : `tape 为空`
    }
  }

  /**
   * 关键词查询（原 recall 逻辑）+ 搜不到时自动降级返回最近 N 条
   */
  _recallByKeyword(query, maxResults) {
    const fragments = []
    const queryKeywords = this._extractKeywords(query)
    const normalizedQuery = String(query || '').trim().toLowerCase()
    const isGeneralHistoryQuery = !normalizedQuery ||
      /之前|刚才|上次|历史|记忆|聊了什么|说了什么|conversation|history|memory|previous|earlier/i.test(normalizedQuery)

    // 找到匹配的turn
    const matchedTurns = new Set()
    for (const keyword of queryKeywords) {
      if (this.index[keyword]) {
        this.index[keyword].forEach(turnId => matchedTurns.add(turnId))
      }
    }

    // 如果索引没找到，尝试全文搜索
    if (matchedTurns.size === 0) {
      for (let i = this.tape.length - 1; i >= 0 && fragments.length < maxResults; i--) {
        const turn = this.tape[i]
        const content = this._toPlainText(turn.user) + ' ' + this._toPlainText(turn.ai)
        if (isGeneralHistoryQuery || content.toLowerCase().includes(normalizedQuery)) {
          matchedTurns.add(turn.id)
        }
      }
    }

    // 提取相关片段（优先最新的）
    const turnIds = Array.from(matchedTurns).sort((a, b) => b - a).slice(0, maxResults)

    for (const turnId of turnIds) {
      const turn = this._findTurnById(turnId)
      if (turn) {
        const user = this._toPlainText(turn.user)
        const ai = this._toPlainText(turn.ai)
        fragments.push({
          turn: turnId,
          timestamp: turn.timestamp,
          user: user.substring(0, 500),
          ai: ai.substring(0, 500),
          toolCalls: turn.toolCalls?.slice(0, 5) || [],
          model: turn.model
        })
      }
    }

    // 降级兜底：关键词 0 命中时，返回最近 N 条，避免让模型盲目换词
    if (fragments.length === 0 && this.tape.length > 0) {
      const fallbackCount = Math.min(maxResults, this.tape.length)
      const fallback = this.tape.slice(-fallbackCount).reverse()  // 最近 N 条
      const fallbackFragments = fallback.map(turn => ({
        turn: turn.id,
        timestamp: turn.timestamp,
        user: this._toPlainText(turn.user).substring(0, 500),
        ai: this._toPlainText(turn.ai).substring(0, 500),
        toolCalls: turn.toolCalls?.slice(0, 5) || [],
        model: turn.model
      }))
      return {
        success: true,
        query,
        results: fallbackFragments,
        count: fallbackFragments.length,
        hint: `未找到匹配 "${query}" 的记录。已自动降级返回最近 ${fallbackFragments.length} 条作为参考（您可据此用 turn 参数精确取，或用 order='asc' 看最早的记录）。`
      }
    }

    return {
      success: true,
      query,
      results: fragments,
      count: fragments.length,
      hint: fragments.length > 0 ? `找到 ${fragments.length} 条相关记录` : 'tape 为空'
    }
  }

  /**
   * 按时间范围查询
   * @param {number} startTime 开始时间戳
   * @param {number} endTime 结束时间戳
   */
  recallByTime(startTime, endTime, maxResults = 20) {
    const fragments = []

    for (let i = this.tape.length - 1; i >= 0 && fragments.length < maxResults; i--) {
      const turn = this.tape[i]
      if (turn.timestamp >= startTime && turn.timestamp <= endTime) {
        const user = this._toPlainText(turn.user)
        const ai = this._toPlainText(turn.ai)
        fragments.push({
          turn: turn.id,
          timestamp: turn.timestamp,
          user: user.substring(0, 300),
          ai: ai.substring(0, 300)
        })
      }
    }

    return {
      success: true,
      range: { startTime, endTime },
      results: fragments,
      count: fragments.length
    }
  }

  /**
   * 按Turn ID范围查询
   * @param {number} startTurn 开始Turn ID
   * @param {number} endTurn 结束Turn ID
   */
  recallByTurnRange(startTurn, endTurn, maxResults = 20) {
    const fragments = []

    for (const turn of this.tape) {
      if (fragments.length >= maxResults) break
      if (!turn || turn.id < startTurn || turn.id > endTurn) continue
      const user = this._toPlainText(turn.user)
      const ai = this._toPlainText(turn.ai)
      fragments.push({
        turn: turn.id,
        timestamp: turn.timestamp,
        user,
        ai,
        toolCalls: turn.toolCalls || []
      })
    }

    return {
      success: true,
      range: { startTurn, endTurn },
      results: fragments,
      count: fragments.length
    }
  }

  // ==================== 索引机制 ====================

  /**
   * 更新关键词索引
   */
  _updateIndex(turn) {
    const keywords = this._extractKeywords(this._toPlainText(turn.user) + ' ' + this._toPlainText(turn.ai))

    for (const keyword of keywords) {
      if (!this.index[keyword]) {
        this.index[keyword] = []
      }
      // 记录turn位置（避免重复）
      if (!this.index[keyword].includes(turn.id)) {
        this.index[keyword].push(turn.id)
      }
    }
  }

  /**
   * 提取关键词
   */
  _extractKeywords(text) {
    const keywords = []

    // 1. 文件路径
    const fileRegex = /[a-zA-Z0-9_\-]+\.(js|ts|html|css|json|md|py|vue|jsx|tsx)/gi
    let match
    while ((match = fileRegex.exec(text)) !== null) {
      keywords.push(match[0])
    }

    // 2. 中文关键词（2-6字）
    const chineseRegex = /[一-龥]{2,6}/g
    chineseRegex.lastIndex = 0
    while ((match = chineseRegex.exec(text)) !== null) {
      const word = match[0]
      // 过滤无意义词
      const stopWords = ['然后', '所以', '但是', '因为', '还是', '什么', '这个', '那个', '可以', '需要', '已经', '就是', '好的', '好的我']
      if (!stopWords.includes(word)) {
        keywords.push(word)
      }
    }

    // 3. 英文技术词汇
    const techRegex = /\b(function|class|const|let|var|import|export|async|await|error|bug|api|config|model|module|create|delete|update|read|write|edit|file|git|commit|push|pull|branch)\b/gi
    techRegex.lastIndex = 0
    while ((match = techRegex.exec(text)) !== null) {
      keywords.push(match[0].toLowerCase())
    }

    // 4. 工具名称
    const toolRegex = /\b(read_file|write_file|edit_file|create_directory|delete_file|list_files|run_command|lxweb|browser_search|browser_fetch|recall_history|read_task_ledger_entry)\b/gi
    toolRegex.lastIndex = 0
    while ((match = toolRegex.exec(text)) !== null) {
      keywords.push(match[0])
    }

    return keywords.slice(0, 30)
  }

  // ==================== 工具接口 ====================

  /**
   * 清空记忆
   */
  clear() {
    this.tape = []
    this.index = {}
    this._saveTape()
    this._saveIndex()
    console.log('[Memory] 已清空')
  }

  /**
   * 获取状态信息
   */
  getStatus() {
    return {
      tapeLength: this.tape.length,
      indexSize: Object.keys(this.index).length,
      lastTurnId: this.tape.length > 0 ? this.tape[this.tape.length - 1].id : 0,
      lastTurnTime: this.tape.length > 0 ? this.tape[this.tape.length - 1].timestamp : 0
    }
  }

  /**
   * 按日期范围删除记忆
   * @param {number} startTime 开始时间戳
   * @param {number} endTime 结束时间戳
   * @returns {object} 删除结果
   */
  deleteByDateRange(startTime, endTime) {
    const beforeCount = this.tape.length
    const deletedTurns = this.tape.filter(t => t.timestamp >= startTime && t.timestamp <= endTime)
    const deletedIds = new Set(deletedTurns.map(t => t.id))

    // 过滤掉指定范围内的记录
    this.tape = this.tape.filter(t => t.timestamp < startTime || t.timestamp > endTime)

    // 重建索引
    this._rebuildIndex()

    this._saveTape()
    this._saveIndex()

    const deletedCount = beforeCount - this.tape.length
    console.log(`[Memory] 按日期范围删除了 ${deletedCount} 条记录`)

    return {
      success: true,
      deletedCount,
      remainingCount: this.tape.length,
      deletedIds: Array.from(deletedIds)
    }
  }

  /**
   * 删除指定ID的记忆
   * @param {number[]} ids 要删除的turn ID数组
   * @returns {object} 删除结果
   */
  deleteByIds(ids) {
    const idSet = new Set(ids)
    const beforeCount = this.tape.length

    this.tape = this.tape.filter(t => !idSet.has(t.id))

    // 重建索引
    this.index = {}
    for (const turn of this.tape) {
      this._updateIndex(turn)
    }

    this._saveTape()
    this._saveIndex()

    const deletedCount = beforeCount - this.tape.length
    console.log(`[Memory] 按ID删除了 ${deletedCount} 条记录`)

    return {
      success: true,
      deletedCount,
      remainingCount: this.tape.length
    }
  }
}

module.exports = { MemorySystem }
