/**
 * 行为摘要模块
 * - 只压缩AI的行为，不压缩发言内容
 * - 提取：已完成、进行中、待办、文件改动、问题、决策
 */

const fs = require('fs')
const path = require('path')

class BehaviorSummary {
  /**
   * @param {string} storagePath 存储目录（项目独立）
   */
  constructor(storagePath, options = {}) {
    this.storagePath = storagePath
    this.summaryPath = path.join(storagePath, 'behavior-summary.json')

    // 摘要数据结构
    this.summary = {
      version: Date.now(),
      lastUpdateTurn: 0,
      completed: [],        // 已完成任务
      inProgress: [],       // 进行中任务
      pending: [],          // 待办事项
      filesCreated: [],     // 创建的文件
      filesModified: [],    // 修改的文件
      filesDeleted: [],     // 删除的文件
      issues: [],           // 遇到的问题
      issueResolved: [],    // 已解决的问题
      decisions: []         // 关键决策
    }

    // 配置
    this.config = {
      maxItems: 20,         // 每类最多保留20条
      updateInterval: 3     // 每3轮更新摘要
    }

    // 延迟保存：合并短时间内的多次写入
    this._saveTimer = null
    this._dirty = false
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
    await this._loadSummaryAsync()
    console.log('[BehaviorSummary] 异步初始化完成，已完成任务:', this.summary.completed.length)
  }

  async _loadSummaryAsync() {
    try {
      const data = await fs.promises.readFile(this.summaryPath, 'utf-8')
      this.summary = JSON.parse(data)
    } catch {
      // 使用默认结构
    }
  }

