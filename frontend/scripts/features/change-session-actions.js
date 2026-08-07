(function () {
  const escapeHtml = HtmlUtils.escapeHtml

  function getFileName(filePath) {
    const parts = String(filePath || '').split(/[\\/]/)
    return parts.slice(-2).join('/') || filePath
  }

  function hasChanges(session) {
    return !!(session && (session.fileCount || session.mutatingCommandCount))
  }

  function buildGitSafetyText(session) {
    const safety = session?.gitSafety || {}
    if (!safety.before && !safety.after) return ''
    const parts = []
    if (safety.before?.success) {
      parts.push(safety.before.skipped ? '修改前已有恢复点' : '已保存修改前恢复点')
    } else if (safety.before?.error) {
      parts.push('修改前恢复点失败')
    }
    if (safety.after?.success) {
      parts.push(safety.after.skipped ? '完成后无新增恢复点' : '已保存完成后恢复点')
    } else if (safety.after?.error) {
      parts.push('完成后恢复点失败')
    }
    return parts.join('，')
  }

  function getSnapshotHash(snapshot) {
    return String(snapshot?.hash || '').trim()
  }

  function generate(session) {
    if (!hasChanges(session)) return ''

    const encodedSession = encodeURIComponent(session.id)
    const beforeHash = getSnapshotHash(session.gitSafety?.before)
    const afterHash = getSnapshotHash(session.gitSafety?.after)
    const gitSafetyText = buildGitSafetyText(session)
    const commandWarning = session.mutatingCommandCount
      ? '命令可能改动额外文件，回退只还原已记录的文件。'
      : ''
    const tipText = [gitSafetyText, commandWarning].filter(Boolean).join('；')

    // 四个审核操作始终并排显示在原“撤销/审核”位置；无恢复点时禁用但占位
    const viewDiffBtn = afterHash
      ? `<button type="button" class="summary-chip-btn action" data-hash="${escapeHtml(afterHash)}" onclick="viewSafetySnapshotDiff(this)" title="查看完成后恢复点改动">查看恢复点改动</button>`
      : '<button type="button" class="summary-chip-btn action is-disabled" disabled title="当前没有完成后恢复点">查看恢复点改动</button>'
    const hardResetBtn = beforeHash
      ? `<button type="button" class="summary-chip-btn action critical" data-hash="${escapeHtml(beforeHash)}" onclick="restoreSafetySnapshot(this)" title="硬重置到本轮 AI 改前快照">硬重置工作区</button>`
      : '<button type="button" class="summary-chip-btn action critical is-disabled" disabled title="当前没有改前恢复点">硬重置工作区</button>'

    const actionButtons = [
      '<button type="button" class="summary-chip-btn action" onclick="repairChangeSession(this)" title="自动复查修复">自动复查修复</button>',
      '<button type="button" class="summary-chip-btn action danger" onclick="rollbackChangeSession(this)" title="只撤销本轮 AI 改动；保留之后的修改，重叠时停止且不覆盖">仅回退本次改动</button>',
      viewDiffBtn,
      hardResetBtn
    ].join('')

    return [
      `<div class="summary-actions compact" data-session-id="${encodedSession}">`,
      '<div class="summary-top-actions">',
      actionButtons,
      '</div>',
      tipText ? `<div class="summary-action-tip">${escapeHtml(tipText)}</div>` : '',
      '<div class="summary-action-status"></div>',
      '</div>'
    ].join('')
  }

  function closeAllMenus(exceptMenu = null) {
    document.querySelectorAll('.summary-action-menu').forEach(menu => {
      if (exceptMenu && menu === exceptMenu) return
      menu.hidden = true
      const trigger = menu.parentElement?.querySelector('.summary-chip-btn.review')
      if (trigger) trigger.setAttribute('aria-expanded', 'false')
    })
  }

  function toggleSummaryActionMenu(event, button) {
    try {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      const wrap = button?.closest?.('.summary-review-wrap')
      const menu = wrap?.querySelector?.('.summary-action-menu')
      if (!menu) return
      const willOpen = menu.hidden
      closeAllMenus(willOpen ? menu : null)
      menu.hidden = !willOpen
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
    } catch (_err) { /* noop */ }
  }

  function bind(options = {}) {
    const api = options.api
    const getActiveProject = options.getActiveProject || function () { return null }
    const sendPrompt = options.sendPrompt || function () {}
    const showToast = options.showToast || function () {}
    const refreshProject = options.refreshProject || function () {}

    function getProjectId() {
      return getActiveProject()?.id || null
    }

    function getSessionIdFromButton(button) {
      const box = button?.closest?.('.summary-actions')
      if (!box) return null
      return decodeURIComponent(box.dataset.sessionId || '')
    }

    function getSnapshotHashFromButton(button) {
      return String(button?.dataset?.hash || '').trim()
    }

    function setStatus(button, text, type = '') {
      const statusEl = button?.closest?.('.summary-actions')?.querySelector('.summary-action-status')
      if (!statusEl) return
      statusEl.textContent = text || ''
      statusEl.className = `summary-action-status ${type}`.trim()
    }

    async function promptFromSession(button, mode) {
      const projectId = getProjectId()
      const sessionId = getSessionIdFromButton(button)
      if (!projectId || !sessionId || !api?.buildChangeSessionPrompt) {
        showToast('找不到本次修改记录', 'error')
        return
      }

      closeAllMenus()
      setStatus(button, mode === 'repair' ? '正在准备自动修复...' : '正在准备审查内容...')
      const result = await api.buildChangeSessionPrompt(projectId, sessionId, mode)
      if (!result?.success || !result.prompt) {
        setStatus(button, result?.error || '准备失败', 'error')
        showToast(result?.error || '准备失败', 'error')
        return
      }

      setStatus(button, '')
      sendPrompt(result.prompt)
    }

    async function rollback(button) {
      const projectId = getProjectId()
      const sessionId = getSessionIdFromButton(button)
      if (!projectId || !sessionId || !api?.rollbackChangeSession) {
        showToast('找不到本次修改记录', 'error')
        return
      }

      closeAllMenus()
      const confirmed = window.confirm('确认仅撤销本次 AI 改动吗？系统会保留之后由你或外部软件做出的修改；如果改动位置重叠，将停止回退且不会覆盖任何文件。')
      if (!confirmed) return

      const setProgress = (percent) => {
        const value = Math.max(0, Math.min(100, Number(percent) || 0))
        setStatus(button, `回退中，进度为 ${value}%`)
      }
      const unsubscribe = api.onChangeSessionRollbackProgress?.((data = {}) => {
        if (data.projectId !== projectId || data.sessionId !== sessionId) return
        setProgress(data.percent)
      })

      try {
        setProgress(0)
        const result = await api.rollbackChangeSession(projectId, sessionId, false)

        if (result?.conflict) {
          const conflictText = (result.conflicts || []).map(item => `${getFileName(item.path)}：${item.reason}`).join('\n')
          const message = `发现与 AI 改动重叠的后续修改，已停止回退，没有覆盖任何文件。\n\n${conflictText}`
          setStatus(button, '存在冲突，未修改任何文件', 'warning')
          showToast(message, 'warning', 8000)
          return
        }

        if (!result?.success) {
          setStatus(button, result?.error || '回退失败', 'error')
          showToast(result?.error || '回退失败', 'error')
          return
        }

        const count = result.rolledBack?.length || 0
        setStatus(button, `已回退 ${count} 个文件`, 'success')
        showToast(`已回退 ${count} 个文件`, 'success')
        refreshProject()
      } finally {
        if (typeof unsubscribe === 'function') unsubscribe()
      }
    }

    async function viewSnapshotDiff(button) {
      const project = getActiveProject()
      const hash = getSnapshotHashFromButton(button)
      if (!project?.path || !hash || !api?.gitDiffCommit) {
        showToast('找不到恢复点', 'error')
        return
      }
      closeAllMenus()
      setStatus(button, '正在读取恢复点改动...')
      const result = await api.gitDiffCommit(project.path, hash)
      if (!result?.success) {
        setStatus(button, result?.error || '读取失败', 'error')
        showToast(result?.error || '读取失败', 'error')
        return
      }
      setStatus(button, '已打开恢复点改动', 'success')
      if (window.GitPanel?.openDiffPreview) {
        window.GitPanel.openDiffPreview(hash, result.diff || '无改动内容')
      } else {
        AppLogger.debug('[GitSafety] diff', hash, result.diff)
      }
    }

    async function restoreSnapshot(button) {
      const project = getActiveProject()
      const hash = getSnapshotHashFromButton(button)
      if (!project?.path || !hash || !api?.gitReset) {
        showToast('找不到恢复点', 'error')
        return
      }
      closeAllMenus()
      const confirmed = window.confirm('确认要硬重置整个工作区吗？\n\n这会用 git 把项目回到本轮 AI 开始之前的快照——不只是 AI 改过的文件，你之后手动改的所有内容都会被一起覆盖，未提交的改动会丢失。\n\n如果你只想撤销 AI 这一轮改动，请用“仅回退本次改动”。')
      if (!confirmed) return
      setStatus(button, '正在硬重置工作区到改前快照...')
      const result = await api.gitReset(project.path, hash)
      if (!result?.success) {
        setStatus(button, result?.error || '恢复失败', 'error')
        showToast(result?.error || '恢复失败', 'error')
        return
      }
      setStatus(button, '已硬重置工作区到改前快照', 'success')
      showToast('已恢复到 AI 修改前', 'success')
      refreshProject()
    }

    if (!window.__summaryActionMenuDocBound) {
      window.__summaryActionMenuDocBound = true
      document.addEventListener('click', (event) => {
        if (event.target?.closest?.('.summary-review-wrap')) return
        closeAllMenus()
      })
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeAllMenus()
      })
    }

    return {
      generate,
      repair: button => promptFromSession(button, 'repair'),
      rollback,
      viewSnapshotDiff,
      restoreSnapshot
    }
  }

  window.toggleSummaryActionMenu = toggleSummaryActionMenu
  window.ChangeSessionActions = { bind, generate }
})()
