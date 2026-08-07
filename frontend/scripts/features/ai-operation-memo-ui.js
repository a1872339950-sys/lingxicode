(function () {
  const pendingByProject = new Map()
  let deps = {}

  function getActiveProjectId() {
    return deps.getActiveProjectId?.() || window.ProjectStore?.getActiveProjectId?.() || ''
  }

  function showToast(message, type = 'info') {
    if (deps.showToast) return deps.showToast(message, type)
    if (window.showToast) return window.showToast(message, type)
  }

  function getStatsText(memo = {}) {
    const stats = memo.stats || {}
    const commandCount = Array.isArray(memo.commands) ? memo.commands.length : 0
    const commandText = commandCount ? ` · 命令 ${commandCount}` : ''
    return `修改 ${Number(stats.modified || 0)} · 新增 ${Number(stats.created || 0)} · 删除 ${Number(stats.deleted || 0)}${commandText}`
  }

  function escapeHtml(value = '') {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function buildBackfillPrompt(memo = {}) {
    const files = Array.isArray(memo.files) ? memo.files : []
    const commands = Array.isArray(memo.commands) ? memo.commands : []
    const fileLines = files.slice(0, 20).map(file => {
      const status = file.status || 'modified'
      return `- ${status}: ${file.path || ''} (+${Number(file.additions || 0)} / -${Number(file.deletions || 0)})`
    }).join('\n')
    const more = files.length > 20 ? `\n- 还有 ${files.length - 20} 个文件未展开。` : ''
    const commandLines = commands.slice(0, 10).map(command => {
      const cwd = command.cwd ? ` (cwd: ${command.cwd})` : ''
      const kind = command.commandKind ? ` [${command.commandKind}]` : ''
      return `- ${command.command || ''}${cwd}${kind}`
    }).join('\n')
    const moreCommands = commands.length > 10 ? `\n- 还有 ${commands.length - 10} 条命令未展开。` : ''
    return [
      '【AI操作备忘录补录任务】',
      '',
      '本任务只允许补写 AI 操作备忘录，不要继续修改业务代码、配置或资源，也不要重做上一轮任务。',
      '请根据本轮变更记录、已改文件、最终回复摘要和必要的只读源码核对，调用 record_ai_operation_memo 补写备忘录；调用完成后再调用 start_final_reply，并用一句话说明已补录完成。',
      `调用 record_ai_operation_memo 时必须传 change_session_id: ${memo.changeSessionId || '未记录'}，这样后端会引用上一轮真实文件改动事实。`,
      '如果无法可靠确认模块、函数、行号或调用链，可以在 uncertainty / caution 中说明，不要编造。',
      '',
      `原始用户需求：${memo.userMessage || '未记录'}`,
      '',
      `上一轮最终回复摘要：${memo.finalSummary || '未记录'}`,
      '',
      `本轮变更会话：${memo.changeSessionId || '未记录'}`,
      '',
      '本轮文件改动：',
      fileLines || '- 未采集到逐文件快照。',
      more,
      '',
      '本轮修改命令：',
      commandLines || '- 未记录修改命令。',
      moreCommands
    ].join('\n')
  }

  function renderSavedNotice(memo = {}) {
    showToast(`AI 操作备忘录已保存：${memo.relativePath || memo.filePath || memo.id}`, 'success')
    window.AiMemoChatRail?.refresh?.()
  }

  async function saveMemo(memo = {}) {
    const result = await window.api?.saveAiOperationMemoDraft?.(memo.projectPath, memo.id)
    if (!result?.success) {
      showToast(result?.error || '备忘录保存失败', 'error')
      return false
    }
    pendingByProject.delete(memo.projectId || '')
    renderSavedNotice(result)
    return true
  }

  async function deleteMemo(memo = {}) {
    const result = await window.api?.deleteAiOperationMemoDraft?.(memo.projectPath, memo.id)
    if (!result?.success) {
      showToast(result?.error || '备忘录草稿删除失败', 'error')
      return false
    }
    pendingByProject.delete(memo.projectId || '')
    showToast('已删除本次 AI 操作备忘录草稿', 'info')
    window.AiMemoChatRail?.refresh?.()
    return true
  }

  function showPrompt(memo = {}) {
    if (!memo?.id || !memo.projectPath) return
    if (memo.status === 'saved' || memo.autoSaved) {
      renderSavedNotice(memo)
      return
    }
    if (!window.HandoffConfirmationQueue?.enqueue) return
    window.HandoffConfirmationQueue.enqueue({
      id: `memo:${memo.projectId || ''}:${memo.id}`,
      type: 'ai-operation-memo',
      projectId: memo.projectId || '',
      className: 'ai-operation-memo-handoff',
      visual: 'memo-logo',
      title: '本次 AI 操作已生成开发备忘录，是否保存到项目发展史？',
      meta: getStatsText(memo),
      actions: [
        { id: 'save', label: '保存', kind: 'primary', visualState: 'save', handler: () => saveMemo(memo) },
        { id: 'delete', label: '不保存', kind: 'secondary', visualState: 'dismiss', handler: () => deleteMemo(memo) }
      ]
    })
  }

  async function requestBackfill(memo = {}) {
    if (!window.sendMessage) {
      showToast('当前发送链路不可用，无法发起备忘录补录任务', 'error')
      return false
    }
    pendingByProject.delete(memo.projectId || '')
    await window.sendMessage({
      aiMessage: buildBackfillPrompt(memo),
      displayMessage: '补写 AI 操作备忘录',
      hideInChat: true
    })
    showToast('已让模型补写 AI 操作备忘录', 'info')
    return true
  }

  function showBackfillPrompt(memo = {}) {
    if (!window.HandoffConfirmationQueue?.enqueue) return
    const files = Array.isArray(memo.files) ? memo.files : []
    const commands = Array.isArray(memo.commands) ? memo.commands : []
    const filePreview = files.slice(0, 3).map(file => `<span>${escapeHtml(file.path || '')}</span>`).join('')
    const commandPreview = !filePreview
      ? commands.slice(0, 2).map(command => `<span>${escapeHtml(command.command || '')}</span>`).join('')
      : ''
    const skipBackfill = () => {
      pendingByProject.delete(memo.projectId || '')
      return true
    }
    window.HandoffConfirmationQueue.enqueue({
      id: `memo-backfill:${memo.projectId || ''}:${memo.requestId || memo.changeSessionId || Date.now()}`,
      type: 'ai-operation-memo-backfill',
      projectId: memo.projectId || '',
      className: 'ai-operation-memo-handoff ai-operation-memo-backfill-handoff',
      visual: 'memo-logo',
      title: '本轮修改了项目文件，但模型没有手写 AI 操作备忘录。是否让它补上？',
      meta: getStatsText(memo),
      bodyHtml: filePreview || commandPreview,
      actions: [
        { id: 'backfill', label: '补上', kind: 'primary', handler: () => requestBackfill(memo) },
        { id: 'skip', label: '不用管', kind: 'secondary', handler: skipBackfill }
      ]
    })
  }

  function handleMemoPayload(memo = {}) {
    if (!memo || memo.skipped) return
    if (memo.success === false) {
      showToast(memo.error || 'AI 操作备忘录生成失败', 'warning')
      return
    }
    if (memo.needsModelBackfill) {
      const projectId = memo.projectId || ''
      if (projectId && projectId !== getActiveProjectId()) {
        pendingByProject.set(projectId, memo)
        return
      }
      showBackfillPrompt(memo)
      return
    }
    if (memo.autoSaved || memo.status === 'saved') {
      const projectId = memo.projectId || ''
      if (projectId && projectId !== getActiveProjectId()) {
        pendingByProject.set(projectId, memo)
        return
      }
      renderSavedNotice(memo)
      return
    }
    const projectId = memo.projectId || ''
    if (projectId && projectId !== getActiveProjectId()) {
      pendingByProject.set(projectId, memo)
      return
    }
    showPrompt(memo)
  }

  function showPendingForActiveProject() {
    const projectId = getActiveProjectId()
    if (!projectId || !pendingByProject.has(projectId)) return
    const memo = pendingByProject.get(projectId)
    pendingByProject.delete(projectId)
    if (memo?.autoSaved || memo?.status === 'saved') {
      renderSavedNotice(memo)
    } else if (memo?.needsModelBackfill) {
      showBackfillPrompt(memo)
    } else {
      showPrompt(memo)
    }
  }

  function bind(nextDeps = {}) {
    deps = nextDeps || {}
    window.addEventListener('lingxi:active-project-changed', showPendingForActiveProject)
  }

  window.AiOperationMemoUI = {
    bind,
    handleMemoPayload,
    showPendingForActiveProject
  }
})()
