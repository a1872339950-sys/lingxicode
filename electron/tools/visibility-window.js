/**
 * 可见窗口管理模块
 * - 管理 visibleStartIndex（AI可见边界）
 * - 控制哪些消息对AI可见
 * - 计算需要移除的token数量
 */

const fs = require('fs')
const path = require('path')

class VisibilityWindow {
  /**
   * @param {string} storagePath 存储目录（项目独立）
   * @param {object} config 配置选项
   */
  constructor(storagePath, config = {}, options = {}) {
    this.storagePath = storagePath
    this.windowPath = path.join(storagePath, 'visibility.json')

    // 可见边界索引
    this.visibleStartIndex = 0  // AI可见起始索引（此索引之前的消息对AI不可见）

    // 配置
    this.config = {
      maxTokensRatio: 0.8,      // 上下文上限比例（留20%给响应）
      minVisibleTurns: 5,       // 最少保留5轮对话可见
      warningThreshold: 0.7,    // 超过70%时发出警告
      ...config
    }

    if (!options.deferredInit) {
      this._init()
    }
  }

  /**
   * 异步初始化（用于 deferredInit 模式）
   */
  async ensureInitAsync() {
    await fs.promises.mkdir(this.storagePath, { recursive: true }).catch(() => {})
    await this._loadWindowAsync()
    console.log('[VisibilityWindow] 异步初始化完成，可见起始索引:', this.visibleStartIndex)
  }

  async _loadWindowAsync() {
    try {
      const data = await fs.promises.readFile(this.windowPath, 'utf-8')
      const saved = JSON.parse(data)
      this.visibleStartIndex = saved.visibleStartIndex || 0
    } catch {
      this.visibleStartIndex = 0
    }
  }

  /**
   * 初始化：加载已有状态
   */
  _init() {
    // 确保目录存在
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true })
    }

    // 加载可见窗口状态
    this._loadWindow()

    console.log('[VisibilityWindow] 初始化完成，可见起始索引:', this.visibleStartIndex)
  }

  /**
   * 加载窗口状态
   */
  _loadWindow() {
    try {
      if (fs.existsSync(this.windowPath)) {
        const data = fs.readFileSync(this.windowPath, 'utf-8')
        const saved = JSON.parse(data)
        this.visibleStartIndex = saved.visibleStartIndex || 0
      }
    } catch (e) {
      console.error('[VisibilityWindow] 加载状态失败:', e.message)
      this.visibleStartIndex = 0
    }
  }

  /**
   * 保存窗口状态
   */
  _saveWindow() {
    try {
      const data = {
        visibleStartIndex: this.visibleStartIndex,
        timestamp: Date.now(),
        config: this.config
      }
      fs.writeFileSync(this.windowPath, JSON.stringify(data, null, 2))
    } catch (e) {
      console.error('[VisibilityWindow] 保存状态失败:', e.message)
    }
  }

  _toPlainText(content) {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map(part => {
        if (typeof part === 'string') return part
        if (part?.type === 'text') return part.text || ''
        if (part?.type === 'image_url') return '[image]'
        return ''
      }).join('\n')
    }
    try {
      return JSON.stringify(content)
    } catch (e) {
      return String(content)
    }
  }

  // ==================== 核心功能 ====================

  /**
   * 检查是否需要调整窗口
   * @param {number} totalTokens 当前总token数
   * @param {number} modelLimit 模型上下文上限
   * @returns {object} { needed, warning, currentRatio }
   */
  shouldAdjust(totalTokens, modelLimit) {
    const maxAllowed = modelLimit * this.config.maxTokensRatio
    const currentRatio = totalTokens / modelLimit
    const warningRatio = this.config.warningThreshold

    return {
      needed: totalTokens > maxAllowed,
      warning: currentRatio > warningRatio,
      currentRatio,
      maxAllowed,
      margin: maxAllowed - totalTokens
    }
  }

  /**
   * 计算新边界
   * @param {array} history 完整历史消息
   * @param {number} currentTokens 当前token数
   * @param {number} modelLimit 模型上限
   * @returns {number} 新的 visibleStartIndex
   */
  calculateBoundary(history, currentTokens, modelLimit) {
    if (!history || history.length === 0) return this.visibleStartIndex

    const maxAllowed = modelLimit * this.config.maxTokensRatio
    const tokensToRemove = currentTokens - maxAllowed

    if (tokensToRemove <= 0) return this.visibleStartIndex

    // 估算每条消息的token数（简单估算：每4字符≈1token）
    let removedTokens = 0
    let newIndex = this.visibleStartIndex

    // 从当前边界开始向前移除
    while (removedTokens < tokensToRemove && newIndex < history.length - this.config.minVisibleTurns) {
      const msg = history[newIndex]
      if (msg) {
        // 估算消息token
        const content = this._toPlainText(msg.content)
        const msgTokens = Math.ceil(content.length / 4) + 10  // +10为消息结构开销
        removedTokens += msgTokens
      }
      newIndex++
    }

    // 确保保留最少可见轮数
    const minIndex = Math.max(0, history.length - this.config.minVisibleTurns)
    newIndex = Math.min(newIndex, minIndex)

    return newIndex
  }

  /**
   * 移动边界
   * @param {number} newIndex 新的起始索引
   * @returns {object} 移动结果
   */
  shiftBoundary(newIndex) {
    const oldIndex = this.visibleStartIndex
    const moved = newIndex - oldIndex

    if (moved > 0) {
      this.visibleStartIndex = newIndex
      this._saveWindow()

      console.log('[VisibilityWindow] 边界移动:', oldIndex, '→', newIndex, '（隐藏了', moved, '条消息）')

      return {
        success: true,
        oldIndex,
        newIndex,
        moved,
        message: `已隐藏 ${moved} 条历史消息，AI将不可见这些内容`
      }
    }

    return {
      success: false,
      oldIndex,
      newIndex,
      moved: 0,
      message: '边界未变化'
    }
  }

  /**
   * 获取AI可见的消息
   * @param {array} fullHistory 完整历史
   * @returns {array} 可见消息片段
   */
  getVisibleMessages(fullHistory) {
    if (!fullHistory || fullHistory.length === 0) return []
    return fullHistory.slice(this.visibleStartIndex)
  }

  /**
   * 获取AI不可见的消息
   * @param {array} fullHistory 完整历史
   * @returns {array} 不可见消息片段
   */
  getInvisibleMessages(fullHistory) {
    if (!fullHistory || fullHistory.length === 0) return []
    return fullHistory.slice(0, this.visibleStartIndex)
  }

  /**
   * 重置边界（让所有消息可见）
   */
  resetBoundary() {
    this.visibleStartIndex = 0
    this._saveWindow()
    console.log('[VisibilityWindow] 边界已重置，所有消息对AI可见')
  }

  // ==================== 状态信息 ====================

  /**
   * 获取状态信息
   */
  getStatus() {
    return {
      visibleStartIndex: this.visibleStartIndex,
      config: this.config,
      storagePath: this.storagePath
    }
  }

  /**
   * 获取可见边界索引
   */
  getBoundary() {
    return this.visibleStartIndex
  }

  /**
   * 计算历史消息的可见性统计
   * @param {array} history 完整历史
   */
  getVisibilityStats(history) {
    if (!history) return null

    const total = history.length
    const visible = total - this.visibleStartIndex
    const invisible = this.visibleStartIndex
    const visibleRatio = total > 0 ? visible / total : 1

    return {
      total,
      visible,
      invisible,
      visibleRatio,
      visibleStartIndex: this.visibleStartIndex
    }
  }
}

module.exports = { VisibilityWindow }
