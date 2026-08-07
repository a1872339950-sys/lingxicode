(function () {
  const escapeHtml = HtmlUtils.escapeHtml

  function getElements() {
    return {
      gitPanel: document.getElementById('gitPanel'),
      gitPanelBack: document.getElementById('gitPanelBack'),
      gitSubnav: document.getElementById('gitSubnav'),
      gitSubnavButtons: Array.from(document.querySelectorAll('[data-git-view]')),
      gitViewSections: Array.from(document.querySelectorAll('[data-git-section]')),
      gitSubnavChangeCount: document.getElementById('gitSubnavChangeCount'),
      gitHistoryPanel: document.getElementById('gitHistoryPanel'),
      gitHistoryBack: document.getElementById('gitHistoryBack'),
      gitBranchPanel: document.getElementById('gitBranchPanel'),
      gitBranchBack: document.getElementById('gitBranchBack'),
      gitBranch: document.getElementById('gitBranch'),
      gitStatusBadge: document.getElementById('gitStatusBadge'),
      gitRemote: document.getElementById('gitRemote'),
      gitSyncStatus: document.getElementById('gitSyncStatus'),
      gitOverviewDashboard: document.getElementById('gitOverviewDashboard'),
      gitOverviewMessage: document.getElementById('gitOverviewMessage'),
      gitOverviewPendingCount: document.getElementById('gitOverviewPendingCount'),
      gitOverviewLatestPoint: document.getElementById('gitOverviewLatestPoint'),
      gitOverviewRecoveryCount: document.getElementById('gitOverviewRecoveryCount'),
      gitOverviewStorageSize: document.getElementById('gitOverviewStorageSize'),
      gitOverviewStorageProgress: document.getElementById('gitOverviewStorageProgress'),
      gitOverviewStoragePercent: document.getElementById('gitOverviewStoragePercent'),
      gitOverviewStorageDetail: document.getElementById('gitOverviewStorageDetail'),
      gitRefreshBtn: document.getElementById('gitRefreshBtn'),
      gitStepProject: document.getElementById('gitStepProject'),
      gitStepChanges: document.getElementById('gitStepChanges'),
      gitStepSnapshot: document.getElementById('gitStepSnapshot'),
      gitStepRollback: document.getElementById('gitStepRollback'),
      gitFileList: document.getElementById('gitFileList'),
      gitFileCount: document.getElementById('gitFileCount'),
      gitChangesSearch: document.getElementById('gitChangesSearch'),
      gitChangesType: document.getElementById('gitChangesType'),
      gitChangesDirectory: document.getElementById('gitChangesDirectory'),
      gitChangesSort: document.getElementById('gitChangesSort'),
      gitChangesRefreshBtn: document.getElementById('gitChangesRefreshBtn'),
      gitChangeStatButtons: Array.from(document.querySelectorAll('[data-change-filter]')),
      gitChangesTotal: document.getElementById('gitChangesTotal'),
      gitChangesUnstaged: document.getElementById('gitChangesUnstaged'),
      gitChangesConfig: document.getElementById('gitChangesConfig'),
      gitChangesProject: document.getElementById('gitChangesProject'),
      gitChangesSelectedCount: document.getElementById('gitChangesSelectedCount'),
      gitChangesSelectAll: document.getElementById('gitChangesSelectAll'),
      gitChangesStageBtn: document.getElementById('gitChangesStageBtn'),
      gitChangesCreateBtn: document.getElementById('gitChangesCreateBtn'),
      gitChangesIgnoreBtn: document.getElementById('gitChangesIgnoreBtn'),
      gitChangesPages: document.getElementById('gitChangesPages'),
      gitChangesPageSize: document.getElementById('gitChangesPageSize'),
      gitChangesDonut: document.getElementById('gitChangesDonut'),
      gitChangesDonutTotal: document.getElementById('gitChangesDonutTotal'),
      gitChangesConfigLegend: document.getElementById('gitChangesConfigLegend'),
      gitChangesProjectLegend: document.getElementById('gitChangesProjectLegend'),
      gitChangesOtherLegend: document.getElementById('gitChangesOtherLegend'),
      gitChangesQueueUnstaged: document.getElementById('gitChangesQueueUnstaged'),
      gitChangesQueueSelected: document.getElementById('gitChangesQueueSelected'),
      gitChangesQueuePending: document.getElementById('gitChangesQueuePending'),
      gitChangesQueueIgnored: document.getElementById('gitChangesQueueIgnored'),
      gitChangesOpenIgnored: document.getElementById('gitChangesOpenIgnored'),
      gitCommitInput: document.getElementById('gitCommitInput'),
      gitCommitSuggestion: document.getElementById('gitCommitSuggestion'),
      gitAiSuggestBtn: document.getElementById('gitAiSuggestBtn'),
      gitCommitBtn: document.getElementById('gitCommitBtn'),
      gitHistoryBtn: document.getElementById('gitHistoryBtn'),
      gitHistoryRefreshBtn: document.getElementById('gitHistoryRefreshBtn'),
      gitHistorySearch: document.getElementById('gitHistorySearch'),
      gitHistoryType: document.getElementById('gitHistoryType'),
      gitHistoryTime: document.getElementById('gitHistoryTime'),
      gitHistoryProject: document.getElementById('gitHistoryProject'),
      gitHistorySort: document.getElementById('gitHistorySort'),
      gitHistoryCreateBtn: document.getElementById('gitHistoryCreateBtn'),
      gitHistoryStatButtons: Array.from(document.querySelectorAll('[data-history-stat]')),
      gitHistoryTotal: document.getElementById('gitHistoryTotal'),
      gitHistoryTotalHint: document.getElementById('gitHistoryTotalHint'),
      gitHistoryFileCount: document.getElementById('gitHistoryFileCount'),
      gitHistoryGitCount: document.getElementById('gitHistoryGitCount'),
      gitHistoryLatest: document.getElementById('gitHistoryLatest'),
      gitHistoryLatestDate: document.getElementById('gitHistoryLatestDate'),
      gitHistoryNotices: document.getElementById('gitHistoryNotices'),
      gitHistoryResultCount: document.getElementById('gitHistoryResultCount'),
      gitHistoryPages: document.getElementById('gitHistoryPages'),
      gitHistoryPageSize: document.getElementById('gitHistoryPageSize'),
      gitHistoryDetail: document.getElementById('gitHistoryDetail'),
      gitBranchBtn: document.getElementById('gitBranchBtn'),
      gitPullBtn: document.getElementById('gitPullBtn'),
      gitPushBtn: document.getElementById('gitPushBtn'),
      gitHistoryList: document.getElementById('gitInlineHistoryList') || document.getElementById('gitHistoryList'),
      gitBranchList: document.getElementById('gitBranchList'),
      gitBranchDetail: document.getElementById('gitBranchDetail'),
      gitBranchDetailTitle: document.getElementById('gitBranchDetailTitle'),
      gitBranchDetailMeta: document.getElementById('gitBranchDetailMeta'),
      gitBranchTimeline: document.getElementById('gitBranchTimeline'),
      gitBranchCheckoutBtn: document.getElementById('gitBranchCheckoutBtn'),
      gitBranchMergeBtn: document.getElementById('gitBranchMergeBtn'),
      gitBranchDeleteBtn: document.getElementById('gitBranchDeleteBtn'),
      gitNewBranchName: document.getElementById('gitNewBranchName'),
      gitCreateBranchBtn: document.getElementById('gitCreateBranchBtn'),
      gitStatusDot: document.getElementById('gitStatusDot'),
      gitStatusText: document.getElementById('gitStatusText'),
      gitSafetyState: document.getElementById('gitSafetyState'),
      gitSubnavErrorCount: document.getElementById('gitSubnavErrorCount'),
      errorScanProjectName: document.getElementById('errorScanProjectName'),
      errorScanBtn: document.getElementById('errorScanBtn'),
      runtimeErrorScanBtn: document.getElementById('runtimeErrorScanBtn'),
      errorScanCancelBtn: document.getElementById('errorScanCancelBtn'),
      errorScanProgress: document.getElementById('errorScanProgress'),
      errorScanProgressText: document.getElementById('errorScanProgressText'),
      errorScanSummary: document.getElementById('errorScanSummary'),
      errorScanChart: document.getElementById('errorScanChart'),
      errorScanList: document.getElementById('errorScanList'),
      errorScanSection: document.querySelector('[data-git-section="errors"]')
    }
  }

  function openDiffPreview(hash, diff) {
    const shortHash = String(hash || '').substring(0, 7) || '-'
    const diffPanel = document.createElement('div')
    diffPanel.className = 'git-diff-panel'
    diffPanel.innerHTML = `
      <div class="git-diff-header">
        <span class="git-diff-title">恢复点改动: ${escapeHtml(shortHash)}</span>
        <span class="git-diff-close">x</span>
      </div>
      <div class="git-diff-content">
        <pre class="git-diff-text">${escapeHtml(diff || ((window.i18n?.t?.('auto.js_git_panel_48_1') ?? '无改动内容')))}</pre>
      </div>
    `
    document.body.appendChild(diffPanel)
    diffPanel.querySelector('.git-diff-close').onclick = () => {
      diffPanel.remove()
    }
  }

  function bind(options = {}) {
    const getActiveProject = options.getActiveProject || function () { return null }
    const showToast = options.showToast || function () {}
    const removeToast = options.removeToast || function () {}
    const renderProjectList = options.renderProjectList || function () {}
    const onBranchSessionChanged = options.onBranchSessionChanged || async function () {}
    const chatMessages = options.chatMessages || document.getElementById('chatMessages')
    const els = getElements()
    let latestRecoveryPoints = []
    let currentGitView = 'overview'
    let selectedGitBranch = ''
    let changeFiles = []
    let changePage = 1
    let changePageSize = 20
    let changeQuickFilter = 'all'
    const selectedChangeFiles = new Set()
    let historyEntries = []
    let historyPage = 1
    let historyPageSize = 8
    let historyQuickFilter = 'all'
    let historyActiveStat = 'all'
    let selectedHistoryKey = ''
    const expandedHistoryKeys = new Set()
    let historyLoadWarnings = []
    const errorScanStateByProject = new Map()
    let errorScanTopButton = null
    let errorScanProgressTimer = null

    function setActionButtonLabel(button, text) {
      if (!button) return
      const label = button.querySelector('.git-action-label')
      if (label) {
        label.textContent = text
      } else {
        button.textContent = text
      }
    }

    function updateErrorScanTopButton() {
      if (!errorScanTopButton || !els.errorScanSection) return
      const shouldShow = currentGitView === 'errors' && els.errorScanSection.scrollTop > 180
      errorScanTopButton.classList.toggle('show', shouldShow)
    }

    function ensureErrorScanTopButton() {
      if (!els.errorScanSection || errorScanTopButton) return
      errorScanTopButton = document.createElement('button')
      errorScanTopButton.type = 'button'
      errorScanTopButton.className = 'error-scan-top-btn'
      errorScanTopButton.title = 'Back to top'
      errorScanTopButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>'
      errorScanTopButton.onclick = () => {
        els.errorScanSection?.scrollTo({ top: 0, behavior: 'smooth' })
      }
      els.errorScanSection.appendChild(errorScanTopButton)
      els.errorScanSection.addEventListener('scroll', updateErrorScanTopButton, { passive: true })
    }

    // ── 添加远程仓库对话框 ──
    function showAddRemoteDialog(projectPath) {
      return new Promise((resolve) => {
        const modal = document.getElementById('gitRemoteModal')
        const input = document.getElementById('gitRemoteUrlInput')
        const errorEl = document.getElementById('gitRemoteError')
        const cancelBtn = document.getElementById('gitRemoteCancelBtn')
        const confirmBtn = document.getElementById('gitRemoteConfirmBtn')
        if (!modal || !input || !confirmBtn) { resolve(false); return }

        input.value = ''
        errorEl.textContent = ''
        errorEl.classList.remove('show')
        confirmBtn.disabled = false
        modal.classList.add('show')
        setTimeout(() => input.focus(), 100)

        function cleanup() {
          modal.classList.remove('show')
          cancelBtn.removeEventListener('click', onCancel)
          confirmBtn.removeEventListener('click', onConfirm)
          input.removeEventListener('keydown', onKey)
          modal.removeEventListener('click', onBackdrop)
        }

        function onCancel() { cleanup(); resolve(false) }

        async function onConfirm() {
          const url = input.value.trim()
          if (!url) {
            errorEl.textContent = '请输入远程仓库地址'
            errorEl.classList.add('show')
            return
          }
          confirmBtn.disabled = true
          confirmBtn.textContent = '添加中...'
          try {
            const result = await window.api.gitAddRemote(projectPath, url)
            if (result.success) {
              cleanup()
              showToast('远程仓库添加成功', 'success')
              resolve(true)
            } else {
              errorEl.textContent = result.error || '添加失败'
              errorEl.classList.add('show')
              confirmBtn.disabled = false
              confirmBtn.textContent = '确认添加'
            }
          } catch (e) {
            errorEl.textContent = String(e.message || e)
            errorEl.classList.add('show')
            confirmBtn.disabled = false
            confirmBtn.textContent = '确认添加'
          }
        }

        function onKey(e) {
          if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }

        function onBackdrop(e) {
          if (e.target === modal) onCancel()
        }

        cancelBtn.addEventListener('click', onCancel)
        confirmBtn.addEventListener('click', onConfirm)
        input.addEventListener('keydown', onKey)
        modal.addEventListener('click', onBackdrop)
      })
    }

    function setGitView(view) {
      currentGitView = view || 'overview'
      els.gitSubnavButtons?.forEach(button => {
        button.classList.toggle('active', button.dataset.gitView === currentGitView)
      })
      els.gitViewSections?.forEach(section => {
        section.classList.toggle('active', section.dataset.gitSection === currentGitView)
      })
      if (currentGitView === 'history') {
        loadGitHistory()
      } else if (currentGitView === 'advanced') {
        loadGitStatus()
      } else if (currentGitView === 'policy') {
        window.StorageSettingsInstance?.loadRecoveryPolicy?.()
      } else if (currentGitView === 'errors') {
        ensureErrorScanTopButton()
        renderErrorScanForProject(getActiveProject())
      }
      els.gitPanel?.querySelector(`[data-git-section="${currentGitView}"]`)?.scrollTo({ top: 0, behavior: 'smooth' })
      updateErrorScanTopButton()
    }

    function showGitPanel() {
      if (chatMessages) chatMessages.style.display = 'none'
      window.LingxiPanelManager?.openExclusive?.('git', { hideChat: true })
      if (els.gitHistoryPanel) els.gitHistoryPanel.classList.remove('show')
      if (els.gitBranchPanel) els.gitBranchPanel.classList.remove('show')
      setGitView(currentGitView || 'overview')
      loadGitStatus()
    }

    els.gitSubnavButtons?.forEach(button => {
      button.onclick = () => setGitView(button.dataset.gitView)
    })

    document.querySelectorAll('[data-git-jump]').forEach(button => {
      button.onclick = () => setGitView(button.dataset.gitJump)
    })

    document.querySelectorAll('[data-git-open-branches]').forEach(button => {
      button.onclick = () => {
        els.gitPanel?.classList.remove('show')
        els.gitBranchPanel?.classList.add('show')
        loadGitBranches()
      }
    })

    if (els.gitRefreshBtn) els.gitRefreshBtn.onclick = async () => {
      if (els.gitRefreshBtn.disabled) return
      els.gitRefreshBtn.disabled = true
      els.gitRefreshBtn.classList.add('is-loading')
      try {
        await loadGitStatus()
        if (currentGitView === 'history') await loadGitHistory()
        showToast('安全快照数据已刷新', 'success')
      } catch (error) {
        showToast(`刷新失败：${error.message || error}`, 'error')
      } finally {
        els.gitRefreshBtn.disabled = false
        els.gitRefreshBtn.classList.remove('is-loading')
      }
    }

    if (els.gitChangesSearch) els.gitChangesSearch.oninput = () => {
      changePage = 1
      renderChangeWorkbench()
    }
    if (els.gitChangesType) els.gitChangesType.onchange = () => {
      changeQuickFilter = els.gitChangesType.value === 'other' ? 'other' : els.gitChangesType.value
      changePage = 1
      renderChangeWorkbench()
    }
    els.gitChangeStatButtons?.forEach(button => {
      button.onclick = () => {
        changeQuickFilter = button.dataset.changeFilter || 'all'
        if (els.gitChangesType) {
          els.gitChangesType.value = ['config', 'project'].includes(changeQuickFilter) ? changeQuickFilter : 'all'
        }
        changePage = 1
        renderChangeWorkbench()
      }
    })
    if (els.gitChangesDirectory) els.gitChangesDirectory.onchange = () => {
      changePage = 1
      renderChangeWorkbench()
    }
    if (els.gitChangesSort) els.gitChangesSort.onchange = () => {
      changePage = 1
      renderChangeWorkbench()
    }
    if (els.gitChangesPageSize) els.gitChangesPageSize.onchange = () => {
      changePageSize = Number(els.gitChangesPageSize.value) || 20
      changePage = 1
      renderChangeWorkbench()
    }
    if (els.gitChangesSelectAll) els.gitChangesSelectAll.onchange = () => {
      getFilteredChangeFiles().forEach(file => {
        if (els.gitChangesSelectAll.checked) selectedChangeFiles.add(file.name)
        else selectedChangeFiles.delete(file.name)
      })
      renderChangeWorkbench()
    }
    if (els.gitChangesCreateBtn) els.gitChangesCreateBtn.onclick = () => setGitView('create')
    if (els.gitChangesRefreshBtn) els.gitChangesRefreshBtn.onclick = async () => {
      if (els.gitChangesRefreshBtn.disabled) return
      els.gitChangesRefreshBtn.disabled = true
      els.gitChangesRefreshBtn.classList.add('is-loading')
      try {
        await loadGitStatus()
        showToast('待快照改动已刷新', 'success')
      } catch (error) {
        showToast(`刷新失败：${error.message || error}`, 'error')
      } finally {
        els.gitChangesRefreshBtn.disabled = false
        els.gitChangesRefreshBtn.classList.remove('is-loading')
      }
    }
    if (els.gitChangesStageBtn) els.gitChangesStageBtn.onclick = async () => {
      const project = getActiveProject()
      const files = Array.from(selectedChangeFiles)
      if (!project?.path || !files.length) return
      if (!window.api?.gitStageFiles) {
        showToast('当前客户端暂不支持单文件加入快照', 'error')
        return
      }
      els.gitChangesStageBtn.disabled = true
      try {
        const result = await window.api.gitStageFiles(project.path, files)
        if (!result?.success) throw new Error(result?.error || '加入快照失败')
        selectedChangeFiles.clear()
        showToast(`已将 ${files.length} 个文件加入快照`, 'success')
        await loadGitStatus()
      } catch (error) {
        showToast(`加入快照失败：${error.message || error}`, 'error')
      }
    }
    if (els.gitChangesIgnoreBtn) els.gitChangesIgnoreBtn.onclick = () => {
      const project = getActiveProject()
      const files = Array.from(selectedChangeFiles)
      if (!project?.path || !files.length) return
      showDangerConfirm({
        title: '忽略选中文件',
        body: `将把 ${files.length} 个文件加入项目忽略列表；已跟踪文件会从快照索引中移除，但本地文件不会删除。`,
        confirmText: '确认忽略',
        onConfirm: async () => {
          if (!window.api?.gitIgnoreFiles) {
            showToast('当前客户端暂不支持忽略文件', 'error')
            return
          }
          const result = await window.api.gitIgnoreFiles(project.path, files)
          if (!result?.success) {
            showToast(`忽略失败：${result?.error || '未知错误'}`, 'error')
            return
          }
          selectedChangeFiles.clear()
          showToast(`已忽略 ${files.length} 个文件`, 'success')
          await loadGitStatus()
        }
      })
    }
    if (els.gitChangesOpenIgnored) els.gitChangesOpenIgnored.onclick = () => {
      const project = getActiveProject()
      if (!project?.path) return showToast('请先选择项目', 'error')
      showGitFileDiffPanel(project.path, '.gitignore')
    }

    window.addEventListener('lingxi-recovery-policy-changed', () => {
      const project = getActiveProject()
      if (project) loadOverviewRecoverySummary(project)
    })

    if (els.gitPanelBack) els.gitPanelBack.onclick = () => {
      els.gitPanel.classList.remove('show')
      if (chatMessages) chatMessages.style.display = 'block'
    }

    if (els.gitHistoryBack) els.gitHistoryBack.onclick = () => {
      els.gitHistoryPanel.classList.remove('show')
      els.gitPanel.classList.add('show')
    }

    if (els.gitBranchBack) els.gitBranchBack.onclick = () => {
      els.gitBranchPanel.classList.remove('show')
      els.gitPanel.classList.add('show')
    }

    if (els.gitHistoryBtn) els.gitHistoryBtn.onclick = () => {
      setGitView('history')
    }

    if (els.gitHistoryRefreshBtn) els.gitHistoryRefreshBtn.onclick = async () => {
      if (els.gitHistoryRefreshBtn.disabled) return
      els.gitHistoryRefreshBtn.disabled = true
      els.gitHistoryRefreshBtn.classList.add('is-loading')
      try {
        await loadGitHistory()
        showToast('恢复点历史已刷新', 'success')
      } catch (error) {
        showToast(`刷新失败：${error.message || error}`, 'error')
      } finally {
        els.gitHistoryRefreshBtn.disabled = false
        els.gitHistoryRefreshBtn.classList.remove('is-loading')
      }
    }
    if (els.gitHistorySearch) els.gitHistorySearch.oninput = () => {
      historyPage = 1
      renderHistoryWorkbench()
    }
    if (els.gitHistoryType) els.gitHistoryType.onchange = () => {
      historyQuickFilter = els.gitHistoryType.value || 'all'
      historyActiveStat = historyQuickFilter
      historyPage = 1
      renderHistoryWorkbench()
    }
    if (els.gitHistoryTime) els.gitHistoryTime.onchange = () => {
      historyPage = 1
      renderHistoryWorkbench()
    }
    if (els.gitHistorySort) els.gitHistorySort.onchange = () => {
      historyPage = 1
      renderHistoryWorkbench()
    }
    if (els.gitHistoryPageSize) els.gitHistoryPageSize.onchange = () => {
      historyPageSize = Number(els.gitHistoryPageSize.value) || 8
      historyPage = 1
      renderHistoryWorkbench()
    }
    if (els.gitHistoryCreateBtn) els.gitHistoryCreateBtn.onclick = () => setGitView('create')
    els.gitHistoryStatButtons?.forEach(button => {
      button.onclick = () => {
        const filter = button.dataset.historyStat || 'all'
        if (filter === 'latest') {
          if (els.gitHistorySort) els.gitHistorySort.value = 'newest'
          historyQuickFilter = 'all'
          historyActiveStat = 'latest'
          historyPage = 1
        } else {
          historyQuickFilter = filter
          historyActiveStat = filter
          if (els.gitHistoryType) els.gitHistoryType.value = filter
          historyPage = 1
        }
        renderHistoryWorkbench()
      }
    })

    if (els.errorScanBtn) els.errorScanBtn.onclick = () => runProjectErrorScan(false)
    if (els.runtimeErrorScanBtn) els.runtimeErrorScanBtn.onclick = () => runProjectErrorScan(true)
    if (els.errorScanCancelBtn) els.errorScanCancelBtn.onclick = () => cancelProjectErrorScan()

    if (els.gitBranchBtn) els.gitBranchBtn.onclick = () => {
      els.gitPanel.classList.remove('show')
      els.gitBranchPanel.classList.add('show')
      loadGitBranches()
    }

    if (els.gitAiSuggestBtn) els.gitAiSuggestBtn.onclick = async () => {
      const project = getActiveProject()
      if (!project || !project.path) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_107_0') ?? ((window.i18n?.t?.('auto.js_git_panel_107_2') ?? '请先选择项目')))), 'error')
        return
      }
      els.gitAiSuggestBtn.textContent = ((window.i18n?.t?.('auto.js_git_panel_110_1') ?? ((window.i18n?.t?.('auto.js_git_panel_110_3') ?? '生成中...'))))
      els.gitAiSuggestBtn.disabled = true
      try {
        if (window.api && window.api.gitGenerateCommit) {
          const result = await window.api.gitGenerateCommit(project.path)
          if (result.success) {
            els.gitCommitSuggestion.textContent = result.suggestion || ((window.i18n?.t?.('auto.js_git_panel_116_4') ?? '无法生成恢复点说明'))
            els.gitCommitInput.value = result.suggestion || ''
          } else {
            els.gitCommitSuggestion.textContent = ((window.i18n?.t?.('auto.js_git_panel_119_2') ?? ((window.i18n?.t?.('auto.js_git_panel_119_5') ?? '生成失败: ')))) + (result.error || ((window.i18n?.t?.('auto.js_git_panel_119_6') ?? '未知错误')))
          }
        }
      } catch (e) {
        els.gitCommitSuggestion.textContent = ((window.i18n?.t?.('auto.js_git_panel_123_3') ?? ((window.i18n?.t?.('auto.js_git_panel_123_7') ?? '生成失败: ')))) + e.message
      }
      els.gitAiSuggestBtn.textContent = ((window.i18n?.t?.('auto.js_git_panel_125_4') ?? ((window.i18n?.t?.('auto.js_git_panel_125_8') ?? '生成说明'))))
      els.gitAiSuggestBtn.disabled = false
    }

    if (els.gitCommitBtn) els.gitCommitBtn.onclick = async () => {
      const project = getActiveProject()
      if (!project || !project.path) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_132_5') ?? ((window.i18n?.t?.('auto.js_git_panel_132_9') ?? '请先选择项目')))), 'error')
        return
      }
      const message = els.gitCommitInput.value.trim()
      if (!message) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_137_6') ?? ((window.i18n?.t?.('auto.js_git_panel_137_10') ?? '请输入恢复点说明')))), 'error')
        return
      }
      els.gitCommitBtn.textContent = ((window.i18n?.t?.('auto.js_git_panel_140_7') ?? ((window.i18n?.t?.('auto.js_git_panel_140_11') ?? '创建中...'))))
      els.gitCommitBtn.disabled = true
      try {
        if (window.api && window.api.gitCommit) {
          const result = await window.api.gitCommit(project.path, message)
          if (result.success) {
            els.gitCommitInput.value = ''
            els.gitCommitSuggestion.textContent = ((window.i18n?.t?.('auto.js_git_panel_147_8') ?? ((window.i18n?.t?.('auto.js_git_panel_147_12') ?? '恢复点已创建'))))
            showToast(((window.i18n?.t?.('auto.js_git_panel_148_9') ?? ((window.i18n?.t?.('auto.js_git_panel_148_13') ?? '恢复点已创建')))), 'success')
            loadGitStatus()
            renderProjectList()
          } else {
            showToast(((window.i18n?.t?.('auto.js_git_panel_152_10') ?? ((window.i18n?.t?.('auto.js_git_panel_152_14') ?? '创建恢复点失败: ')))) + (result.error || ((window.i18n?.t?.('auto.js_git_panel_152_15') ?? '未知错误'))), 'error')
          }
        }
      } catch (e) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_156_11') ?? ((window.i18n?.t?.('auto.js_git_panel_156_16') ?? '创建恢复点失败: ')))) + e.message, 'error')
      }
      els.gitCommitBtn.textContent = ((window.i18n?.t?.('auto.js_git_panel_158_12') ?? ((window.i18n?.t?.('auto.js_git_panel_158_17') ?? '创建恢复点'))))
      els.gitCommitBtn.disabled = false
    }

    if (els.gitPullBtn) els.gitPullBtn.onclick = async () => {
      const project = getActiveProject()
      if (!project || !project.path) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_165_13') ?? ((window.i18n?.t?.('auto.js_git_panel_165_18') ?? '请先选择项目')))), 'error')
        return
      }
      setActionButtonLabel(els.gitPullBtn, '同步中...')
      els.gitPullBtn.disabled = true
      try {
        if (window.api && window.api.gitPull) {
          const result = await window.api.gitPull(project.path)
          if (result.success) {
            showToast(((window.i18n?.t?.('auto.js_git_panel_174_15') ?? ((window.i18n?.t?.('auto.js_git_panel_174_20') ?? '拉取成功')))), 'success')
            loadGitStatus()
          } else if (result.noRemote) {
            // 没有远程仓库，弹出添加对话框
            const added = await showAddRemoteDialog(project.path)
            if (added) {
              // 添加成功后自动重试拉取
              const retryResult = await window.api.gitPull(project.path)
              if (retryResult.success) {
                showToast('拉取成功', 'success')
                loadGitStatus()
              } else {
                showToast('拉取失败: ' + (retryResult.error || '未知错误'), 'error')
              }
            }
          } else {
            showToast(((window.i18n?.t?.('auto.js_git_panel_177_16') ?? ((window.i18n?.t?.('auto.js_git_panel_177_21') ?? '拉取失败: ')))) + (result.error || ((window.i18n?.t?.('auto.js_git_panel_177_22') ?? '未知错误'))), 'error')
          }
        }
      } catch (e) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_181_17') ?? ((window.i18n?.t?.('auto.js_git_panel_181_23') ?? '拉取失败: ')))) + e.message, 'error')
      }
      setActionButtonLabel(els.gitPullBtn, '同步远程更新')
      els.gitPullBtn.disabled = false
    }

    if (els.gitPushBtn) els.gitPushBtn.onclick = async () => {
      const project = getActiveProject()
      if (!project || !project.path) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_190_19') ?? ((window.i18n?.t?.('auto.js_git_panel_190_25') ?? '请先选择项目')))), 'error')
        return
      }
      setActionButtonLabel(els.gitPushBtn, '上传中...')
      els.gitPushBtn.disabled = true
      try {
        if (window.api && window.api.gitPush) {
          const result = await window.api.gitPush(project.path)
          if (result.success) {
            showToast(((window.i18n?.t?.('auto.js_git_panel_199_21') ?? ((window.i18n?.t?.('auto.js_git_panel_199_27') ?? '推送成功')))), 'success')
            loadGitStatus()
          } else if (result.noRemote) {
            // 没有远程仓库，弹出添加对话框
            const added = await showAddRemoteDialog(project.path)
            if (added) {
              // 添加成功后自动重试推送
              const retryResult = await window.api.gitPush(project.path)
              if (retryResult.success) {
                showToast('推送成功', 'success')
                loadGitStatus()
              } else {
                showToast('推送失败: ' + (retryResult.error || '未知错误'), 'error')
              }
            }
          } else {
            showToast(((window.i18n?.t?.('auto.js_git_panel_202_22') ?? ((window.i18n?.t?.('auto.js_git_panel_202_28') ?? '推送失败: ')))) + (result.error || ((window.i18n?.t?.('auto.js_git_panel_202_29') ?? '未知错误'))), 'error')
          }
        }
      } catch (e) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_206_23') ?? ((window.i18n?.t?.('auto.js_git_panel_206_30') ?? '推送失败: ')))) + e.message, 'error')
      }
      setActionButtonLabel(els.gitPushBtn, '上传本机记录')
      els.gitPushBtn.disabled = false
    }

    if (els.gitCreateBranchBtn) els.gitCreateBranchBtn.onclick = async () => {
      const project = getActiveProject()
      if (!project || !project.path) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_215_25') ?? ((window.i18n?.t?.('auto.js_git_panel_215_32') ?? '请先选择项目')))), 'error')
        return
      }
      const branchName = els.gitNewBranchName.value.trim()
      if (!branchName) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_220_26') ?? ((window.i18n?.t?.('auto.js_git_panel_220_33') ?? '请输入分支名称')))), 'error')
        return
      }
      try {
        if (window.api && window.api.gitCreateBranch) {
          const result = await window.api.gitCreateBranch(project.path, branchName)
          if (result.success) {
            els.gitNewBranchName.value = ''
            showToast(((window.i18n?.t?.('auto.js_git_panel_228_27') ?? ((window.i18n?.t?.('auto.js_git_panel_228_34') ?? '分支创建成功')))), 'success')
            loadGitBranches()
            loadGitStatus()
            await onBranchSessionChanged({ reason: 'create', branch: branchName })
          } else {
            showToast(((window.i18n?.t?.('auto.js_git_panel_232_28') ?? ((window.i18n?.t?.('auto.js_git_panel_232_35') ?? '创建失败: ')))) + (result.error || ((window.i18n?.t?.('auto.js_git_panel_232_36') ?? '未知错误'))), 'error')
          }
        }
      } catch (e) {
        showToast(((window.i18n?.t?.('auto.js_git_panel_236_29') ?? ((window.i18n?.t?.('auto.js_git_panel_236_37') ?? '创建失败: ')))) + e.message, 'error')
      }
    }

    function getFileStatusMeta(file) {
      const map = {
        modified: { icon: 'M', className: 'M', label: ((window.i18n?.t?.('auto.js_git_panel_242_38') ?? '修改')), group: ((window.i18n?.t?.('auto.js_git_panel_242_39') ?? '已修改')) },
        added: { icon: 'A', className: 'A', label: ((window.i18n?.t?.('auto.js_git_panel_243_40') ?? '新增')), group: ((window.i18n?.t?.('auto.js_git_panel_243_41') ?? '新增')) },
        deleted: { icon: 'D', className: 'D', label: ((window.i18n?.t?.('auto.js_git_panel_244_42') ?? '删除')), group: ((window.i18n?.t?.('auto.js_git_panel_244_43') ?? '删除')) },
        renamed: { icon: 'R', className: 'R', label: ((window.i18n?.t?.('auto.js_git_panel_245_44') ?? '重命名')), group: ((window.i18n?.t?.('auto.js_git_panel_245_45') ?? '重命名')) },
        copied: { icon: 'C', className: 'C', label: ((window.i18n?.t?.('auto.js_git_panel_246_46') ?? '复制')), group: ((window.i18n?.t?.('auto.js_git_panel_246_47') ?? '复制')) },
        untracked: { icon: 'U', className: 'U', label: ((window.i18n?.t?.('auto.js_git_panel_247_48') ?? '未跟踪')), group: ((window.i18n?.t?.('auto.js_git_panel_247_49') ?? '未跟踪')) },
        conflicted: { icon: '!', className: 'conflict', label: ((window.i18n?.t?.('auto.js_git_panel_248_50') ?? '冲突')), group: ((window.i18n?.t?.('auto.js_git_panel_248_51') ?? '冲突')) }
      }
      return map[file.status] || { icon: 'M', className: 'M', label: ((window.i18n?.t?.('auto.js_git_panel_250_52') ?? '修改')), group: ((window.i18n?.t?.('auto.js_git_panel_250_53') ?? '已修改')) }
    }

    function getSyncText(status) {
      const ahead = status.ahead || 0
      const behind = status.behind || 0
      if (!status.upstream) return status.remote ? ((window.i18n?.t?.('auto.js_git_panel_256_54') ?? '未关联上游')) : ((window.i18n?.t?.('auto.js_git_panel_256_55') ?? '本地仓库'))
      if (ahead && behind) return `领先 ${ahead} / 落后 ${behind}`
      if (ahead) return `领先 ${ahead}`
      if (behind) return `落后 ${behind}`
      return ((window.i18n?.t?.('auto.js_git_panel_260_56') ?? '已同步'))
    }

    function getChangeFileKind(file = {}) {
      const name = String(file.name || '').replace(/\\/g, '/')
      const lower = name.toLowerCase()
      const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : ''
      const configExtensions = new Set(['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.env', '.properties', '.lock'])
      if (/(^|\/)(config|configs|settings|\.lingxi)(\/|$)/.test(lower) || configExtensions.has(extension) || /(^|\/)[^.\/]*config[^\/]*$/.test(lower)) {
        return { key: 'config', label: '配置文件' }
      }
      if (/(^|\/)(temp|tmp|cache|logs?|coverage|dist|build)(\/|$)/.test(lower)) {
        return { key: 'other', label: '其他文件' }
      }
      return { key: 'project', label: '项目文件' }
    }

    function getChangeDirectory(file = {}) {
      const parts = String(file.name || '').replace(/\\/g, '/').split('/').filter(Boolean)
      return parts.length > 1 ? parts[0] : '根目录'
    }

    function formatChangeTime(value) {
      const date = new Date(Number(value) || value || 0)
      if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return '-'
      const now = new Date()
      const time = date.toLocaleTimeString('zh-CN', { hour12: false })
      if (date.toDateString() === now.toDateString()) return `今天 ${time}`
      return `${date.getMonth() + 1}月${date.getDate()}日 ${time.slice(0, 5)}`
    }

    function getFilteredChangeFiles() {
      const query = String(els.gitChangesSearch?.value || '').trim().toLowerCase()
      const type = els.gitChangesType?.value || 'all'
      const directory = els.gitChangesDirectory?.value || 'all'
      const sort = els.gitChangesSort?.value || 'updated'
      const filtered = changeFiles.filter(file => {
        const fileType = getChangeFileKind(file).key
        const matchesQuery = !query || String(file.name || '').toLowerCase().includes(query) || String(file.oldName || '').toLowerCase().includes(query)
        const matchesQuickFilter = changeQuickFilter !== 'unstaged' || !file.staged || file.unstaged || file.untracked
        return matchesQuery && matchesQuickFilter && (type === 'all' || fileType === type) && (directory === 'all' || getChangeDirectory(file) === directory)
      })
      filtered.sort((a, b) => {
        if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
        if (sort === 'status') return String(a.status || '').localeCompare(String(b.status || ''))
        return (Number(b.modifiedAt) || 0) - (Number(a.modifiedAt) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
      })
      return filtered
    }

    function updateChangeSummary() {
      const counts = changeFiles.reduce((summary, file) => {
        const kind = getChangeFileKind(file).key
        summary.total += 1
        summary[kind] += 1
        if (!file.staged || file.unstaged || file.untracked) summary.unstaged += 1
        return summary
      }, { total: 0, unstaged: 0, config: 0, project: 0, other: 0 })
      const selected = selectedChangeFiles.size
      if (els.gitChangesTotal) els.gitChangesTotal.textContent = String(counts.total)
      if (els.gitChangesUnstaged) els.gitChangesUnstaged.textContent = String(counts.unstaged)
      if (els.gitChangesConfig) els.gitChangesConfig.textContent = String(counts.config)
      if (els.gitChangesProject) els.gitChangesProject.textContent = String(counts.project)
      if (els.gitChangesSelectedCount) els.gitChangesSelectedCount.textContent = String(selected)
      if (els.gitChangesDonutTotal) els.gitChangesDonutTotal.textContent = String(counts.total)
      if (els.gitChangesConfigLegend) els.gitChangesConfigLegend.textContent = String(counts.config)
      if (els.gitChangesProjectLegend) els.gitChangesProjectLegend.textContent = String(counts.project)
      if (els.gitChangesOtherLegend) els.gitChangesOtherLegend.textContent = String(counts.other)
      if (els.gitChangesQueueUnstaged) els.gitChangesQueueUnstaged.textContent = String(counts.unstaged)
      if (els.gitChangesQueueSelected) els.gitChangesQueueSelected.textContent = String(selected)
      if (els.gitChangesQueuePending) els.gitChangesQueuePending.textContent = String(counts.total)
      if (els.gitChangesQueueIgnored) els.gitChangesQueueIgnored.textContent = '0'
      if (els.gitChangesStageBtn) els.gitChangesStageBtn.disabled = selected === 0
      if (els.gitChangesIgnoreBtn) els.gitChangesIgnoreBtn.disabled = selected === 0
      els.gitChangeStatButtons?.forEach(button => {
        const active = button.dataset.changeFilter === changeQuickFilter
        button.classList.toggle('active', active)
        button.setAttribute('aria-pressed', active ? 'true' : 'false')
      })
      if (els.gitChangesDonut) {
        const configAngle = counts.total ? (counts.config / counts.total) * 360 : 0
        const projectAngle = counts.total ? configAngle + (counts.project / counts.total) * 360 : 0
        els.gitChangesDonut.style.setProperty('--config-angle', `${configAngle}deg`)
        els.gitChangesDonut.style.setProperty('--project-angle', `${projectAngle}deg`)
      }
    }

    function renderChangePages(totalPages) {
      if (!els.gitChangesPages) return
      const pages = []
      const start = Math.max(1, Math.min(changePage - 2, Math.max(1, totalPages - 4)))
      const end = Math.min(totalPages, start + 4)
      for (let page = start; page <= end; page += 1) pages.push(page)
      els.gitChangesPages.innerHTML = `
        <button type="button" data-page="${Math.max(1, changePage - 1)}" ${changePage <= 1 ? 'disabled' : ''}>‹</button>
        ${pages.map(page => `<button type="button" data-page="${page}" class="${page === changePage ? 'active' : ''}">${page}</button>`).join('')}
        <button type="button" data-page="${Math.min(totalPages, changePage + 1)}" ${changePage >= totalPages ? 'disabled' : ''}>›</button>
      `
      els.gitChangesPages.querySelectorAll('button[data-page]').forEach(button => {
        button.onclick = () => {
          changePage = Number(button.dataset.page) || 1
          renderChangeWorkbench()
        }
      })
    }

    function renderChangeWorkbench() {
      if (!els.gitFileList) return
      const filtered = getFilteredChangeFiles()
      const totalPages = Math.max(1, Math.ceil(filtered.length / changePageSize))
      changePage = Math.min(changePage, totalPages)
      const visible = filtered.slice((changePage - 1) * changePageSize, changePage * changePageSize)
      updateChangeSummary()
      if (els.gitFileCount) els.gitFileCount.textContent = String(filtered.length)
      if (els.gitChangesSelectAll) {
        const selectedVisible = filtered.filter(file => selectedChangeFiles.has(file.name)).length
        els.gitChangesSelectAll.checked = filtered.length > 0 && selectedVisible === filtered.length
        els.gitChangesSelectAll.indeterminate = selectedVisible > 0 && selectedVisible < filtered.length
      }
      if (!visible.length) {
        els.gitFileList.innerHTML = '<div class="git-empty">没有符合当前筛选条件的改动</div>'
        renderChangePages(totalPages)
        return
      }
      els.gitFileList.innerHTML = visible.map(file => {
        const meta = getFileStatusMeta(file)
        const kind = getChangeFileKind(file)
        const selected = selectedChangeFiles.has(file.name)
        return `
          <div class="git-file-item ${selected ? 'selected' : ''}" data-file="${escapeHtml(file.name)}" title="点击查看本次改动">
            <label class="git-change-check"><input type="checkbox" ${selected ? 'checked' : ''}><span></span></label>
            <span class="git-file-status-icon ${meta.className}">${meta.icon}</span>
            <span class="git-change-file-copy">
              <strong>${file.oldName ? `${escapeHtml(file.oldName)} → ` : ''}${escapeHtml(file.name)}</strong>
              <small>${kind.label} · ${escapeHtml(meta.label)}</small>
            </span>
            <span class="git-change-file-time">${formatChangeTime(file.modifiedAt)}</span>
            <span class="git-change-file-state ${file.staged ? 'staged' : ''}">${file.staged ? '已加入' : '未暂存'}</span>
          </div>
        `
      }).join('')
      els.gitFileList.querySelectorAll('.git-file-item').forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]')
        checkbox?.addEventListener('change', event => {
          event.stopPropagation()
          if (checkbox.checked) selectedChangeFiles.add(item.dataset.file)
          else selectedChangeFiles.delete(item.dataset.file)
          renderChangeWorkbench()
        })
        item.onclick = event => {
          if (event.target.closest('.git-change-check')) return
          const project = getActiveProject()
          if (project?.path && item.dataset.file) showGitFileDiffPanel(project.path, item.dataset.file)
        }
      })
      renderChangePages(totalPages)
    }

    function renderGitFiles(files) {
      changeFiles = Array.isArray(files) ? files : []
      const existing = new Set(changeFiles.map(file => file.name))
      Array.from(selectedChangeFiles).forEach(name => {
        if (!existing.has(name)) selectedChangeFiles.delete(name)
      })
      if (els.gitChangesDirectory) {
        const current = els.gitChangesDirectory.value || 'all'
        const directories = Array.from(new Set(changeFiles.map(getChangeDirectory))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
        els.gitChangesDirectory.innerHTML = `<option value="all">全部目录</option>${directories.map(directory => `<option value="${escapeHtml(directory)}">${escapeHtml(directory)}</option>`).join('')}`
        els.gitChangesDirectory.value = directories.includes(current) ? current : 'all'
      }
      renderChangeWorkbench()
    }

    function showDangerConfirm({ title, body, confirmText, onConfirm }) {
      const overlay = document.createElement('div')
      overlay.className = 'git-danger-overlay'
      overlay.innerHTML = `
        <div class="git-danger-dialog">
          <div class="git-danger-title">${escapeHtml(title)}</div>
          <div class="git-danger-body">${escapeHtml(body)}</div>
          <div class="git-danger-actions">
            <button class="git-danger-btn cancel">取消</button>
            <button class="git-danger-btn confirm">${escapeHtml(confirmText || ((window.i18n?.t?.('auto.js_git_panel_320_68') ?? '确认')))}</button>
          </div>
        </div>
      `
      document.body.appendChild(overlay)
      overlay.querySelector('.cancel').onclick = () => overlay.remove()
      overlay.querySelector('.confirm').onclick = async () => {
        overlay.querySelectorAll('button').forEach(btn => { btn.disabled = true })
        try {
          await onConfirm()
        } finally {
          overlay.remove()
        }
      }
    }

    function updateSafetyState(text, className) {
      if (!els.gitSafetyState) return
      els.gitSafetyState.textContent = text
      els.gitSafetyState.className = className ? `git-safety-state ${className}` : 'git-safety-state'
    }

    function getSnapshotKind(message = '') {
      const text = String(message || '')
      if (text.includes(((window.i18n?.t?.('auto.js_git_panel_344_69') ?? 'AI 修改前恢复点')))) return { label: ((window.i18n?.t?.('auto.js_git_panel_344_70') ?? '修改前')), className: 'before' }
      if (text.includes(((window.i18n?.t?.('auto.js_git_panel_345_71') ?? 'AI 完成后恢复点')))) return { label: ((window.i18n?.t?.('auto.js_git_panel_345_72') ?? '完成后')), className: 'after' }
      if (text.includes(((window.i18n?.t?.('auto.js_git_panel_346_73') ?? 'AI 部分自救后恢复点')))) return { label: ((window.i18n?.t?.('auto.js_git_panel_346_74') ?? '部分自救')), className: 'partial-rescue' }
      if (text.includes(((window.i18n?.t?.('auto.js_git_panel_347_75') ?? 'AI 自救后恢复点')))) return { label: ((window.i18n?.t?.('auto.js_git_panel_347_76') ?? '自救后')), className: 'rescue' }
      return null
    }

    function formatRecoveryDate(value = '') {
      if (!value) return '-'
      const raw = String(value).trim()
      // 后端已返回 YYYY-MM-DD HH:mm:ss 时直接展示，避免再丢秒
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(raw)) {
        return raw.replace('T', ' ').slice(0, 19)
      }
      const date = new Date(raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw)
      if (Number.isNaN(date.getTime())) return raw || '-'
      const pad = number => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    const formatBytes = FormatUtils.formatBytes

    function buildFindingPrompt(finding = {}) {
      const location = [finding.path || '', finding.line ? `L${finding.line}` : ''].filter(Boolean).join(':')
      return [
        '请核实下面这个错误扫描结果是否属实，并给出最小修复方案。不要只看语法是否通过，要追完整根因链。',
        '',
        `位置：${location || '-'}`,
        `严重级别：${finding.severity || '-'}`,
        `类型：${finding.type || '-'}`,
        `分类：${finding.category || '-'}`,
        `问题：${finding.message || '-'}`,
        finding.evidence ? `证据：${finding.evidence}` : '',
        finding.suggestion ? `扫描建议：${finding.suggestion}` : ''
      ].filter(Boolean).join('\n')
    }

    function copyText(text = '') {
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
      return Promise.resolve()
    }

    function getProjectScanKey(project) {
      return String(project?.id || project?.path || '')
    }

    function getErrorScanState(project) {
      const key = getProjectScanKey(project)
      if (!key) return null
      if (!errorScanStateByProject.has(key)) {
        errorScanStateByProject.set(key, {
          result: null,
          loading: false,
          runtime: false,
          error: '',
          scannedAt: '',
          loadingRunId: '',
          filter: 'all',
          cancelled: false
        })
      }
      return errorScanStateByProject.get(key)
    }

    function showErrorScanProgress(runtime) {
      if (els.errorScanProgress) els.errorScanProgress.style.display = 'flex'
      if (els.errorScanCancelBtn) els.errorScanCancelBtn.style.display = 'inline-flex'
      const stages = runtime
        ? ['正在启动运行态探测...', '正在采集运行时错误...', '正在抓取控制台/F12 异常...', '正在合并语法与逻辑诊断...']
        : ['正在收集项目文件...', '正在检查语法...', '正在分析逻辑与 IPC...', '正在扫描 CSS/DOM 与路径...']
      let idx = 0
      if (els.errorScanProgressText) els.errorScanProgressText.textContent = stages[idx]
      if (errorScanProgressTimer) clearInterval(errorScanProgressTimer)
      errorScanProgressTimer = setInterval(() => {
        idx = (idx + 1) % stages.length
        if (els.errorScanProgressText) els.errorScanProgressText.textContent = stages[idx]
      }, 1800)
    }

    function hideErrorScanProgress() {
      if (els.errorScanProgress) els.errorScanProgress.style.display = 'none'
      if (els.errorScanCancelBtn) els.errorScanCancelBtn.style.display = 'none'
      if (errorScanProgressTimer) { clearInterval(errorScanProgressTimer); errorScanProgressTimer = null }
    }

    function cancelProjectErrorScan() {
      const project = getActiveProject()
      const state = getErrorScanState(project)
      if (state?.loadingRunId) {
        setErrorScanState(project, {
          loading: false,
          runtime: state.runtime,
          error: '',
          cancelled: true,
          loadingRunId: ''
        })
      }
      hideErrorScanProgress()
      const button = state?.runtime ? els.runtimeErrorScanBtn : els.errorScanBtn
      if (button) button.disabled = false
      const label = button?.querySelector('span')
      if (label) label.textContent = state?.runtime ? '运行态扫描' : '扫描此项目'
      if (project) renderErrorScanForProject(project)
      showToast('已取消扫描', 'info')
    }

    function setErrorScanState(project, patch = {}) {
      const state = getErrorScanState(project)
      if (!state) return null
      Object.assign(state, patch)
      return state
    }

    function resetErrorScanView(message) {
      updateErrorScanSummary({})
      if (els.errorScanChart) {
        els.errorScanChart.innerHTML = '<div class="git-empty">点击“扫描此项目”后按类型查看错误</div>'
      }
      if (els.errorScanList) {
        els.errorScanList.innerHTML = `<div class="git-empty">${escapeHtml(message || '暂无扫描结果')}</div>`
      }
    }

    function getErrorScanFilterDefs(result = {}) {
      const syntaxFailed = Number(result.syntax?.failed_count || 0)
      const findings = Array.isArray(result.findings) ? result.findings : []
      const runtimeFindings = Array.isArray(result.runtime_findings) ? result.runtime_findings : []
      const countBy = (predicate) => findings.filter(predicate).length
      return [
        { key: 'all', label: '全部', count: findings.length + syntaxFailed },
        { key: 'syntax', label: '语法错误', count: syntaxFailed },
        { key: 'runtime', label: '运行态', count: runtimeFindings.length || countBy(isRuntimeFinding) },
        { key: 'logic', label: '逻辑', count: countBy(item => normalizeFindingCategory(item) === 'logic') },
        { key: 'css-dom', label: 'CSS/DOM', count: countBy(isCssDomFinding) },
        { key: 'ipc', label: 'IPC', count: countBy(isIpcFinding) },
        { key: 'redundancy', label: '冗余/残留', count: countBy(isRedundancyFinding) },
        { key: 'path-state', label: '路径/状态', count: countBy(isPathStateFinding) },
        { key: 'security', label: '安全', count: countBy(item => normalizeFindingCategory(item) === 'security' || /security|inject|xss|csrf|权限|注入/i.test(`${item.type || ''} ${item.message || ''}`)) },
        { key: 'other', label: '其他', count: 0 }
      ]
    }

    function normalizeFindingCategory(finding = {}) {
      return String(finding.category || finding.classification || finding.type || '').toLowerCase()
    }

    function isRuntimeFinding(finding = {}) {
      return /runtime|console|f12|uncaught|rejection|log|运行|崩溃/i.test(`${finding.category || ''} ${finding.type || ''} ${finding.message || ''}`)
    }

    function isCssDomFinding(finding = {}) {
      return /css|dom|selector|style|class|display|visibility|布局|选择器/i.test(`${finding.category || ''} ${finding.type || ''} ${finding.message || ''}`)
    }

    function isIpcFinding(finding = {}) {
      return /ipc|handler|preload|invoke|send|channel|主进程|渲染进程/i.test(`${finding.category || ''} ${finding.type || ''} ${finding.message || ''}`)
    }

    function isPathStateFinding(finding = {}) {
      return /path|route|state|sync|cache|storage|project|路径|状态|同步|串项目|污染/i.test(`${finding.category || ''} ${finding.type || ''} ${finding.message || ''}`)
    }

    function isRedundancyFinding(finding = {}) {
      return normalizeFindingCategory(finding) === 'redundancy' ||
        /redund|duplicate-feature|duplicate-function|unused-css|legacy|dead|stale|unused|obsolete|deprecated|残留|冗余|重复|废弃|弃用/i.test(`${finding.type || ''} ${finding.message || ''}`)
    }

    function getFindingTypeLabel(type = '') {
      const labels = {
        'unused-css-selector-candidate': '疑似未使用 CSS',
        'dom-query-without-matching-markup': 'DOM 残留查询',
        'duplicate-feature-surface-candidate': '疑似重复功能面',
        'duplicate-function-name-across-files': '疑似重复实现',
        'legacy-disabled-code-candidate': '疑似废弃/残留代码',
        'syntax-error': '语法错误',
        'runtime-diagnostic': '运行态错误',
        'runtime-probe-event': '运行态探测',
        'project-runtime-log-error': '项目日志错误',
        'missing-ipc-handler': 'IPC 缺少处理器',
        'ipc-channel-without-handler': 'IPC 通道无处理器',
        'renderer-event-without-listener': '渲染事件无监听',
        'preload-exposes-missing-ipc-handler': '预加载暴露但主进程缺失',
        'dom-css-state-owner-mismatch': 'DOM/CSS 状态链不匹配',
        'response-body-consumed-twice': '响应流重复读取',
        'duplicate-api-route-registration': 'API 路由重复注册'
      }
      return labels[type] || type || '扫描发现'
    }

    function getSyntaxFindings(result = {}) {
      const failedFiles = Array.isArray(result.syntax?.failed_files) ? result.syntax.failed_files : []
      return failedFiles.map(file => ({
        severity: 'error',
        type: 'syntax-error',
        category: 'syntax',
        path: file.path || file.file || String(file || ''),
        line: file.line || null,
        message: file.message || file.error || '语法检查失败',
        evidence: file.evidence || file.output || '',
        suggestion: '先打开该文件核实语法结构，再做最小修复。'
      }))
    }

    function getOtherFindingCount(result = {}) {
      const findings = Array.isArray(result.findings) ? result.findings : []
      return findings.filter(item => {
        const category = normalizeFindingCategory(item)
        return category !== 'logic' &&
          category !== 'security' &&
          !isRuntimeFinding(item) &&
          !isCssDomFinding(item) &&
          !isIpcFinding(item) &&
          !isPathStateFinding(item)
      }).length
    }

    function updateErrorScanSummary(result = {}) {
      const summary = result.summary || {}
      const syntax = result.syntax || {}
      const stats = [
        { label: '危险', value: Number(summary.error_count || 0), className: 'danger' },
        { label: '警告', value: Number(summary.warning_count || 0), className: 'warning' },
        { label: '语法失败', value: Number(syntax.failed_count || 0), className: '' },
        { label: '扫描文件', value: Number(syntax.checked_count || 0), className: '' }
      ]
      if (els.errorScanSummary) {
        els.errorScanSummary.innerHTML = stats.map(item => `
          <div class="error-scan-stat ${item.className}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join('')
      }
      if (els.gitSubnavErrorCount) els.gitSubnavErrorCount.textContent = String(Number(summary.error_count || 0))
    }

    function renderErrorScanChartLegacy(result = {}) {
      if (!els.errorScanChart) return
      const categories = result.summary?.categories || {}
      const entries = Object.entries(categories)
        .map(([key, value]) => ({
          key,
          total: Number(value.total || 0),
          errors: Number(value.errors || 0),
          warnings: Number(value.warnings || 0)
        }))
        .filter(item => item.total > 0)
        .sort((a, b) => (b.errors - a.errors) || (b.total - a.total))
        .slice(0, 12)
      if (!entries.length) {
        els.errorScanChart.innerHTML = '<div class="git-empty">未发现可展示的错误类别</div>'
        return
      }
      const max = Math.max(1, ...entries.map(item => item.total))
      els.errorScanChart.innerHTML = entries.map(item => `
        <div class="error-scan-bar-row">
          <span class="error-scan-bar-label">${escapeHtml(item.key)}</span>
          <div class="error-scan-bar-track">
            <span class="error-scan-bar-fill" style="width:${Math.max(4, Math.round(item.total / max * 100))}%"></span>
          </div>
          <span class="error-scan-bar-count">${item.errors} / ${item.total}</span>
        </div>
      `).join('')
    }

    function renderErrorScanChart(result = {}) {
      if (!els.errorScanChart) return
      const project = getActiveProject()
      const state = getErrorScanState(project)
      const activeFilter = state?.filter || 'all'
      const filters = getErrorScanFilterDefs(result)
      const other = filters.find(item => item.key === 'other')
      if (other) other.count = getOtherFindingCount(result)
      const visibleFilters = filters.filter(item => item.key === 'all' || item.count > 0)
      if (!visibleFilters.length) {
        els.errorScanChart.innerHTML = '<div class="git-empty">No grouped issues</div>'
        return
      }
      els.errorScanChart.innerHTML = visibleFilters.map(item => `
        <button class="error-scan-filter ${item.key === activeFilter ? 'active' : ''}" type="button" data-error-filter="${escapeHtml(item.key)}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.count)}</strong>
        </button>
      `).join('')
      els.errorScanChart.querySelectorAll('[data-error-filter]').forEach(button => {
        button.onclick = () => {
          setErrorScanState(project, { filter: button.dataset.errorFilter || 'all' })
          renderErrorScanResult(result)
        }
      })
    }

    function showErrorFindingDialog(finding = {}) {
      const overlay = document.createElement('div')
      overlay.className = 'git-danger-overlay'
      const location = [finding.path || '', finding.line ? `L${finding.line}` : ''].filter(Boolean).join(':')
      overlay.innerHTML = `
        <div class="git-danger-dialog error-finding-dialog">
          <div class="git-danger-title">${escapeHtml(getFindingTypeLabel(finding.type))}</div>
          <div class="error-finding-meta">
            <span>${escapeHtml(finding.severity || 'warning')}</span>
            <span>${escapeHtml(finding.category || 'logic')}</span>
            <span>${escapeHtml(location || '-')}</span>
          </div>
          <div class="git-danger-body">${escapeHtml(finding.message || '')}</div>
          ${finding.evidence ? `<pre class="error-finding-evidence">${escapeHtml(finding.evidence)}</pre>` : ''}
          ${finding.suggestion ? `<div class="error-finding-suggestion">${escapeHtml(finding.suggestion)}</div>` : ''}
          <div class="git-danger-actions">
            <button class="git-danger-btn cancel">关闭</button>
            <button class="git-danger-btn confirm" data-copy-finding>复制给 AI 核实</button>
          </div>
        </div>
      `
      document.body.appendChild(overlay)
      overlay.querySelector('.cancel').onclick = () => overlay.remove()
      overlay.querySelector('[data-copy-finding]').onclick = async () => {
        await copyText(buildFindingPrompt(finding))
        showToast('已复制核实提示词', 'success')
      }
    }

    function renderErrorScanListLegacy(result = {}) {
      if (!els.errorScanList) return
      const findings = Array.isArray(result.findings) ? result.findings : []
      if (!findings.length) {
        els.errorScanList.innerHTML = '<div class="git-empty">未发现错误</div>'
        return
      }
      els.errorScanList.innerHTML = findings.map((finding, index) => {
        const severity = String(finding.severity || 'warning').toLowerCase()
        const location = [finding.path || '', finding.line ? `L${finding.line}` : ''].filter(Boolean).join(':')
        return `
          <button class="error-scan-item ${severity}" type="button" data-error-index="${index}">
            <span class="error-scan-severity">${escapeHtml(severity === 'error' ? '危险' : '警告')}</span>
            <span class="error-scan-main">
              <strong>${escapeHtml(getFindingTypeLabel(finding.type || 'project-health-risk'))}</strong>
              <span>${escapeHtml(finding.message || '')}</span>
            </span>
            <span class="error-scan-location">${escapeHtml(location || '-')}</span>
          </button>
        `
      }).join('')
      els.errorScanList.querySelectorAll('[data-error-index]').forEach(button => {
        button.onclick = () => showErrorFindingDialog(findings[Number(button.dataset.errorIndex) || 0])
      })
    }

    function getFilteredErrorScanFindings(result = {}) {
      const project = getActiveProject()
      const filter = getErrorScanState(project)?.filter || 'all'
      const findings = Array.isArray(result.findings) ? result.findings : []
      if (filter === 'syntax') return getSyntaxFindings(result)
      if (filter === 'runtime') {
        return (Array.isArray(result.runtime_findings) && result.runtime_findings.length)
          ? result.runtime_findings
          : findings.filter(isRuntimeFinding)
      }
      if (filter === 'logic') return findings.filter(item => normalizeFindingCategory(item) === 'logic')
      if (filter === 'css-dom') return findings.filter(isCssDomFinding)
      if (filter === 'ipc') return findings.filter(isIpcFinding)
      if (filter === 'path-state') return findings.filter(isPathStateFinding)
      if (filter === 'redundancy') return findings.filter(isRedundancyFinding)
      if (filter === 'security') {
        return findings.filter(item => normalizeFindingCategory(item) === 'security' || /security|inject|xss|csrf|权限|注入/i.test(`${item.type || ''} ${item.message || ''}`))
      }
      if (filter === 'other') {
        return findings.filter(item => {
          const category = normalizeFindingCategory(item)
          return category !== 'logic' &&
            category !== 'security' &&
            !isRuntimeFinding(item) &&
            !isCssDomFinding(item) &&
            !isIpcFinding(item) &&
            !isRedundancyFinding(item) &&
            !isPathStateFinding(item)
        })
      }
      return getSyntaxFindings(result).concat(findings)
    }

    function renderErrorScanList(result = {}) {
      if (!els.errorScanList) return
      const findings = getFilteredErrorScanFindings(result)
      if (!findings.length) {
        els.errorScanList.innerHTML = '<div class="git-empty">No issues in this group</div>'
        return
      }
      els.errorScanList.innerHTML = findings.map((finding, index) => {
        const severity = String(finding.severity || 'warning').toLowerCase()
        const location = [finding.path || '', finding.line ? `L${finding.line}` : ''].filter(Boolean).join(':')
        return `
          <button class="error-scan-item ${severity}" type="button" data-error-index="${index}">
            <span class="error-scan-severity">${escapeHtml(severity === 'error' ? 'ERR' : 'WARN')}</span>
            <span class="error-scan-main">
              <strong>${escapeHtml(getFindingTypeLabel(finding.type || 'project-health-risk'))}</strong>
              <span>${escapeHtml(finding.message || '')}</span>
            </span>
            <span class="error-scan-location">${escapeHtml(location || '-')}</span>
          </button>
        `
      }).join('')
      els.errorScanList.querySelectorAll('[data-error-index]').forEach(button => {
        button.onclick = () => showErrorFindingDialog(findings[Number(button.dataset.errorIndex) || 0])
      })
    }

    function renderErrorScanResult(result = {}) {
      updateErrorScanSummary(result)
      renderErrorScanChart(result)
      renderErrorScanList(result)
    }

    function renderErrorScanForProject(project) {
      if (els.errorScanProjectName) {
        els.errorScanProjectName.textContent = project?.name || project?.path || '只扫描当前项目'
      }
      if (!project?.path) {
        resetErrorScanView('请先选择项目')
        return
      }

      const state = getErrorScanState(project)
      if (state?.loading) {
        showErrorScanProgress(state.runtime)
        updateErrorScanSummary(state.result || {})
        if (els.errorScanChart && !state.result) {
          els.errorScanChart.innerHTML = '<div class="git-empty">正在扫描当前项目...</div>'
        }
        if (els.errorScanList) {
          els.errorScanList.innerHTML = `<div class="git-empty">${state.runtime ? '正在运行态扫描当前项目...' : '正在扫描当前项目...'}</div>`
        }
        return
      }
      hideErrorScanProgress()
      if (state?.cancelled) {
        resetErrorScanView('扫描已取消，可重新点击扫描按钮')
        return
      }
      if (state?.error) {
        resetErrorScanView(`扫描失败：${state.error}`)
        return
      }
      if (state?.result) {
        renderErrorScanResult(state.result)
        return
      }
      resetErrorScanView('点击扫描此项目后，只显示当前项目的结果')
    }

    async function runProjectErrorScan(runtime = false) {
      const project = getActiveProject()
      if (!project?.path) {
        showToast('请选择项目', 'error')
        return
      }

      const projectKey = getProjectScanKey(project)
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const button = runtime ? els.runtimeErrorScanBtn : els.errorScanBtn
      const label = button?.querySelector('span')
      const oldText = label?.textContent || ''
      if (button) button.disabled = true
      if (label) label.textContent = runtime ? '运行态扫描中...' : '扫描中...'

      setErrorScanState(project, {
        loading: true,
        runtime,
        error: '',
        cancelled: false,
        loadingRunId: runId
      })
      showErrorScanProgress(runtime)
      if (getProjectScanKey(getActiveProject()) === projectKey) renderErrorScanForProject(project)

      try {
        const result = await window.api?.runProjectErrorScan?.({
          projectId: project.id,
          projectPath: project.path,
          runtime,
          full: true,
          scope: 'full',
          max_failures: 'all',
          top_limit: 5000
        })
        const state = getErrorScanState(project)
        if (state?.loadingRunId !== runId) return

        if (!result?.success) {
          setErrorScanState(project, {
            loading: false,
            runtime,
            error: result?.error || 'unknown error',
            loadingRunId: ''
          })
          showToast(result?.error || '错误扫描失败', 'error')
          if (getProjectScanKey(getActiveProject()) === projectKey) renderErrorScanForProject(project)
          return
        }

        setErrorScanState(project, {
          result,
          loading: false,
          runtime,
          error: '',
          scannedAt: new Date().toISOString(),
          loadingRunId: ''
        })
        if (getProjectScanKey(getActiveProject()) === projectKey) renderErrorScanResult(result)
        showToast(runtime ? '运行态错误扫描完成' : '错误扫描完成', 'success')
      } catch (error) {
        const state = getErrorScanState(project)
        if (state?.loadingRunId !== runId) return
        setErrorScanState(project, {
          loading: false,
          runtime,
          error: error.message || String(error),
          loadingRunId: ''
        })
        showToast(`错误扫描失败：${error.message || error}`, 'error')
        if (getProjectScanKey(getActiveProject()) === projectKey) renderErrorScanForProject(project)
      } finally {
        const currentState = getErrorScanState(project)
        if (!currentState?.loadingRunId || currentState.loadingRunId === runId) {
          hideErrorScanProgress()
          if (button) button.disabled = false
          if (label) label.textContent = oldText
        }
      }
    }

    function setOverviewMode(mode, message) {
      if (els.gitOverviewDashboard) {
        els.gitOverviewDashboard.className = `git-overview-dashboard ${mode || 'idle'}`
      }
      if (els.gitOverviewMessage && message) els.gitOverviewMessage.textContent = message
    }

    function setFlowStep(step, state) {
      if (!step) return
      step.className = `git-flow-step ${state || ''}`.trim()
    }

    function updateOverviewRecoverySummary(summary = {}) {
      const filePoints = Array.isArray(summary.points) ? summary.points : []
      const gitCount = Number(summary.gitCount || 0)
      const fileCount = filePoints.length
      const totalCount = gitCount + fileCount
      const fileBytes = filePoints.reduce((sum, point) => sum + Number(point.totalBytes || point.dirSize || 0), 0)
      const gitBytes = Number(summary.gitBytes || 0)
      const totalBytes = fileBytes + gitBytes
      const storageLimit = 512 * 1024 * 1024
      const storagePercent = Math.min(100, Math.max(0, totalBytes / storageLimit * 100))
      const latestFilePoint = filePoints[0] || null
      const latestFileTime = latestFilePoint?.createdAt ? new Date(latestFilePoint.createdAt).getTime() : 0
      const latestGitTime = summary.gitLatestAt ? new Date(summary.gitLatestAt).getTime() : 0
      const latestAt = latestGitTime >= latestFileTime ? summary.gitLatestAt : latestFilePoint?.createdAt

      if (els.gitOverviewRecoveryCount) els.gitOverviewRecoveryCount.textContent = String(totalCount)
      if (els.gitOverviewLatestPoint) els.gitOverviewLatestPoint.textContent = latestAt ? formatRecoveryDate(latestAt) : '-'
      if (els.gitOverviewStorageSize) els.gitOverviewStorageSize.textContent = totalCount ? formatBytes(totalBytes) : '-'
      if (els.gitOverviewStorageProgress) els.gitOverviewStorageProgress.style.width = `${storagePercent}%`
      if (els.gitOverviewStoragePercent) els.gitOverviewStoragePercent.textContent = `${storagePercent.toFixed(1)}%`
      if (els.gitOverviewStorageDetail) els.gitOverviewStorageDetail.textContent = `已用 ${formatBytes(totalBytes)} / 总计 512 MB`
      setFlowStep(els.gitStepSnapshot, totalCount ? 'complete' : 'idle')
      setFlowStep(els.gitStepRollback, totalCount ? 'complete' : 'idle')
    }

    async function loadOverviewRecoverySummary(project) {
      if (!project?.id) {
        updateOverviewRecoverySummary({})
        return
      }
      const projectId = project.id
      try {
        const [fileResult, gitResult] = await Promise.all([
          window.api?.listRecoveryPoints ? window.api.listRecoveryPoints(projectId) : Promise.resolve({ success: true, points: [] }),
          (project.path && window.api?.gitRecoverySummary) ? window.api.gitRecoverySummary(project.path) : Promise.resolve({ success: true, count: 0, latestAt: '', totalBytes: 0 })
        ])
        const activeProject = getActiveProject()
        if (activeProject?.id !== projectId) return
        updateOverviewRecoverySummary({
          points: fileResult?.success && Array.isArray(fileResult.points) ? fileResult.points : [],
          gitCount: gitResult?.success ? gitResult.count : 0,
          gitLatestAt: gitResult?.success ? gitResult.latestAt : '',
          gitBytes: gitResult?.success ? gitResult.totalBytes : 0
        })
      } catch (error) {
        console.warn('[Frontend] 加载恢复点总览失败:', error)
        updateOverviewRecoverySummary({})
      }
    }

    function getRecoveryPointKind(point = {}) {
      if (point.phase === 'before') return { label: '修改前', className: 'before' }
      if (point.phase === 'after') return { label: '完成后', className: 'after' }
      return { label: '文件快照', className: 'file' }
    }

    function getRecoveryPointTitle(point = {}) {
      if (point.message) return point.message
      if (point.changeSessionId) return `AI 自动恢复点 · ${point.changeSessionId}`
      return point.source === 'manual' ? '手动文件恢复点' : 'AI 自动文件恢复点'
    }

    function renderGitHistoryItem(commit) {
      const snapshotKind = getSnapshotKind(commit.message)
      return `
        <div class="git-commit-item" data-kind="git" data-hash="${escapeHtml(commit.hash || '')}">
          <div class="git-commit-top">
            <span class="git-commit-hash-box">${escapeHtml(commit.hash?.substring(0, 7) || '-')}</span>
            <span class="git-snapshot-kind git">Git</span>
            ${snapshotKind ? `<span class="git-snapshot-kind ${snapshotKind.className}">${snapshotKind.label}</span>` : ''}
            <span class="git-commit-msg-text">${escapeHtml(commit.message || '-')}</span>
          </div>
          <div class="git-commit-bottom">
            <span class="git-commit-author">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              ${escapeHtml(commit.author || '-')}
            </span>
            <span class="git-commit-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${escapeHtml(formatRecoveryDate(commit.date))}
            </span>
          </div>
          <div class="git-commit-action-row">
            <span class="git-commit-action" data-action="revert" data-hash="${escapeHtml(commit.hash || '')}" title="恢复到此 Git 恢复点">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              恢复
            </span>
            <span class="git-commit-action" data-action="diff" data-hash="${escapeHtml(commit.hash || '')}" title="查看改动">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              改动
            </span>
            <span class="git-commit-action danger" data-action="hide-git-point" data-hash="${escapeHtml(commit.hash || '')}" title="从恢复点历史中删除此 Git 恢复点（不改源码）">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
              删除
            </span>
          </div>
        </div>
      `
    }

    function renderFileRecoveryPointItem(point) {
      const kind = getRecoveryPointKind(point)
      const skipped = Number(point.skippedFileCount || 0)
      const warnings = Array.isArray(point.warnings) ? point.warnings.length : 0
      return `
        <div class="git-commit-item recovery-point-item" data-kind="file" data-point-id="${escapeHtml(point.id || '')}">
          <div class="git-commit-top">
            <span class="git-commit-hash-box recovery-point-id">${escapeHtml(String(point.id || '').slice(0, 9) || '-')}</span>
            <span class="git-snapshot-kind file">文件级</span>
            <span class="git-snapshot-kind ${kind.className}">${kind.label}</span>
            <span class="git-commit-msg-text">${escapeHtml(getRecoveryPointTitle(point))}</span>
          </div>
          <div class="git-commit-bottom recovery-point-meta">
            <span class="git-commit-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${escapeHtml(formatRecoveryDate(point.createdAt))}
            </span>
            <span>${Number(point.fileCount || 0)} 个文件</span>
            <span>${escapeHtml(formatBytes(point.totalBytes || 0))}</span>
            ${skipped ? `<span class="recovery-point-warning">${skipped} 个跳过</span>` : ''}
            ${warnings ? `<span class="recovery-point-warning">${warnings} 条提醒</span>` : ''}
          </div>
          <div class="git-commit-action-row">
            <span class="git-commit-action" data-action="restore-file-point" data-point-id="${escapeHtml(point.id || '')}" title="恢复这些文件到快照状态">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              恢复
            </span>
            <span class="git-commit-action" data-action="view-file-point" data-point-id="${escapeHtml(point.id || '')}" title="查看恢复点包含的文件">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              文件
            </span>
            <span class="git-commit-action danger" data-action="delete-file-point" data-point-id="${escapeHtml(point.id || '')}" title="删除这个文件级恢复点">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
              删除
            </span>
          </div>
        </div>
      `
    }

    function showRecoveryPointFilesPanel(point) {
      const files = Array.isArray(point?.files) ? point.files : []
      const diffPanel = document.createElement('div')
      diffPanel.className = 'git-diff-panel recovery-point-files-panel'
      diffPanel.innerHTML = `
        <div class="git-diff-header">
          <span class="git-diff-title">文件级恢复点 · ${escapeHtml(String(point?.id || '').slice(0, 9) || '-')}</span>
          <span class="git-diff-close">x</span>
        </div>
        <div class="git-diff-content">
          <div class="recovery-point-file-summary">${files.length} 个文件 · ${escapeHtml(formatBytes(point?.totalBytes || 0))}</div>
          <div class="recovery-point-file-list">
            ${files.length ? files.map(file => `
              <div class="recovery-point-file-row ${file.skipped ? 'skipped' : ''}">
                <span class="recovery-point-file-state">${file.existed ? (file.skipped ? '跳过' : '已存') : '新增前'}</span>
                <span class="recovery-point-file-path">${escapeHtml(file.relativePath || file.path || '-')}</span>
                <span class="recovery-point-file-size">${file.size ? escapeHtml(formatBytes(file.size)) : ''}</span>
              </div>
            `).join('') : '<div class="git-empty">这个恢复点没有文件记录</div>'}
          </div>
        </div>
      `
      document.body.appendChild(diffPanel)
      diffPanel.querySelector('.git-diff-close').onclick = () => diffPanel.remove()
    }

    async function loadGitStatus() {
      const project = getActiveProject()
      if (currentGitView === 'errors') renderErrorScanForProject(project)
      if (!project || !project.path) {
        if (els.gitBranch) els.gitBranch.textContent = '-'
        if (els.gitStatusBadge) {
          els.gitStatusBadge.textContent = '-'
          els.gitStatusBadge.className = 'git-status-badge clean'
        }
        if (els.gitRemote) els.gitRemote.textContent = '-'
        if (els.gitSyncStatus) els.gitSyncStatus.textContent = ((window.i18n?.t?.('auto.js_git_panel_360_30') ?? ((window.i18n?.t?.('auto.js_git_panel_360_77') ?? '未选择'))))
        if (els.gitFileList) els.gitFileList.innerHTML = ((window.i18n?.t?.('auto.js_git_panel_361_78') ?? '<div class="git-empty">请先选择项目</div>'))
        if (els.gitFileCount) els.gitFileCount.textContent = '0'
        if (els.gitSubnavChangeCount) els.gitSubnavChangeCount.textContent = '0'
        if (els.gitOverviewPendingCount) els.gitOverviewPendingCount.textContent = '0'
        if (els.gitStatusDot) els.gitStatusDot.className = 'git-status-dot'
        if (els.gitStatusText) els.gitStatusText.textContent = ((window.i18n?.t?.('auto.js_git_panel_364_31') ?? ((window.i18n?.t?.('auto.js_git_panel_364_79') ?? '未选择项目'))))
        updateSafetyState(((window.i18n?.t?.('auto.js_git_panel_365_80') ?? '未选择')), '')
        setOverviewMode('idle', '请选择一个项目，系统会自动检查它是否具备恢复能力。')
        setFlowStep(els.gitStepProject, 'idle')
        setFlowStep(els.gitStepChanges, 'idle')
        updateOverviewRecoverySummary([])
        renderGitFiles([])
        return
      }
      try {
        if (window.api && window.api.gitStatus) {
          const result = await window.api.gitStatus(project.path)
          if (result.success) {
            const status = result.status
            project.gitStatus = status
            if (els.gitBranch) els.gitBranch.textContent = status.branch || '-'
            if (status.clean) {
              els.gitStatusBadge.textContent = ((window.i18n?.t?.('auto.js_git_panel_376_32') ?? ((window.i18n?.t?.('auto.js_git_panel_376_81') ?? '已保护'))))
              els.gitStatusBadge.className = 'git-status-badge clean'
              if (els.gitStatusDot) els.gitStatusDot.className = 'git-status-dot'
              if (els.gitStatusText) els.gitStatusText.textContent = ((window.i18n?.t?.('auto.js_git_panel_379_33') ?? ((window.i18n?.t?.('auto.js_git_panel_379_82') ?? '暂无待快照改动'))))
              updateSafetyState(((window.i18n?.t?.('auto.js_git_panel_380_83') ?? '已保护')), 'protected')
              setOverviewMode('protected', '当前没有待快照改动，已有恢复点可用于回退。')
              setFlowStep(els.gitStepProject, 'complete')
              setFlowStep(els.gitStepChanges, 'complete')
            } else {
              const modifiedCount = status.modified || status.files?.length || 0
              els.gitStatusBadge.textContent = String(modifiedCount) + ((window.i18n?.t?.('auto.js_git_panel_383_84') ?? ' 项待快照'))
              els.gitStatusBadge.className = 'git-status-badge modified'
              if (els.gitStatusDot) els.gitStatusDot.className = 'git-status-dot warning'
              if (els.gitStatusText) els.gitStatusText.textContent = String(modifiedCount) + ((window.i18n?.t?.('auto.js_git_panel_386_85') ?? ' 项待创建恢复点'))
              updateSafetyState(((window.i18n?.t?.('auto.js_git_panel_387_86') ?? '待快照')), 'unprotected')
              setOverviewMode('pending', `发现 ${modifiedCount} 项待快照改动，建议先创建恢复点再继续大改。`)
              setFlowStep(els.gitStepProject, 'complete')
              setFlowStep(els.gitStepChanges, 'attention')
            }
            if (els.gitRemote) els.gitRemote.textContent = status.remote || ((window.i18n?.t?.('auto.js_git_panel_389_87') ?? '本地'))
            if (els.gitSyncStatus) els.gitSyncStatus.textContent = getSyncText(status)
            if (els.gitFileCount) els.gitFileCount.textContent = status.files?.length || 0
            if (els.gitSubnavChangeCount) els.gitSubnavChangeCount.textContent = status.files?.length || 0
            if (els.gitOverviewPendingCount) els.gitOverviewPendingCount.textContent = String(status.files?.length || 0)
            loadOverviewRecoverySummary(project)
            renderGitFiles(status.files || [])
            renderProjectList()
          } else {
            if (els.gitBranch) els.gitBranch.textContent = ((window.i18n?.t?.('auto.js_git_panel_395_34') ?? ((window.i18n?.t?.('auto.js_git_panel_395_88') ?? '未开启'))))
            if (els.gitStatusBadge) {
              els.gitStatusBadge.textContent = ((window.i18n?.t?.('auto.js_git_panel_397_35') ?? ((window.i18n?.t?.('auto.js_git_panel_397_89') ?? '未保护'))))
              els.gitStatusBadge.className = 'git-status-badge modified'
            }
            if (els.gitRemote) els.gitRemote.textContent = '-'
            if (els.gitSyncStatus) els.gitSyncStatus.textContent = ((window.i18n?.t?.('auto.js_git_panel_401_36') ?? ((window.i18n?.t?.('auto.js_git_panel_401_90') ?? '本地'))))
            if (els.gitFileList) els.gitFileList.innerHTML = ((window.i18n?.t?.('auto.js_git_panel_402_91') ?? '<div class="git-empty">当前项目还没有开启 AI 安全快照</div>'))
            if (els.gitFileCount) els.gitFileCount.textContent = '0'
            if (els.gitSubnavChangeCount) els.gitSubnavChangeCount.textContent = '0'
            if (els.gitOverviewPendingCount) els.gitOverviewPendingCount.textContent = '0'
            if (els.gitStatusDot) els.gitStatusDot.className = 'git-status-dot warning'
            if (els.gitStatusText) els.gitStatusText.textContent = ((window.i18n?.t?.('auto.js_git_panel_405_37') ?? ((window.i18n?.t?.('auto.js_git_panel_405_92') ?? '未开启保护'))))
            updateSafetyState(((window.i18n?.t?.('auto.js_git_panel_406_93') ?? '未保护')), 'unprotected')
            setOverviewMode('danger', '当前项目还没有开启 AI 安全快照，请先开启保护或创建恢复点。')
            setFlowStep(els.gitStepProject, 'complete')
            setFlowStep(els.gitStepChanges, 'idle')
            updateOverviewRecoverySummary([])
            renderGitFiles([])
          }
        }
      } catch (e) {
        console.error('[Frontend] 加载 AI 安全快照状态失败:', e)
        updateSafetyState(((window.i18n?.t?.('auto.js_git_panel_411_94') ?? '异常')), 'unprotected')
        setOverviewMode('danger', '安全快照状态加载失败，请稍后重试或检查项目路径。')
        setFlowStep(els.gitStepProject, 'issue')
        renderGitFiles([])
      }
    }

    async function loadGitStatusForProject(project) {
      if (!project || !project.path) return
      try {
        if (window.api && window.api.gitStatus) {
          const result = await window.api.gitStatus(project.path)
          if (result.success) {
            project.gitStatus = result.status
            project.branchName = result.status?.branch || project.branchName || ''
          } else {
            project.gitStatus = { branch: '', clean: true, modified: 0, error: result.error }
          }
          renderProjectList()
        }
      } catch (e) {
        console.error('[Frontend] 加载 AI 安全快照状态失败', e)
        project.gitStatus = { branch: '', clean: true, modified: 0, error: e.message }
        renderProjectList()
      }
    }

    async function initGitForProject(project) {
      if (!project || !project.path) return
      AppLogger.debug('[Frontend] 开启 AI 安全快照:', project.path)
      const loadingToast = showToast(((window.i18n?.t?.('auto.js_git_panel_437_38') ?? ((window.i18n?.t?.('auto.js_git_panel_437_95') ?? '正在开启 AI 安全快照...')))), 'loading', 0)
      try {
        if (window.api && window.api.gitInit) {
          const result = await window.api.gitInit(project.path)
          AppLogger.debug('[Frontend] gitInit 结果:', result)
          removeToast(loadingToast)
          if (result.success) {
            showToast(((window.i18n?.t?.('auto.js_git_panel_444_39') ?? ((window.i18n?.t?.('auto.js_git_panel_444_96') ?? 'AI 安全快照已开启')))), 'success')
            await loadGitStatusForProject(project)
          } else {
            showToast(((window.i18n?.t?.('auto.js_git_panel_447_40') ?? ((window.i18n?.t?.('auto.js_git_panel_447_97') ?? '开启失败: ')))) + (result.error || ((window.i18n?.t?.('auto.js_git_panel_447_98') ?? '未知错误'))), 'error')
          }
        }
      } catch (e) {
        removeToast(loadingToast)
        console.error('[Frontend] 开启 AI 安全快照失败:', e)
        showToast(((window.i18n?.t?.('auto.js_git_panel_453_41') ?? ((window.i18n?.t?.('auto.js_git_panel_453_99') ?? '开启失败: ')))) + e.message, 'error')
      }
    }

    function getHistoryRelativeTime(value) {
      const timestamp = Date.parse(value || '')
      if (!timestamp) return '时间未知'
      const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
      if (seconds < 60) return '刚刚'
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
      if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`
      return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    }

    function getHistoryGroup(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const day = 86400000
      if (date.getTime() >= start) return '今天'
      if (date.getTime() >= start - day) return '昨天'
      return '更早'
    }

    function getFilteredHistoryEntries() {
      const query = String(els.gitHistorySearch?.value || '').trim().toLowerCase()
      const timeFilter = els.gitHistoryTime?.value || 'all'
      const sort = els.gitHistorySort?.value || 'newest'
      const now = Date.now()
      const startToday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()
      const cutoffs = { today: startToday, week: now - 7 * 86400000, month: now - 30 * 86400000 }
      return historyEntries
        .filter(entry => historyQuickFilter === 'all' || entry.type === historyQuickFilter)
        .filter(entry => timeFilter === 'all' || entry.timestamp >= cutoffs[timeFilter])
        .filter(entry => !query || entry.searchText.includes(query))
        .sort((a, b) => sort === 'oldest' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp)
    }

    function renderHistoryStats() {
      const fileCount = historyEntries.filter(entry => entry.type === 'file').length
      const gitCount = historyEntries.filter(entry => entry.type === 'git').length
      const latest = [...historyEntries].sort((a, b) => b.timestamp - a.timestamp)[0]
      if (els.gitHistoryTotal) els.gitHistoryTotal.textContent = String(historyEntries.length)
      if (els.gitHistoryTotalHint) els.gitHistoryTotalHint.textContent = `文件级 ${fileCount} · Git 级 ${gitCount}`
      if (els.gitHistoryFileCount) els.gitHistoryFileCount.textContent = String(fileCount)
      if (els.gitHistoryGitCount) els.gitHistoryGitCount.textContent = String(gitCount)
      if (els.gitHistoryLatest) els.gitHistoryLatest.textContent = latest ? getHistoryRelativeTime(latest.createdAt) : '--'
      if (els.gitHistoryLatestDate) els.gitHistoryLatestDate.textContent = latest
        ? new Date(latest.timestamp).toLocaleString('zh-CN', { hour12: false })
        : '暂无记录'
      els.gitHistoryStatButtons?.forEach(button => button.classList.toggle('active', button.dataset.historyStat === historyActiveStat))
    }

    function getHistoryEntryFiles(entry) {
      if (entry.type !== 'file') return []
      return Array.isArray(entry.raw?.files) ? entry.raw.files : []
    }

    function renderHistoryPreview(entry) {
      if (!expandedHistoryKeys.has(entry.key)) return ''
      const files = getHistoryEntryFiles(entry)
      if (entry.type === 'git') {
        return `<div class="git-history-change-preview"><div class="git-history-preview-head"><strong>版本改动预览</strong><button type="button" data-history-action="diff" data-history-key="${escapeHtml(entry.key)}">查看完整改动</button></div><div class="git-history-preview-note">该恢复点关联 Git 提交 ${escapeHtml(entry.shortId)}，可查看完整差异后再决定是否恢复。</div></div>`
      }
      return `<div class="git-history-change-preview"><div class="git-history-preview-head"><strong>变更预览（${files.length} 个文件）</strong><button type="button" data-history-action="view-file-point" data-history-key="${escapeHtml(entry.key)}">查看全部文件</button></div><div class="git-history-preview-files">${files.slice(0, 4).map(file => {
        const path = file.relativePath || file.path || '-'
        const state = file.skipped ? '跳过' : (file.existed ? 'M' : 'A')
        return `<span><i class="state-${state.toLowerCase()}">${state}</i><b>${escapeHtml(path)}</b><em>${file.skipped ? '未纳入' : '已记录'}</em></span>`
      }).join('') || '<div class="git-history-preview-note">这个恢复点没有文件明细。</div>'}</div></div>`
    }

    function renderHistoryTimelineItem(entry) {
      const expanded = expandedHistoryKeys.has(entry.key)
      const selected = entry.key === selectedHistoryKey
      const fileCount = entry.type === 'file' ? Number(entry.raw?.fileCount || getHistoryEntryFiles(entry).length || 0) : 0
      return `
        <article class="git-history-entry ${selected ? 'selected' : ''} ${expanded ? 'expanded' : ''}" data-history-key="${escapeHtml(entry.key)}">
          <span class="git-history-dot"></span>
          <div class="git-history-entry-main">
            <time>${escapeHtml(new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))}</time>
            <div class="git-history-entry-copy">
              <div class="git-history-entry-title">
                <strong>${escapeHtml(entry.title)}</strong>
                <span class="git-history-tag ${entry.type}">${entry.type === 'file' ? '文件级' : 'Git'}</span>
                ${entry.type === 'file' ? '<span class="git-history-tag snapshot">文件快照</span>' : ''}
              </div>
              <p>${escapeHtml(entry.description)}</p>
              <div class="git-history-entry-meta">
                <span>${escapeHtml(entry.author || 'Lingxi AI')}</span>
                <span>${entry.type === 'file' ? `${fileCount} 个文件` : entry.shortId}</span>
                <span>${entry.type === 'file' ? escapeHtml(formatBytes(entry.raw?.totalBytes || 0)) : 'Git 恢复点'}</span>
              </div>
            </div>
            <div class="git-history-entry-actions">
              <button type="button" class="primary" data-history-action="restore" data-history-key="${escapeHtml(entry.key)}">恢复</button>
              <button type="button" data-history-action="${entry.type === 'file' ? 'view-file-point' : 'diff'}" data-history-key="${escapeHtml(entry.key)}">${entry.type === 'file' ? '查看文件' : '查看改动'}</button>
              <button type="button" class="danger" data-history-action="delete" data-history-key="${escapeHtml(entry.key)}">删除</button>
              <button type="button" class="icon" data-history-action="toggle" data-history-key="${escapeHtml(entry.key)}" aria-label="${expanded ? '收起详情' : '展开详情'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m8 10 4 4 4-4"/></svg>
              </button>
            </div>
          </div>
          ${renderHistoryPreview(entry)}
        </article>`
    }

    function renderHistoryDetail(entry) {
      if (!els.gitHistoryDetail) return
      if (!entry) {
        els.gitHistoryDetail.innerHTML = '<div class="git-history-detail-empty">选择一个恢复点查看详情</div>'
        return
      }
      const files = getHistoryEntryFiles(entry)
      const pointKind = entry.type === 'file' ? getRecoveryPointKind(entry.raw).label : 'Git 提交'
      els.gitHistoryDetail.innerHTML = `
        <div class="git-history-detail-head">
          <div>
            <h2>${escapeHtml(entry.title)}</h2>
            <div><span class="git-history-tag ${entry.type}">${entry.type === 'file' ? '文件级' : 'Git'}</span>${entry.type === 'file' ? '<span class="git-history-tag snapshot">文件快照</span>' : ''}</div>
          </div>
          <button type="button" class="icon" data-history-action="toggle" data-history-key="${escapeHtml(entry.key)}" aria-label="展开当前恢复点"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
        </div>
        <section class="git-history-detail-section">
          <h3>描述</h3>
          <p>${escapeHtml(entry.description)}</p>
          <dl>
            <div><dt>恢复类型</dt><dd>${escapeHtml(pointKind)}</dd></div>
            <div><dt>所属项目</dt><dd>${escapeHtml(getActiveProject()?.name || '当前项目')}</dd></div>
            <div><dt>创建时间</dt><dd>${escapeHtml(new Date(entry.timestamp).toLocaleString('zh-CN', { hour12: false }))}</dd></div>
            <div><dt>文件数量</dt><dd>${entry.type === 'file' ? Number(entry.raw?.fileCount || files.length || 0) : '版本级'}</dd></div>
            <div><dt>大小</dt><dd>${entry.type === 'file' ? escapeHtml(formatBytes(entry.raw?.totalBytes || 0)) : entry.shortId}</dd></div>
          </dl>
        </section>
        <section class="git-history-detail-section git-history-affected">
          <h3>影响的文件 ${files.length ? `(${files.length})` : ''}</h3>
          ${files.length ? files.slice(0, 6).map(file => `<div><span>${file.skipped ? 'S' : (file.existed ? 'M' : 'A')}</span><b>${escapeHtml(file.relativePath || file.path || '-')}</b><em>${file.skipped ? '跳过' : '已记录'}</em></div>`).join('') : `<p>${entry.type === 'git' ? 'Git 恢复点的文件差异可通过“查看改动”打开。' : '暂无文件明细。'}</p>`}
        </section>
        <div class="git-history-detail-actions">
          <button type="button" data-history-action="${entry.type === 'file' ? 'view-file-point' : 'diff'}" data-history-key="${escapeHtml(entry.key)}">${entry.type === 'file' ? '查看全部文件' : '查看全部改动'}</button>
          <button type="button" class="primary" data-history-action="restore" data-history-key="${escapeHtml(entry.key)}">恢复到此处</button>
        </div>`
      bindHistoryDynamicEvents(els.gitHistoryDetail)
    }

    function renderHistoryPages(totalPages) {
      if (!els.gitHistoryPages) return
      if (totalPages <= 1) {
        els.gitHistoryPages.innerHTML = ''
        return
      }
      const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
      const visible = pages.filter(page => page === 1 || page === totalPages || Math.abs(page - historyPage) <= 1)
      let previous = 0
      const buttons = []
      visible.forEach(page => {
        if (previous && page - previous > 1) buttons.push('<span>...</span>')
        buttons.push(`<button type="button" class="${page === historyPage ? 'active' : ''}" data-history-page="${page}">${page}</button>`)
        previous = page
      })
      els.gitHistoryPages.innerHTML = `<button type="button" data-history-page="${Math.max(1, historyPage - 1)}" ${historyPage === 1 ? 'disabled' : ''} aria-label="上一页">‹</button>${buttons.join('')}<button type="button" data-history-page="${Math.min(totalPages, historyPage + 1)}" ${historyPage === totalPages ? 'disabled' : ''} aria-label="下一页">›</button>`
      els.gitHistoryPages.querySelectorAll('[data-history-page]').forEach(button => {
        button.onclick = () => {
          historyPage = Number(button.dataset.historyPage) || 1
          renderHistoryWorkbench()
        }
      })
    }

    function renderHistoryWorkbench() {
      if (!els.gitHistoryList) return
      renderHistoryStats()
      if (els.gitHistoryNotices) {
        els.gitHistoryNotices.innerHTML = historyLoadWarnings.map(message => `<div class="git-history-warning">${escapeHtml(message)}</div>`).join('')
      }
      const filtered = getFilteredHistoryEntries()
      const totalPages = Math.max(1, Math.ceil(filtered.length / historyPageSize))
      historyPage = Math.min(historyPage, totalPages)
      const pageEntries = filtered.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize)
      if (els.gitHistoryResultCount) els.gitHistoryResultCount.textContent = `共 ${filtered.length} 个恢复点`
      renderHistoryPages(totalPages)

      let currentGroup = ''
      els.gitHistoryList.innerHTML = pageEntries.length ? pageEntries.map(entry => {
        const group = getHistoryGroup(entry.timestamp)
        const heading = group !== currentGroup ? `<div class="git-history-day"><span>${group}</span><em>${filtered.filter(item => getHistoryGroup(item.timestamp) === group).length}</em></div>` : ''
        currentGroup = group
        return `${heading}${renderHistoryTimelineItem(entry)}`
      }).join('') : '<div class="git-history-empty"><strong>没有匹配的恢复点</strong><span>可调整搜索内容或筛选条件后重试</span></div>'

      bindHistoryDynamicEvents(els.gitHistoryList)
      const selected = historyEntries.find(entry => entry.key === selectedHistoryKey)
      renderHistoryDetail(selected || pageEntries[0] || null)
    }

    function bindHistoryDynamicEvents(root) {
      root?.querySelectorAll('[data-history-key]').forEach(element => {
        element.onclick = async event => {
          event.stopPropagation()
          const key = element.dataset.historyKey
          const entry = historyEntries.find(item => item.key === key)
          if (!entry) return
          const action = element.dataset.historyAction
          if (action) {
            await handleHistoryAction(action, entry)
            return
          }
          selectedHistoryKey = key
          renderHistoryWorkbench()
        }
      })
    }

    async function handleHistoryAction(action, entry) {
      const project = getActiveProject()
      if (!project) return
      if (action === 'toggle') {
        if (expandedHistoryKeys.has(entry.key)) expandedHistoryKeys.delete(entry.key)
        else expandedHistoryKeys.add(entry.key)
        selectedHistoryKey = entry.key
        renderHistoryWorkbench()
        return
      }
      if (action === 'diff') return showGitDiffPanel(project.path, entry.raw.hash)
      if (action === 'view-file-point') return showRecoveryPointFilesPanel(entry.raw)
      if (action === 'restore') {
        showDangerConfirm({
          title: entry.type === 'git' ? `恢复到 ${entry.shortId}` : '恢复文件级恢复点',
          body: entry.type === 'git'
            ? '确定恢复到这个 Git 恢复点吗？当前没有保存成恢复点的改动可能会被覆盖。'
            : `确定恢复这个文件级恢复点吗？将按快照恢复 ${Number(entry.raw?.fileCount || 0)} 个目标文件。`,
          confirmText: '确认恢复',
          onConfirm: async () => {
            try {
              const result = entry.type === 'git'
                ? await window.api.gitReset(project.path, entry.raw.hash)
                : await window.api.restoreRecoveryPoint(project.id, entry.raw.id, { projectPath: project.path })
              if (!result?.success && !result?.partial) throw new Error(result?.error || '未知错误')
              showToast(entry.type === 'git' ? '恢复成功' : `已恢复 ${result.restored?.length || 0} 个文件`, result.partial ? 'warning' : 'success')
              await loadGitHistory()
              await loadGitStatus()
              renderProjectList()
            } catch (error) {
              showToast(`恢复失败：${error.message || error}`, 'error')
            }
          }
        })
        return
      }
      if (action === 'delete') {
        showDangerConfirm({
          title: entry.type === 'git' ? '删除 Git 恢复点' : '删除文件级恢复点',
          body: entry.type === 'git'
            ? '会从恢复点历史中移除这个 Git 恢复点，不会修改项目源码或真正删除 Git 提交记录。'
            : '只会删除这个恢复点快照，不会删除项目源码文件。删除后不能再用它恢复。',
          confirmText: '确认删除',
          onConfirm: async () => {
            try {
              const result = entry.type === 'git'
                ? await window.api.gitHideRecoveryCommit(project.path, entry.raw.hash)
                : await window.api.deleteRecoveryPoint(project.id, entry.raw.id)
              if (!result?.success) throw new Error(result?.error || '未知错误')
              if (selectedHistoryKey === entry.key) selectedHistoryKey = ''
              showToast('恢复点已删除', 'success')
              await loadGitHistory()
            } catch (error) {
              showToast(`删除失败：${error.message || error}`, 'error')
            }
          }
        })
      }
    }

    async function loadGitHistory() {
      const project = getActiveProject()
      if (!project || !project.path) {
        historyEntries = []
        renderHistoryStats()
        if (els.gitHistoryResultCount) els.gitHistoryResultCount.textContent = '共 0 个恢复点'
        if (els.gitHistoryPages) els.gitHistoryPages.innerHTML = ''
        if (els.gitHistoryList) els.gitHistoryList.innerHTML = '<div class="git-history-empty"><strong>请先选择项目</strong><span>选择项目后即可查看文件级与 Git 级恢复点</span></div>'
        renderHistoryDetail(null)
        return
      }

      if (els.gitHistoryList) els.gitHistoryList.innerHTML = '<div class="git-empty">正在加载恢复点...</div>'
      historyLoadWarnings = []
      const entries = []
      const [gitResult, recoveryResult] = await Promise.all([
        window.api?.gitLog ? window.api.gitLog(project.path).catch(error => ({ success: false, error: error.message })) : Promise.resolve({ success: true, commits: [] }),
        window.api?.listRecoveryPoints ? window.api.listRecoveryPoints(project.id).catch(error => ({ success: false, error: error.message })) : Promise.resolve({ success: true, points: [] })
      ])

      if (gitResult?.success && Array.isArray(gitResult.commits)) {
        gitResult.commits.forEach((commit, index) => {
          const timestamp = Date.parse(commit.date || '') || Date.now() - 100000 - index
          const title = commit.message || `Git 恢复点 ${String(commit.hash || '').slice(0, 7)}`
          entries.push({
            key: `git:${commit.hash || index}`,
            type: 'git',
            timestamp,
            createdAt: commit.date,
            title,
            description: getSnapshotKind(commit.message)?.label ? `${getSnapshotKind(commit.message).label} · 关联版本控制的完整恢复点` : '关联版本控制的完整恢复点',
            author: commit.author || 'Lingxi AI',
            shortId: String(commit.hash || '').slice(0, 7) || '-',
            searchText: `${title} ${commit.author || ''} ${commit.hash || ''}`.toLowerCase(),
            raw: commit
          })
        })
      } else if (gitResult?.error) {
        historyLoadWarnings.push(`Git 历史加载失败：${gitResult.error}`)
      }

      if (recoveryResult?.success && Array.isArray(recoveryResult.points)) {
        latestRecoveryPoints = recoveryResult.points
        recoveryResult.points.forEach((point, index) => {
          const timestamp = Date.parse(point.createdAt || '') || Date.now() - index
          const title = getRecoveryPointTitle(point)
          const files = Array.isArray(point.files) ? point.files : []
          entries.push({
            key: `file:${point.id || index}`,
            type: 'file',
            timestamp,
            createdAt: point.createdAt,
            title,
            description: point.description || `自动快照：项目文件变更与风险扫描的定期备份`,
            author: point.author || 'Lingxi AI',
            shortId: String(point.id || '').slice(0, 9) || '-',
            searchText: `${title} ${point.id || ''} ${files.map(file => file.relativePath || file.path || '').join(' ')}`.toLowerCase(),
            raw: point
          })
        })
      } else if (recoveryResult?.error) {
        historyLoadWarnings.push(`文件级恢复点加载失败：${recoveryResult.error}`)
      }

      historyEntries = entries.sort((a, b) => b.timestamp - a.timestamp)
      if (!historyEntries.some(entry => entry.key === selectedHistoryKey)) selectedHistoryKey = historyEntries[0]?.key || ''
      historyPage = 1
      renderHistoryWorkbench()
    }

    async function showGitDiffPanel(projectPath, hash) {
      const diffPanel = document.createElement('div')
      diffPanel.className = 'git-diff-panel'
      diffPanel.innerHTML = `
        <div class="git-diff-header">
          <span class="git-diff-title">恢复点改动: ${hash.substring(0, 7)}</span>
          <span class="git-diff-close">x</span>
        </div>
        <div class="git-diff-content" id="gitDiffContent">加载中...</div>
      `
      document.body.appendChild(diffPanel)

      try {
        const result = await window.api.gitDiffCommit(projectPath, hash)
        const contentEl = diffPanel.querySelector('.git-diff-content')
        if (result.success) {
          contentEl.innerHTML = `<pre class="git-diff-text">${escapeHtml(result.diff || '无改动内容')}</pre>`
        } else {
          contentEl.textContent = ((window.i18n?.t?.('auto.js_git_panel_557_45') ?? ((window.i18n?.t?.('auto.js_git_panel_557_111') ?? '加载失败: ')))) + (result.error || ((window.i18n?.t?.('auto.js_git_panel_557_112') ?? '未知错误')))
        }
      } catch (e) {
        diffPanel.querySelector('.git-diff-content').textContent = ((window.i18n?.t?.('auto.js_git_panel_560_46') ?? ((window.i18n?.t?.('auto.js_git_panel_560_113') ?? '加载失败: ')))) + e.message
      }

      diffPanel.querySelector('.git-diff-close').onclick = () => {
        diffPanel.remove()
      }
    }

    async function showGitFileDiffPanel(projectPath, filePath) {
      const diffPanel = document.createElement('div')
      diffPanel.className = 'git-diff-panel'
      diffPanel.innerHTML = `
        <div class="git-diff-header">
          <span class="git-diff-title">文件改动: ${escapeHtml(filePath)}</span>
          <span class="git-diff-close">x</span>
        </div>
        <div class="git-diff-content">加载中...</div>
      `
      document.body.appendChild(diffPanel)

      try {
        const result = await window.api.gitFileDiff(projectPath, filePath)
        const contentEl = diffPanel.querySelector('.git-diff-content')
        if (result.success) {
          contentEl.innerHTML = `<pre class="git-diff-text">${escapeHtml(result.diff || '无改动内容')}</pre>`
        } else {
          contentEl.textContent = ((window.i18n?.t?.('auto.js_git_panel_586_47') ?? ((window.i18n?.t?.('auto.js_git_panel_586_114') ?? '加载失败: ')))) + (result.error || ((window.i18n?.t?.('auto.js_git_panel_586_115') ?? '未知错误')))
        }
      } catch (e) {
        diffPanel.querySelector('.git-diff-content').textContent = ((window.i18n?.t?.('auto.js_git_panel_589_48') ?? ((window.i18n?.t?.('auto.js_git_panel_589_116') ?? '加载失败: ')))) + e.message
      }

      diffPanel.querySelector('.git-diff-close').onclick = () => {
        diffPanel.remove()
      }
    }

    function getBranchFileStatusLabel(status) {
      const map = {
        added: '新增',
        modified: '修改',
        deleted: '删除',
        renamed: '重命名',
        copied: '复制'
      }
      return map[status] || '修改'
    }

    function renderBranchDetailPlaceholder(message) {
      if (els.gitBranchDetailTitle) els.gitBranchDetailTitle.textContent = '请选择分支'
      if (els.gitBranchDetailMeta) els.gitBranchDetailMeta.textContent = message || '点击左侧分支查看改动点'
      if (els.gitBranchTimeline) els.gitBranchTimeline.innerHTML = `<div class="git-empty">${escapeHtml(message || '点击左侧分支查看改动点')}</div>`
      if (els.gitBranchCheckoutBtn) els.gitBranchCheckoutBtn.disabled = true
      if (els.gitBranchMergeBtn) els.gitBranchMergeBtn.disabled = true
      if (els.gitBranchDeleteBtn) els.gitBranchDeleteBtn.disabled = true
    }

    function formatMemoDate(value = '') {
      const timestamp = Date.parse(value || '')
      if (!timestamp) return ''
      return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
    }

    function getMemoStatText(memo = {}) {
      const stats = memo.stats || {}
      return `修改 ${Number(stats.modified || 0)} · 新增 ${Number(stats.created || 0)} · 删除 ${Number(stats.deleted || 0)}`
    }

    function resolveMemoAbsolutePath(projectPath = '', memo = {}) {
      const filePath = String(memo.filePath || '').trim()
      if (!filePath) return ''
      if (/^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath)) return filePath
      return `${String(projectPath || '').replace(/[\\/]+$/, '')}\\${filePath.replace(/\//g, '\\')}`
    }

    function renderMemoTimelineItem(projectPath = '', memo = {}) {
      const filePath = resolveMemoAbsolutePath(projectPath, memo)
      const files = Array.isArray(memo.files) ? memo.files : []
      return `
        <div class="git-branch-memo-row" data-memo-path="${escapeHtml(filePath)}">
          <div class="git-branch-memo-main">
            <div class="git-branch-memo-title">${escapeHtml(memo.title || 'AI 操作备忘录')}</div>
            <div class="git-branch-memo-meta">${escapeHtml(formatMemoDate(memo.savedAt || memo.createdAt))} · ${escapeHtml(getMemoStatText(memo))}</div>
            ${memo.summary ? `<div class="git-branch-memo-summary">${escapeHtml(memo.summary)}</div>` : ''}
            ${files.length ? `<div class="git-branch-memo-files">${files.slice(0, 4).map(file => `<span>${escapeHtml(file.path || '')}</span>`).join('')}${files.length > 4 ? `<em>+${files.length - 4}</em>` : ''}</div>` : ''}
          </div>
          <button type="button" class="git-branch-memo-open" data-action="open-memo" data-memo-path="${escapeHtml(filePath)}">备忘录</button>
        </div>
      `
    }

    async function loadAiMemoTimeline(project) {
      if (!project?.path || !window.api?.listAiOperationMemoTimeline) return { success: true, items: [] }
      return window.api.listAiOperationMemoTimeline(project.path)
    }

    async function renderBranchDetail(detail) {
      const branch = detail || {}
      const project = getActiveProject()
      const counts = branch.counts || {}
      const files = Array.isArray(branch.files) ? branch.files : []
      const commits = Array.isArray(branch.commits) ? branch.commits : []
      const isMainline = !!branch.isMainline
      const isCurrent = !!branch.current
      const canMerge = !isMainline && !isCurrent
      const canDelete = !isMainline && !isCurrent

      selectedGitBranch = branch.name || ''
      if (els.gitBranchDetailTitle) els.gitBranchDetailTitle.textContent = isMainline ? `主线 · ${branch.name || '-'}` : `分支 · ${branch.name || '-'}`
      if (els.gitBranchDetailMeta) {
        const currentText = isCurrent ? '当前正在使用' : `当前所在分支：${branch.currentBranch || '-'}`
        const compareText = isMainline ? '主线是稳定基线' : `对比主线：${branch.mainBranchName || '-'}`
        els.gitBranchDetailMeta.textContent = `${currentText} · ${compareText}`
      }
      if (els.gitBranchCheckoutBtn) {
        const checkoutTarget = isCurrent && !isMainline ? branch.mainBranchName : branch.name
        const label = els.gitBranchCheckoutBtn.querySelector('span')
        if (label) label.textContent = isCurrent && !isMainline ? `切回 ${branch.mainBranchName || '主线'}` : (isCurrent ? '当前分支' : '切换')
        els.gitBranchCheckoutBtn.dataset.branch = checkoutTarget || ''
        els.gitBranchCheckoutBtn.disabled = isCurrent && isMainline
        els.gitBranchCheckoutBtn.title = isCurrent && !isMainline
          ? `切换到主线「${branch.mainBranchName || 'main'}」，之后可删除当前分支`
          : (isCurrent ? '当前已在主线' : `切换到「${branch.name}」`)
      }
      if (els.gitBranchMergeBtn) {
        els.gitBranchMergeBtn.disabled = !canMerge
        els.gitBranchMergeBtn.title = canMerge ? `把「${branch.name}」合并到当前所在分支「${branch.currentBranch || '-'}」` : '主线或当前分支不需要在这里合并'
      }
      if (els.gitBranchDeleteBtn) {
        els.gitBranchDeleteBtn.disabled = !canDelete
        els.gitBranchDeleteBtn.title = canDelete ? `删除「${branch.name}」及其分支数据` : '主线或当前分支不能删除'
      }

      const summaryHtml = `
        <div class="git-branch-timeline-item">
          <div class="git-branch-timeline-title">
            <span>${isMainline ? '主线概览' : '相对主线的改动'}</span>
            <em class="git-branch-timeline-meta">${escapeHtml(branch.compareLabel || '')}</em>
          </div>
          <div class="git-branch-summary-grid">
            <div class="git-branch-summary-chip"><strong>${counts.total || 0}</strong>文件</div>
            <div class="git-branch-summary-chip"><strong>${counts.added || 0}</strong>新增</div>
            <div class="git-branch-summary-chip"><strong>${counts.modified || 0}</strong>修改</div>
            <div class="git-branch-summary-chip"><strong>${counts.deleted || 0}</strong>删除</div>
            <div class="git-branch-summary-chip"><strong>${counts.renamed || 0}</strong>重命名</div>
          </div>
          <div class="git-branch-empty-note">${isMainline ? '主线作为稳定基线显示最近提交；分支的新增功能和文件变化会在选中对应分支时展示。' : '这里显示该分支相对主线产生的文件变化，方便先看清楚再决定是否合并或删除。'}</div>
        </div>
      `

      const commitHtml = `
        <div class="git-branch-timeline-item">
          <div class="git-branch-timeline-title">
            <span>${isMainline ? '最近恢复点 / 提交' : '这个分支增加的功能记录'}</span>
            <em class="git-branch-timeline-meta">${commits.length} 条</em>
          </div>
          ${commits.length ? commits.slice(0, 12).map(commit => `
            <div class="git-branch-file-row">
              <span class="git-branch-file-status">${escapeHtml(commit.hash || '-')}</span>
              <span class="git-branch-file-path" title="${escapeHtml(commit.message || '')}">${escapeHtml(commit.message || '未填写说明')} · ${escapeHtml(commit.date || '')}</span>
            </div>
          `).join('') : '<div class="git-branch-empty-note">暂无独立提交记录。</div>'}
        </div>
      `

      const fileHtml = `
        <div class="git-branch-timeline-item">
          <div class="git-branch-timeline-title">
            <span>文件改动点</span>
            <em class="git-branch-timeline-meta">${files.length} 个文件</em>
          </div>
          <div class="git-branch-file-list">
            ${files.length ? files.slice(0, 80).map(file => `
              <div class="git-branch-file-row">
                <span class="git-branch-file-status">${getBranchFileStatusLabel(file.status)}</span>
                <span class="git-branch-file-path" title="${escapeHtml(file.oldName ? `${file.oldName} -> ${file.name}` : file.name)}">${escapeHtml(file.oldName ? `${file.oldName} -> ${file.name}` : file.name)}</span>
              </div>
            `).join('') : '<div class="git-branch-empty-note">相对主线暂无文件差异。</div>'}
          </div>
        </div>
      `

      let memoHtml = ''
      if (isMainline) {
        let memoResult = { success: true, items: [] }
        try {
          memoResult = await loadAiMemoTimeline(project)
        } catch (error) {
          memoResult = { success: false, error: error.message, items: [] }
        }
        const memos = Array.isArray(memoResult.items) ? memoResult.items : []
        memoHtml = `
          <div class="git-branch-timeline-item git-branch-memo-timeline-item">
            <div class="git-branch-timeline-title">
              <span>AI 操作备忘录</span>
              <em class="git-branch-timeline-meta">${memoResult.success ? `${memos.length} 条` : '读取失败'}</em>
            </div>
            <div class="git-branch-memo-list">
              ${memoResult.success
                ? (memos.length ? memos.slice(0, 20).map(memo => renderMemoTimelineItem(project?.path || '', memo)).join('') : '<div class="git-branch-empty-note">当前项目还没有保存 AI 操作备忘录。</div>')
                : `<div class="git-branch-empty-note">备忘录读取失败：${escapeHtml(memoResult.error || '未知错误')}</div>`}
            </div>
          </div>
        `
      }

      if (els.gitBranchTimeline) {
        els.gitBranchTimeline.innerHTML = summaryHtml + memoHtml + commitHtml + fileHtml
        els.gitBranchTimeline.querySelectorAll('[data-action="open-memo"]').forEach(button => {
          button.addEventListener('click', event => {
            event.preventDefault()
            event.stopPropagation()
            const filePath = button.dataset.memoPath || ''
            if (!filePath) return
            const opener = window.api?.showItemInFolder || window.api?.openProjectFolder
            if (!opener) {
              showToast('当前客户端不支持打开备忘录路径', 'error')
              return
            }
            opener(filePath).then(result => {
              if (result && result.success === false) showToast(result.error || '打开备忘录失败', 'error')
            }).catch(error => showToast(error.message || '打开备忘录失败', 'error'))
          })
        })
      }
    }

    async function selectGitBranch(branchName) {
      const project = getActiveProject()
      selectedGitBranch = String(branchName || '').trim()
      if (!project || !project.path || !selectedGitBranch) {
        renderBranchDetailPlaceholder('请先选择项目和分支')
        return
      }
      els.gitBranchList?.querySelectorAll('.git-branch-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.branch === selectedGitBranch)
      })
      if (els.gitBranchDetailTitle) els.gitBranchDetailTitle.textContent = selectedGitBranch
      if (els.gitBranchDetailMeta) els.gitBranchDetailMeta.textContent = '正在读取分支改动...'
      if (els.gitBranchTimeline) els.gitBranchTimeline.innerHTML = '<div class="git-empty">正在读取分支改动...</div>'
      try {
        if (!window.api?.gitBranchDetail) {
          renderBranchDetailPlaceholder('当前客户端不支持分支详情')
          return
        }
        const result = await window.api.gitBranchDetail(project.path, selectedGitBranch)
        if (!result.success) {
          renderBranchDetailPlaceholder(`加载分支详情失败: ${result.error || '未知错误'}`)
          return
        }
        await renderBranchDetail(result.branch)
      } catch (e) {
        renderBranchDetailPlaceholder(`加载分支详情失败: ${e.message}`)
      }
    }

    async function mergeBranchByName(branchName = '', options = {}) {
      const project = getActiveProject()
      const branch = String(branchName || selectedGitBranch || '').trim()
      if (!project || !project.path || !branch) {
        showToast('请先选择分支', 'error')
        return { success: false, error: 'missing_branch' }
      }
      if (/^(main|master)$/i.test(branch)) {
        showToast('主线分支不需要合并到自己', 'warning')
        return { success: false, error: 'mainline' }
      }
      if (options.confirm !== false) {
        const confirmed = window.confirm(`将把分支「${branch}」合并到当前所在分支。\n\n合并前建议先创建恢复点，确定继续吗？`)
        if (!confirmed) return { success: false, error: 'cancelled' }
      }
      try {
        const res = await window.api.gitMerge(project.path, branch)
        if (res?.success) {
          showToast('合并成功', 'success')
          selectedGitBranch = branch
          loadGitStatus()
          if (options.reloadBranches !== false) loadGitBranches()
          await onBranchSessionChanged({ reason: 'merge', branch })
          renderProjectList()
          return { success: true, branch }
        }
        showToast(`合并失败: ${res?.error || '未知错误'}`, 'error')
        return { success: false, error: res?.error || 'merge_failed' }
      } catch (e) {
        showToast(`合并失败: ${e.message}`, 'error')
        return { success: false, error: e.message }
      }
    }

    async function mergeSelectedGitBranch() {
      return mergeBranchByName(selectedGitBranch)
    }

    async function checkoutSelectedGitBranch() {
      const project = getActiveProject()
      const branch = String(els.gitBranchCheckoutBtn?.dataset.branch || selectedGitBranch || '').trim()
      if (!project?.path || !branch) {
        showToast('请先选择要切换的分支', 'error')
        return { success: false, error: 'missing_branch' }
      }
      if (!window.api?.gitCheckout) {
        showToast('当前客户端不支持切换分支', 'error')
        return { success: false, error: 'unsupported' }
      }
      els.gitBranchCheckoutBtn.disabled = true
      try {
        const result = await window.api.gitCheckout(project.path, branch)
        if (!result?.success) {
          showToast(`切换失败: ${result?.error || '未知错误'}`, 'error')
          return { success: false, error: result?.error || 'checkout_failed' }
        }
        project.branchName = branch
        selectedGitBranch = branch
        await onBranchSessionChanged({ reason: 'checkout', branch })
        renderProjectList()
        await loadGitBranches()
        loadGitStatus()
        showToast(`已切换到「${branch}」`, 'success')
        return { success: true, branch }
      } catch (error) {
        showToast(`切换失败: ${error.message}`, 'error')
        if (els.gitBranchCheckoutBtn) els.gitBranchCheckoutBtn.disabled = false
        return { success: false, error: error.message }
      }
    }

    async function openBranchDetail(branchName = '', options = {}) {
      const project = getActiveProject()
      const branch = String(branchName || selectedGitBranch || '').trim()
      if (!project || !project.path || !branch) {
        showToast('请先选择分支', 'error')
        return { success: false, error: 'missing_branch' }
      }
      if (chatMessages) chatMessages.style.display = 'none'
      window.LingxiPanelManager?.openExclusive?.('git', { hideChat: true })
      els.gitPanel?.classList.remove('show')
      els.gitBranchPanel?.classList.add('show')
      selectedGitBranch = branch
      await loadGitBranches()
      await selectGitBranch(branch)
      if (options.focusMerge && els.gitBranchMergeBtn) {
        els.gitBranchMergeBtn.focus?.()
      }
      return { success: true, branch }
    }

    async function deleteSelectedGitBranch() {
      const project = getActiveProject()
      const branch = selectedGitBranch
      if (!project || !project.path || !branch) {
        showToast('请先选择分支', 'error')
        return
      }
      if (!window.api?.gitDeleteBranch) {
        showToast('当前客户端不支持删除分支', 'error')
        return
      }
      const confirmed = window.BranchDangerDialog
        ? await window.BranchDangerDialog.show({ branchName: branch })
        : window.confirm(`将删除分支「${branch}」及其聊天会话、上下文、协作记录、临时 AI 记录和项目路线数据。\n\n如果该分支代码尚未合并到主线，将无法再从这个分支继续找回。\n\n确定删除吗？`)
      if (!confirmed) return
      try {
        const res = await window.api.gitDeleteBranch(project.id, project.path, branch)
        if (res.success) {
          showToast(`已删除分支「${branch}」及其所有分支数据`, 'success')
          selectedGitBranch = ''
          loadGitBranches()
          loadGitStatus()
          await onBranchSessionChanged({ reason: 'delete', branch })
          renderProjectList()
        } else {
          showToast(`删除失败: ${res.error || '未知错误'}`, 'error')
        }
      } catch (e) {
        showToast(`删除失败: ${e.message}`, 'error')
      }
    }

    async function loadGitBranches() {
      const project = getActiveProject()
      if (els.gitBranchCheckoutBtn) els.gitBranchCheckoutBtn.onclick = checkoutSelectedGitBranch
      if (els.gitBranchMergeBtn) els.gitBranchMergeBtn.onclick = mergeSelectedGitBranch
      if (els.gitBranchDeleteBtn) els.gitBranchDeleteBtn.onclick = deleteSelectedGitBranch
      if (!project || !project.path) {
        els.gitBranchList.innerHTML = ((window.i18n?.t?.('auto.js_git_panel_600_117') ?? '<div class="git-empty">请先选择项目</div>'))
        renderBranchDetailPlaceholder('请先选择项目')
        return
      }
      try {
        if (window.api && window.api.gitBranches) {
          const result = await window.api.gitBranches(project.path)
          if (!result.success) {
            els.gitBranchList.innerHTML = `<div class="git-empty">加载分支失败: ${escapeHtml(result.error || '未知错误')}</div>`
            renderBranchDetailPlaceholder('加载分支失败')
            return
          }
          const branches = (result.branches || [])
            .filter(b => String(b?.name || '').trim())
            .sort((a, b) =>
              Number(!!b.isMainline) - Number(!!a.isMainline) ||
              String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
            )
          if (branches.length === 0) {
            els.gitBranchList.innerHTML = ((window.i18n?.t?.('auto.js_git_panel_659_126') ?? '<div class="git-empty">暂无分支</div>'))
            renderBranchDetailPlaceholder('暂无分支')
            return
          }

          const selectedStillExists = branches.some(b => String(b.name || '').trim() === selectedGitBranch)
          const defaultBranch = selectedStillExists ? selectedGitBranch : branches[0].name
          selectedGitBranch = String(defaultBranch || '').trim()

          els.gitBranchList.innerHTML = branches.map(b => {
            const branchName = String(b.name || '').trim()
            const typeLabel = b.isMainline ? '主线' : '分支'
            return `
              <button type="button" class="git-branch-item ${branchName === selectedGitBranch ? 'selected' : ''}" data-branch="${escapeHtml(branchName)}">
                <span class="git-branch-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
                </span>
                <span class="git-branch-name-wrap">
                  <span class="git-branch-name ${b.isMainline ? 'mainline' : ''}">${escapeHtml(branchName)}</span>
                  <span class="git-branch-subtitle">${typeLabel}${b.upstream ? ` · ${escapeHtml(b.upstream)}` : ''}</span>
                </span>
              </button>
            `
          }).join('')

          els.gitBranchList.querySelectorAll('.git-branch-item').forEach(item => {
            item.onclick = () => selectGitBranch(item.dataset.branch)
          })
          await selectGitBranch(selectedGitBranch)
        }
      } catch (e) {
        els.gitBranchList.innerHTML = ((window.i18n?.t?.('auto.js_git_panel_663_127') ?? '<div class="git-empty">加载失败: ')) + escapeHtml(e.message) + '</div>'
        renderBranchDetailPlaceholder(`加载失败: ${e.message}`)
      }
    }

    return {
      showGitPanel,
      loadGitStatus,
      loadGitStatusForProject,
      initGitForProject,
      loadGitHistory,
      showGitDiffPanel,
      loadGitBranches,
      mergeBranchByName,
      mergeSelectedGitBranch,
      openBranchDetail,
      selectGitBranch
    }
  }

  window.GitPanel = { bind, openDiffPreview }
})()
