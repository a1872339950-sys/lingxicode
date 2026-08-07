/**
 * HTML工具函数集
 * 提供HTML转义、文本显示格式化等通用函数
 */
window.HtmlUtils = {
  /**
   * HTML特殊字符转义（支持null/undefined安全处理）
   * @param {*} value - 待转义的值
   * @returns {string}
   */
  escapeHtml(value) {
    const str = String(value == null ? '' : value)
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  },

  /**
   * 通过 ToolDisplay 获取国际化显示文本
   * @param {string} key - i18n key
   * @param {object|null} params - 替换参数
   * @returns {string}
   */
  displayText(key, params = null) {
    const ToolDisplay = window.ToolDisplayMetadata || {}
    return ToolDisplay.t ? ToolDisplay.t(key, params) : key
  },

  /**
   * 显示带数量的国际化文本
   * @param {string} key - i18n key
   * @param {number} count - 数量
   * @returns {string}
   */
  displayCount(key, count) {
    return this.displayText(key, { count })
  },

  /**
   * 文本截断（超长时追加截断提示）
   * @param {string} text - 待截断文本
   * @param {number} maxLength - 最大长度
   * @returns {string}
   */
  clipText(text, maxLength = 800) {
    const value = String(text || '').trim()
    if (!value) return ''
    return value.length > maxLength ? value.slice(0, maxLength) + this.displayText('toolDisplay.text.truncated') : value
  },

  /**
   * 格式化文件列表
   * @param {Array} files - 文件数组
   * @param {number} maxItems - 最大显示项数
   * @returns {string}
   */
  formatFileList(files, maxItems = 80) {
    if (!Array.isArray(files) || files.length === 0) return ''
    const rows = files.slice(0, maxItems).map(file => {
      if (typeof file === 'string') return file
      const label = file.type === 'directory' ? this.displayText('toolDisplay.text.directoryTag') : this.displayText('toolDisplay.text.fileTag')
      return `${label} ${file.name || file.path || ''}`
    })
    if (files.length > maxItems) rows.push(this.displayCount('toolDisplay.text.moreItems', files.length - maxItems))
    return rows.join('\n')
  },

  /**
   * 格式化搜索结果匹配项
   * @param {Array} matches - 匹配结果数组
   * @param {number} maxItems - 最大显示项数
   * @returns {string}
   */
  formatMatches(matches, maxItems = 20) {
    if (!Array.isArray(matches) || matches.length === 0) return ''
    return matches.slice(0, maxItems).map(match => {
      if (typeof match === 'string') return match
      const file = match.file || match.path || ''
      const line = match.line || match.lineNumber || ''
      const text = match.text || match.content || ''
      return `${file}${line ? ':' + line : ''}${text ? '  ' + text : ''}`
    }).join('\n')
  },

  /**
   * 格式化搜索候选结果
   * @param {object} result - 搜索结果对象
   * @param {number} maxItems - 最大显示项数
   * @returns {string}
   */
  formatSearchCandidates(result = {}, maxItems = 8) {
    const candidates = Array.isArray(result.candidates) ? result.candidates : []
    const files = Array.isArray(result.files) ? result.files : []
    const rows = []
    const seen = new Set()
    const addRow = row => {
      const text = String(row || '').trim()
      if (!text) return
      const key = text.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      rows.push(text)
    }
    const formatRange = item => {
      const start = item.start_line || item.startLine || item.line || ''
      const end = item.end_line || item.endLine || ''
      if (start && end) return `:${start}-${end}`
      if (start) return `:${start}`
      return ''
    }

    if (result.quality && typeof result.quality === 'object') {
      const quality = result.quality
      const timing = result.timings && typeof result.timings === 'object'
        ? ` time:${Math.round(Number(result.timings.totalMs || result.timings.fastMs || 0))}ms`
        : ''
      const mode = result.mode ? ` mode:${result.mode}` : ''
      addRow(`${this.displayText('toolDisplay.text.quality')} ${quality.level || 'unknown'} score:${Math.round(Number(quality.score || 0))} evidence:${quality.evidenceCount || 0}${timing}${mode}`)
    }

    addRow(result.summary || '')
    if (result.next_action || result.nextAction) addRow(`${this.displayText('toolDisplay.text.nextStep')} ${result.next_action || result.nextAction}`)

    if (candidates.length || files.length) addRow(this.displayText('toolDisplay.text.candidateFiles'))
    candidates.slice(0, maxItems).forEach((item, index) => {
      const sources = Array.isArray(item.sources) && item.sources.length ? ` [${item.sources.join('+')}]` : ''
      const score = Number.isFinite(Number(item.score)) ? ` score:${Math.round(Number(item.score))}` : ''
      addRow(`${index + 1}. ${item.path || item.file || ''}${sources}${score}`)
    })
    if (!candidates.length) {
      files.slice(0, maxItems).forEach((item, index) => {
        const filePath = typeof item === 'string' ? item : (item.path || item.file || item.name || '')
        if (filePath) addRow(`${index + 1}. ${filePath}`)
      })
    }

    if (Array.isArray(result.readHints) && result.readHints.length) {
      addRow('')
      addRow(this.displayText('toolDisplay.text.suggestedReads'))
      result.readHints.slice(0, 6).forEach(item => {
        addRow(`- ${item.path || ''}${formatRange(item)}${item.reason ? `  ${String(item.reason).slice(0, 80)}` : ''}`)
      })
    }

    if (Array.isArray(result.focusedSnippets) && result.focusedSnippets.length) {
      addRow('')
      addRow(this.displayText('toolDisplay.text.snippets'))
      result.focusedSnippets.slice(0, 5).forEach(item => {
        const reason = String(item.reason || item.preview || item.content || '').replace(/\s+/g, ' ').slice(0, 100)
        addRow(`- ${item.path || ''}${formatRange(item)}${reason ? `  ${reason}` : ''}`)
      })
    }

    if (Array.isArray(result.grep) && result.grep.length) {
      addRow('')
      addRow(this.displayText('toolDisplay.text.fullMatches'))
      result.grep.slice(0, 5).forEach(item => {
        addRow(`- ${item.path || ''}:${item.line || '?'} ${String(item.preview || item.content || '').replace(/\s+/g, ' ').slice(0, 100)}`)
      })
    }

    return rows.join('\n').trim()
  },

  /**
   * 格式化路径查找失败详情
   * @param {object} result - 失败结果对象
   * @returns {string}
   */
  formatPathFailureDetail(result = {}) {
    const lines = []
    if (result.error) lines.push(result.error)
    if (result.error_type) lines.push(`error_type: ${result.error_type}`)
    if (result.requested_path) lines.push(`requested_path: ${result.requested_path}`)
    if (result.resolved_path) lines.push(`resolved_path: ${result.resolved_path}`)
    if (result.project_root) lines.push(`project_root: ${result.project_root}`)
    if (result.diagnosis && typeof result.diagnosis === 'object') {
      const diagnosis = result.diagnosis
      if (diagnosis.category) lines.push(`diagnosis: ${diagnosis.category}`)
      if (diagnosis.failed_stage) lines.push(`failed_stage: ${diagnosis.failed_stage}`)
      if (diagnosis.current_page?.url) lines.push(`current_page: ${diagnosis.current_page.url}`)
      if (diagnosis.current_page) {
        const page = diagnosis.current_page
        lines.push(`page_state: ready=${page.readyState || '?'} text=${page.bodyTextLength ?? '?'} interactive=${page.interactiveElementCount ?? '?'}`)
      }
      if (diagnosis.summary && diagnosis.summary !== result.error) lines.push(`reason: ${diagnosis.summary}`)
      const blocker = diagnosis.blocking_evidence || {}
      if (blocker.hiddenBy) lines.push(`hidden_by: ${JSON.stringify(blocker.hiddenBy)}`)
      if (blocker.clippingAncestor) lines.push(`clipped_by: ${JSON.stringify(blocker.clippingAncestor)}`)
      if (blocker.occludedBy) lines.push(`occluded_by: ${JSON.stringify(blocker.occludedBy)}`)
      const candidates = Array.isArray(diagnosis.click_candidates) && diagnosis.click_candidates.length
        ? diagnosis.click_candidates
        : Array.isArray(diagnosis.nearby_candidates) ? diagnosis.nearby_candidates : []
      if (candidates.length) {
        lines.push('candidates:')
        candidates.slice(0, 8).forEach((item, index) => {
          lines.push(`${index + 1}. ${item.selector || item.id || item.role || '?'} ${item.name || ''}`.trim())
        })
      }
    }
    if (result.next_action) lines.push(`next_action: ${result.next_action}`)
    if (result.retry_policy) lines.push(`retry_policy: ${result.retry_policy}`)
    if (Array.isArray(result.nearest_candidates) && result.nearest_candidates.length) {
      lines.push('')
      lines.push('nearest_candidates:')
      result.nearest_candidates.slice(0, 8).forEach((item, index) => {
        const label = item.relativePath || item.path || ''
        const reasons = Array.isArray(item.reasons) && item.reasons.length ? ` (${item.reasons.join(', ')})` : ''
        lines.push(`${index + 1}. ${label}${reasons}`)
      })
    }
    return lines.join('\n')
  },

  /**
   * 获取完整文件路径（相对路径拼接项目根路径）
   * @param {string} filePath - 文件路径
   * @param {string} projectPath - 项目根路径
   * @returns {string}
   */
  getFullFilePath(filePath, projectPath) {
    if (!filePath || /^[A-Z]:/i.test(filePath)) return filePath
    return projectPath ? projectPath + '\\' + String(filePath).replace(/\//g, '\\') : filePath
  }
}