  /**
   * 初始化：加载已有摘要
   */
  _init() {
    // 确保目录存在
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true })
    }

    // 加载摘要
    this._loadSummary()

    console.log('[BehaviorSummary] 初始化完成，已完成任务:', this.summary.completed.length)
  }

  /**
   * 加载摘要
   */
  _loadSummary() {
    try {
      if (fs.existsSync(this.summaryPath)) {
        const data = fs.readFileSync(this.summaryPath, 'utf-8')
        this.summary = JSON.parse(data)
      }
    } catch (e) {
      console.error('[BehaviorSummary] 加载摘要失败:', e.message)
      // 使用默认结构
    }
  }

  /**
   * 延迟保存——合并短时间内的多次写入
   */
  _scheduleSave() {
    this._dirty = true
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this._flushSave()
    }, 500)
  }

  /**
   * 异步写入摘要到磁盘
   */
  async _flushSave() {
    if (this._writing) return
    this._writing = true
    try {
      if (this._dirty) {
        const json = JSON.stringify(this.summary, null, 2)
        await fs.promises.writeFile(this.summaryPath, json, 'utf-8')
        this._dirty = false
      }
    } catch (e) {
      console.error('[BehaviorSummary] 异步保存失败:', e.message)
    } finally {
      this._writing = false
    }
  }

  /**
   * 保存摘要（同步版本，仅用于 clear 等需要立即写入的场景）
   */
  _saveSummary() {
    try {
      fs.writeFileSync(this.summaryPath, JSON.stringify(this.summary, null, 2))
    } catch (e) {
      console.error('[BehaviorSummary] 保存摘要失败:', e.message)
    }
  }

  // ==================== 核心功能 ====================

  /**
   * 从工具调用记录中提取行为
   * @param {array} toolCallsRecord 工具调用记录
   * @param {number} turnId 当前Turn ID
   */
  extractFromToolCalls(toolCallsRecord, turnId) {
    if (!toolCallsRecord || toolCallsRecord.length === 0) return

    for (const tc of toolCallsRecord) {
      const { name, args, result } = tc

      // 根据工具类型提取行为
      switch (name) {
        case 'write_file':
          this._addFileAction('created', args.path, turnId, result?.success)
          break

        case 'edit_file':
          this._addFileAction('modified', args.path, turnId, result?.success)
          break

        case 'delete_file':
          this._addFileAction('deleted', args.path, turnId, result?.success)
          break

        case 'create_directory':
          this._addAction('completed', `创建目录: ${args.path}`, turnId, result?.success)
          break

        case 'run_command':
          if (result?.success) {
            this._addAction('completed', `执行命令: ${args.command}`, turnId, true)
          } else {
            this._addIssue(args.command, result?.error || '命令执行失败', turnId)
          }
          break

        case 'enter_plan_mode':
          this._addAction('inProgress', '进入计划模式', turnId, true)
          break

        case 'enter_auto_mode':
          if (result?.steps) {
            this._addAction('inProgress', `开始自动执行 (${result.steps.length}步)`, turnId, true)
            // 添加待办事项
            for (let i = 0; i < result.steps.length; i++) {
              this._addAction('pending', result.steps[i], turnId, false, i)
            }
          }
          break

        case 'complete_step':
          if (result?.success) {
            this._markStepCompleted(args.step_index, turnId)
          }
          break

        case 'read_file':
          // 读文件不记录为行为，但可能涉及决策
          break

        default:
          // 其他工具
          if (result?.success === false) {
            this._addIssue(name, result?.error || '操作失败', turnId)
          }
      }
    }

    // 更新版本
    this.summary.version = Date.now()
    this.summary.lastUpdateTurn = turnId

    // 去重和精简
    this._pruneSummary()

    // 保存
    this._scheduleSave()
  }

  /**
   * 从对话内容中提取关键信息
   * @param {string} userMessage 用户消息
   * @param {string} aiMessage AI回复
   * @param {number} turnId 当前Turn ID
   */
  extractFromContent(userMessage, aiMessage, turnId) {
    const content = userMessage + ' ' + (aiMessage || '')

    // 提取决策
    const decisionPatterns = [
      /决定|选择|采用|使用.*方案|方案是|就这样|用这个/gi,
      /确认使用|最终方案/gi
    ]
    for (const pattern of decisionPatterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const context = this._extractContext(content, match.index, 50)
        this._addDecision(context, turnId)
      }
    }

    // 提取需求/待办
    const pendingPatterns = [
      /需要|请帮我|要实现|想要|能不能|帮我|希望|需求/gi,
      /功能是|目标是|实现一个/gi
    ]
    for (const pattern of pendingPatterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(content)) !== null) {
        // 只在用户消息中提取待办
        if (userMessage.includes(match[0])) {
          const context = this._extractContext(userMessage, match.index, 80)
          // 检查是否已经完成（AI回复中包含完成标志）
          const completionMarkers = /完成了|已实现|解决了|可以了|成功|好了|没问题了/
          if (!completionMarkers.test(aiMessage || '')) {
            this._addAction('pending', context, turnId, false)
          }
        }
      }
    }

    // 提取问题
    const problemPatterns = [
      /报错|错误|bug|问题|不行|失败|不对|有问题/gi,
      /出错|无法|没成功|还是不行|有bug/gi
    ]
    for (const pattern of problemPatterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(content)) !== null) {
        const context = this._extractContext(content, match.index, 60)
        this._addIssue(match[0], context, turnId)
      }
    }

    // 提取完成标志
    const completionPatterns = [
      /完成了|已实现|解决了|可以了|成功|好了|没问题了/gi,
      /正常了|成功了|可以工作|已经完成/gi
    ]
    for (const pattern of completionPatterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(aiMessage || '')) !== null) {
        const context = this._extractContext(aiMessage, match.index, 50)
        // 尝试匹配之前的待办事项
        this._tryMatchPending(context, turnId)
      }
    }

    this._scheduleSave()
  }

  // ==================== 辅助方法 ====================

  /**
   * 添加文件操作
   */
  _addFileAction(action, filePath, turnId, success) {
    const item = {
      path: filePath,
      turn: turnId,
      timestamp: Date.now(),
      success: success
    }

    const targetArray = action === 'created' ? this.summary.filesCreated :
                        action === 'modified' ? this.summary.filesModified :
                        this.summary.filesDeleted

    // 避免重复
    const exists = targetArray.find(f => f.path === filePath)
    if (!exists) {
      targetArray.push(item)
    } else {
      // 更新时间戳
      exists.timestamp = Date.now()
      exists.turn = turnId
    }
  }

  /**
   * 添加行为
   */
  _addAction(type, description, turnId, success, stepIndex = null) {
    const item = {
      description,
      turn: turnId,
      timestamp: Date.now(),
      success,
      stepIndex
    }

    const targetArray = type === 'completed' ? this.summary.completed :
                        type === 'inProgress' ? this.summary.inProgress :
                        this.summary.pending

    // 检查是否已存在类似描述
    const exists = targetArray.find(a => a.description === description)
    if (!exists) {
      targetArray.push(item)
    }
  }

  /**
   * 添加问题
   */
  _addIssue(keyword, context, turnId) {
    const item = {
      keyword,
      context,
      turn: turnId,
      timestamp: Date.now(),
      resolved: false
    }

    // 避免重复
    const exists = this.summary.issues.find(i => i.context === context)
    if (!exists) {
      this.summary.issues.push(item)
    }
  }

  /**
   * 添加决策
   */
  _addDecision(context, turnId) {
    const item = {
      context,
      turn: turnId,
      timestamp: Date.now()
    }

    // 避免重复
    const exists = this.summary.decisions.find(d => d.context === context)
    if (!exists) {
      this.summary.decisions.push(item)
    }
  }

  /**
   * 标记步骤完成
   */
  _markStepCompleted(stepIndex, turnId) {
    // 从进行中移到已完成
    const pending = this.summary.pending.filter(p => p.stepIndex === stepIndex)
    for (const p of pending) {
      this.summary.completed.push({
        description: p.description,
        turn: turnId,
        timestamp: Date.now(),
        success: true
      })
    }
    // 从待办中移除
    this.summary.pending = this.summary.pending.filter(p => p.stepIndex !== stepIndex)
  }

  /**
   * 尝试匹配待办事项为已完成
   */
  _tryMatchPending(context, turnId) {
    // 查找相似的待办事项
    for (let i = this.summary.pending.length - 1; i >= 0; i--) {
      const p = this.summary.pending[i]
      // 简单匹配：如果完成上下文包含待办关键词
      if (context.includes(p.description.substring(0, 20))) {
        // 移到已完成
        this.summary.completed.push({
          description: p.description,
          turn: turnId,
          timestamp: Date.now(),
          success: true
        })
        // 从待办移除
        this.summary.pending.splice(i, 1)
      }
    }
  }

  /**
   * 提取上下文句子
   */
  _extractContext(content, pos, length) {
    const start = Math.max(0, pos - 20)
    const end = Math.min(content.length, pos + length)
    return content.substring(start, end).trim().substring(0, 100)
  }

  /**
   * 去重和精简
   */
  _pruneSummary() {
    // 每类最多保留 maxItems 条
    this.summary.completed = this.summary.completed.slice(-this.config.maxItems)
    this.summary.inProgress = this.summary.inProgress.slice(-this.config.maxItems)
    this.summary.pending = this.summary.pending.slice(-this.config.maxItems)
    this.summary.filesCreated = this.summary.filesCreated.slice(-this.config.maxItems)
    this.summary.filesModified = this.summary.filesModified.slice(-this.config.maxItems)
    this.summary.filesDeleted = this.summary.filesDeleted.slice(-this.config.maxItems)
    this.summary.issues = this.summary.issues.slice(-this.config.maxItems)
    this.summary.decisions = this.summary.decisions.slice(-this.config.maxItems)
  }

  // ==================== 输出格式 ====================

  /**
   * 格式化给AI
   */
  formatForAPI() {
    let text = '## 项目行为摘要\n\n'

    if (this.summary.completed.length > 0) {
      text += '### 已完成任务\n'
      this.summary.completed.forEach(c => {
        text += `- Turn ${c.turn}: ${c.description}\n`
      })
      text += '\n'
    }

    if (this.summary.inProgress.length > 0) {
      text += '### 进行中任务\n'
      this.summary.inProgress.forEach(p => {
        text += `- Turn ${p.turn}: ${p.description}\n`
      })
      text += '\n'
    }

    if (this.summary.pending.length > 0) {
      text += '### 待办事项\n'
      this.summary.pending.forEach(p => {
        text += `- Turn ${p.turn}: ${p.description}\n`
      })
      text += '\n'
    }

    const allFiles = [...this.summary.filesCreated, ...this.summary.filesModified, ...this.summary.filesDeleted]
    if (allFiles.length > 0) {
      text += '### 文件改动记录\n'
      if (this.summary.filesCreated.length > 0) {
        text += `- 创建: ${this.summary.filesCreated.map(f => f.path).join(', ')}\n`
      }
      if (this.summary.filesModified.length > 0) {
        text += `- 修改: ${this.summary.filesModified.map(f => f.path).join(', ')}\n`
      }
      if (this.summary.filesDeleted.length > 0) {
        text += `- 删除: ${this.summary.filesDeleted.map(f => f.path).join(', ')}\n`
      }
      text += '\n'
    }

    const unresolved = this.summary.issues.filter(i => !i.resolved)
    if (unresolved.length > 0) {
      text += '### 未解决的问题\n'
      unresolved.forEach(i => {
        text += `- Turn ${i.turn}: ${i.keyword} - ${i.context}\n`
      })
      text += '\n'
    }

    if (this.summary.decisions.length > 0) {
      text += '### 关键决策\n'
      this.summary.decisions.forEach(d => {
        text += `- Turn ${d.turn}: ${d.context}\n`
      })
      text += '\n'
    }

    return text
  }

  /**
   * 获取状态信息
   */
  getStatus() {
    return {
      completedCount: this.summary.completed.length,
      inProgressCount: this.summary.inProgress.length,
      pendingCount: this.summary.pending.length,
      filesCreatedCount: this.summary.filesCreated.length,
      filesModifiedCount: this.summary.filesModified.length,
      filesDeletedCount: this.summary.filesDeleted.length,
      issuesCount: this.summary.issues.length,
      decisionsCount: this.summary.decisions.length,
      lastUpdateTurn: this.summary.lastUpdateTurn
    }
  }

  /**
   * 清空摘要
   */
  clear() {
    this.summary = {
      version: Date.now(),
      lastUpdateTurn: 0,
      completed: [],
      inProgress: [],
      pending: [],
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      issues: [],
      issueResolved: [],
      decisions: []
    }
    this._scheduleSave()
    console.log('[BehaviorSummary] 已清空')
  }
}

module.exports = { BehaviorSummary }
