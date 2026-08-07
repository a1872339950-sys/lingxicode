(function () {
  function getElements() {
    return {
      dataPathInput: document.getElementById('settingsDataPath'),
      storageInfo: document.getElementById('settingsStorageInfo'),
      skillsPath: document.getElementById('storageSkillsPath'),
      plansPath: document.getElementById('storagePlansPath'),
      projectsPath: document.getElementById('storageProjectsPath'),
      assetsPath: document.getElementById('storageAssetsPath'),
      summariesPath: document.getElementById('storageSummariesPath'),
      cachePath: document.getElementById('storageCachePath'),
      trashPath: document.getElementById('storageTrashPath'),
      trashRetentionDays: document.getElementById('settingsTrashRetentionDays'),
      trashStatus: document.getElementById('settingsTrashStatus'),
      cleanupTrashButton: document.getElementById('settingsCleanupTrashBtn'),
      clearTrashButton: document.getElementById('settingsClearTrashBtn'),
      recoveryEnabled: document.getElementById('settingsRecoveryEnabled'),
      recoveryMaxPoints: document.getElementById('settingsRecoveryMaxPoints'),
      recoveryMaxBytes: document.getElementById('settingsRecoveryMaxBytes'),
      recoveryMaxFileBytes: document.getElementById('settingsRecoveryMaxFileBytes'),
      recoveryStatus: document.getElementById('settingsRecoveryStatus'),
      recoverySaveButton: document.getElementById('settingsRecoverySaveBtn'),
      recoveryCleanupButton: document.getElementById('settingsRecoveryCleanupBtn'),
      selectButton: document.getElementById('settingsDataPathBtn'),
      resetButton: document.getElementById('settingsDataPathResetBtn'),
      modeBadge: document.getElementById('settingsStorageModeBadge'),
      diskTotalValue: document.getElementById('settingsDiskTotalValue'),
      diskFreeValue: document.getElementById('settingsDiskFreeValue'),
      diskUsageBar: document.getElementById('settingsDiskUsageBar'),
      storageUsageFooter: document.getElementById('settingsStorageUsageFooter'),
      refreshButton: document.getElementById('settingsStorageRefreshBtn'),
      backButton: document.getElementById('settingsStorageBackBtn'),
      memoPath: document.getElementById('settingsAiMemoPath'),
      memoOpenButton: document.getElementById('settingsAiMemoOpenBtn'),
      policySaveButton: document.getElementById('settingsStoragePolicySaveBtn')
    }
  }

  const STORAGE_LABELS = {
    skills: { title: 'skills', desc: '技能与资源' },
    plans: { title: 'plans', desc: '计划与草稿' },
    projects: { title: 'projects', desc: '项目数据' },
    assets: { title: 'assets', desc: '生成资产' },
    summaries: { title: 'summaries', desc: '摘要缓存' },
    cache: { title: 'cache', desc: '临时缓存' },
    trash: { title: 'trash', desc: '项目回收区' }
  }

  const STORAGE_ICONS = {
    skills: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h6.5l2-2H21v12.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M8 12h8M12 8v8"/></svg>',
    plans: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
    projects: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
    assets: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
    summaries: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 11h6M9 15h6M9 18h4"/></svg>',
    cache: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5M12 8v5l3 2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 3h6l1 4H8zM7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>'
  }

  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/></svg>'

  function bind(options = {}) {
    const showToast = options.showToast || function () {}
    const onStorageChanged = options.onStorageChanged || async function () {}
    const getActiveProject = options.getActiveProject || function () { return null }
    const els = getElements()

    const escapeHtml = HtmlUtils.escapeHtml

    function renderPathItem(element, label, filePath) {
      if (!element) return
      const safePath = filePath || '-'
      const storageKey = element.dataset.storageKey
      const meta = STORAGE_LABELS[storageKey] || { title: label, desc: '' }
      element.dataset.path = safePath
      element.title = safePath === '-' ? '' : safePath
      element.innerHTML = `
        <div class="storage-item-icon" aria-hidden="true">${STORAGE_ICONS[storageKey] || STORAGE_ICONS.skills}</div>
        <div class="storage-item-main">
          <div class="storage-item-title-row">
            <span class="storage-item-title">${escapeHtml(meta.title)}</span>
            ${meta.desc ? `<span class="storage-item-desc">${escapeHtml(meta.desc)}</span>` : ''}
          </div>
          <div class="storage-item-path">${escapeHtml(safePath)}</div>
        </div>
        <div class="storage-item-actions">
          <button type="button" data-storage-action="open">&#25171;&#24320;</button>
          <button type="button" class="storage-item-copy" data-storage-action="copy" title="复制路径" aria-label="复制路径">${COPY_ICON}</button>
        </div>
      `
      element.querySelector('[data-storage-action="open"]')?.addEventListener('click', event => {
        event.stopPropagation()
        openStorageItem(element)
      })
      element.querySelector('[data-storage-action="copy"]')?.addEventListener('click', async event => {
        event.stopPropagation()
        if (!safePath || safePath === '-') return
        try {
          await navigator.clipboard.writeText(safePath)
          showToast('路径已复制', 'success')
        } catch (_) {
          showToast('复制路径失败', 'error')
        }
      })
    }
    function renderModeBadge(isCustom) {
      if (!els.modeBadge) return
      els.modeBadge.textContent = isCustom ? '自定义路径' : '默认路径'
      els.modeBadge.classList.toggle('is-custom', !!isCustom)
    }

    const formatBytes = FormatUtils.formatBytes

    function renderDiskUsage(disk = {}, managedData = {}) {
      const total = Number(disk.total || 0)
      const free = Number(disk.free || 0)
      const freePercent = total > 0 ? Math.max(0, Math.min(100, free / total * 100)) : 0
      const usedPercent = total > 0 ? Math.max(0, Math.min(100, 100 - freePercent)) : 0
      const managedSize = Number(managedData.size || 0)
      if (els.diskTotalValue) els.diskTotalValue.textContent = total > 0 ? formatBytes(total) : '--'
      if (els.diskFreeValue) els.diskFreeValue.textContent = total > 0 ? formatBytes(free) : '--'
      if (els.storageUsageFooter) els.storageUsageFooter.textContent = formatBytes(managedSize)
      if (els.diskUsageBar) {
        els.diskUsageBar.style.width = `${usedPercent}%`
        els.diskUsageBar.classList.toggle('is-warning', freePercent < 30 && freePercent >= 15)
        els.diskUsageBar.classList.toggle('is-danger', freePercent < 15)
        els.diskUsageBar.title = `已使用 ${usedPercent.toFixed(1)}%，可用 ${freePercent.toFixed(1)}%`
      }
    }

    function renderMemoLocation() {
      const project = getActiveProject() || {}
      const projectPath = String(project.path || '').trim()
      const memoPath = projectPath ? `${projectPath}\\.lingxi\\ai-memos\\timeline` : '.lingxi/ai-memos/timeline'
      if (els.memoPath) {
        els.memoPath.textContent = memoPath
        els.memoPath.title = memoPath
        els.memoPath.dataset.path = projectPath ? memoPath : ''
      }
    }

    async function openStorageItem(element) {
      const filePath = element?.dataset?.path
      if (!filePath || filePath === '-') return
      if (!window.api?.openProjectFolder) {
        showToast('不支持打开文件夹', 'error')
        return
      }
      const result = await window.api.openProjectFolder(filePath)
      if (result?.error) showToast(`打开失败: ${result.error}`, 'error')
    }

    ;[
      els.skillsPath,
      els.plansPath,
      els.projectsPath,
      els.assetsPath,
      els.summariesPath,
      els.cachePath,
      els.trashPath
    ].forEach(element => {
      if (!element) return
      element.classList.add('clickable')
      element.ondblclick = () => openStorageItem(element)
    })

    function renderTrashStatus(status) {
      if (!status) return
      const retentionDays = status.retentionDays || 15
      if (els.trashRetentionDays) {
        els.trashRetentionDays.value = String(retentionDays)
      }
      if (els.trashStatus) {
        const count = Number(status.count) || 0
        const trashPath = status.path || '-'
        els.trashStatus.innerHTML = `
          <div class="storage-status-grid">
            <div class="storage-status-item"><span>当前项数</span><strong>${count}</strong></div>
            <div class="storage-status-item"><span>占用空间</span><strong>${escapeHtml(formatBytes(status.size))}</strong></div>
            <div class="storage-status-item"><span>自动清理</span><strong>${retentionDays} 天</strong></div>
          </div>
          <div class="storage-status-path-row">
            <div class="storage-status-path" title="${escapeHtml(trashPath)}">路径：${escapeHtml(trashPath)}</div>
            <button type="button" class="settings-path-btn reset" data-trash-action="open">打开位置</button>
          </div>
        `
        els.trashStatus.querySelector('[data-trash-action="open"]')?.addEventListener('click', async () => {
          if (!trashPath || trashPath === '-' || !window.api?.openProjectFolder) return
          const result = await window.api.openProjectFolder(trashPath)
          if (result?.error) showToast(`打开失败: ${result.error}`, 'error')
        })
      }
      renderPathItem(els.trashPath, 'trash', status.path)
    }

    function setSelectValue(select, value) {
      if (!select) return
      const text = String(value)
      const hasOption = Array.from(select.options || []).some(option => option.value === text)
      if (hasOption) select.value = text
      else if (select.options?.length) select.value = select.options[0].value
    }

    function renderRecoveryPolicy(config = {}) {
      if (els.recoveryEnabled) els.recoveryEnabled.checked = config.enabled !== false
      setSelectValue(els.recoveryMaxPoints, config.maxAutoPoints || 20)
      setSelectValue(els.recoveryMaxBytes, config.maxAutoBytes || 2 * 1024 * 1024 * 1024)
      setSelectValue(els.recoveryMaxFileBytes, config.maxFileBytes || 50 * 1024 * 1024)
    }

    function readRecoveryPolicy() {
      return {
        enabled: !!els.recoveryEnabled?.checked,
        maxAutoPoints: Number.parseInt(els.recoveryMaxPoints?.value, 10) || 20,
        maxAutoBytes: Number.parseInt(els.recoveryMaxBytes?.value, 10) || 2 * 1024 * 1024 * 1024,
        maxFileBytes: Number.parseInt(els.recoveryMaxFileBytes?.value, 10) || 50 * 1024 * 1024
      }
    }

    function renderRecoveryStatus(status = {}) {
      if (!els.recoveryStatus) return
      const policy = status.policy || readRecoveryPolicy()
      els.recoveryStatus.innerHTML = `
        <div class="recovery-policy-stat"><strong>${Number(status.totalCount || 0)}</strong><span>恢复点</span></div>
        <div class="recovery-policy-stat"><strong>${Number(status.autoCount || 0)}</strong><span>自动</span></div>
        <div class="recovery-policy-stat"><strong>${formatBytes(status.totalBytes || 0)}</strong><span>当前占用</span></div>
        <div class="recovery-policy-stat"><strong>${Number(policy.maxAutoPoints || 20)}</strong><span>保留上限</span></div>
      `
    }

    function notifyRecoveryPolicyChanged() {
      window.dispatchEvent(new CustomEvent('lingxi-recovery-policy-changed'))
    }

    async function loadRecoveryPolicy() {
      try {
        if (window.api?.getRecoveryPointConfig) {
          const result = await window.api.getRecoveryPointConfig()
          if (result?.success) renderRecoveryPolicy(result.data || {})
        }
        if (window.api?.getRecoveryPointStatus) {
          const status = await window.api.getRecoveryPointStatus()
          if (status?.success) renderRecoveryStatus(status)
        }
      } catch (error) {
        if (els.recoveryStatus) els.recoveryStatus.textContent = `恢复点状态读取失败：${error.message}`
      }
    }

    async function loadTrashStatus() {
      if (!window.api?.getTrashStatus) return
      const status = await window.api.getTrashStatus()
      if (status?.success) renderTrashStatus(status)
    }

    async function loadSettingsPaths() {
      if (!window.api?.getStorageStatus) {
        if (els.dataPathInput) els.dataPathInput.value = '不支持路径配置'
        return
      }

      try {
        const result = await window.api.getStorageStatus()
        if (!result.success) {
          console.error('[Frontend] 获取存储状态失败:', result.error)
          return
        }

        if (els.dataPathInput) {
          els.dataPathInput.value = result.basePath || '未设置'
          els.dataPathInput.title = result.isCustom ? '自定义路径' : '默认路径（用户数据目录 data）'
        }
        renderModeBadge(!!result.isCustom)
        renderDiskUsage(result.disk || {}, result.managedData || {})
        renderMemoLocation()

        if (els.storageInfo && result.paths) {
          els.storageInfo.style.display = 'grid'
          renderPathItem(els.skillsPath, 'skills', result.paths.skills)
          renderPathItem(els.plansPath, 'plans', result.paths.plans)
          renderPathItem(els.projectsPath, 'projects', result.paths.projects)
          renderPathItem(els.assetsPath, 'assets', result.paths.assets)
          renderPathItem(els.summariesPath, 'summaries', result.paths.summaries)
          renderPathItem(els.cachePath, 'cache', result.paths.cache)
        }
        await loadTrashStatus()
        await loadRecoveryPolicy()

        if (els.resetButton) {
          els.resetButton.disabled = !result.isCustom
          els.resetButton.style.opacity = result.isCustom ? '1' : '0.5'
        }
      } catch (e) {
        console.error('[Frontend] 加载存储路径失败:', e)
      }
    }

    if (els.selectButton) els.selectButton.onclick = async () => {
      if (!window.api?.selectStoragePath) {
        showToast('不支持路径选择', 'error')
        return
      }

      const selectResult = await window.api.selectStoragePath()
      if (selectResult.canceled || !selectResult.path) return

      showToast('正在设置新路径...', 'loading', 0)
      const setResult = await window.api.setStoragePath(selectResult.path, true)

      if (setResult.success) {
        showToast('存储路径已更新，数据已迁移到新位置', 'success')
        await loadSettingsPaths()
        await onStorageChanged()
      } else {
        showToast(`设置失败: ${setResult.error || '未知错误'}`, 'error')
      }
    }

    if (els.resetButton) els.resetButton.onclick = async () => {
      if (!window.api?.resetStoragePath) {
        showToast('不支持重置路径', 'error')
        return
      }

      if (!confirm('确定要重置为默认路径吗？\n数据将迁移回默认位置（用户数据目录 data）。')) return

      showToast('正在重置...', 'loading', 0)
      const result = await window.api.resetStoragePath()

      if (result.success) {
        showToast('已重置为默认路径', 'success')
        await loadSettingsPaths()
        await onStorageChanged()
      } else {
        showToast(`重置失败: ${result.error || '未知错误'}`, 'error')
      }
    }

    if (els.trashRetentionDays) els.trashRetentionDays.onchange = async () => {
      if (!window.api?.setTrashRetentionDays) return
      const result = await window.api.setTrashRetentionDays(els.trashRetentionDays.value)
      if (result?.success) {
        showToast('回收区保留时间已更新', 'success')
        await loadTrashStatus()
      } else {
        showToast(`更新失败: ${result?.error || '未知错误'}`, 'error')
      }
    }

    if (els.cleanupTrashButton) els.cleanupTrashButton.onclick = async () => {
      if (!window.api?.cleanupTrash) return
      const result = await window.api.cleanupTrash({ force: false })
      if (result?.success) {
        showToast(`已清理 ${result.removedCount || 0} 项过期内容`, 'success')
        await loadTrashStatus()
      } else {
        showToast(`清理失败: ${result?.error || '未知错误'}`, 'error')
      }
    }

    if (els.clearTrashButton) els.clearTrashButton.onclick = async () => {
      if (!window.api?.cleanupTrash) return
      if (!confirm('确定要清空项目回收区吗？这会永久删除回收区里的项目备份。')) return
      const result = await window.api.cleanupTrash({ force: true })
      if (result?.success) {
        showToast(`已清空回收区，删除 ${result.removedCount || 0} 项`, 'success')
        await loadTrashStatus()
      } else {
        showToast(`清空失败: ${result?.error || '未知错误'}`, 'error')
      }
    }

    if (els.recoverySaveButton) els.recoverySaveButton.onclick = async () => {
      if (!window.api?.saveRecoveryPointConfig) return
      const result = await window.api.saveRecoveryPointConfig(readRecoveryPolicy())
      if (result?.success) {
        showToast('恢复点保留策略已保存', 'success')
        renderRecoveryPolicy(result.data || readRecoveryPolicy())
        await loadRecoveryPolicy()
        notifyRecoveryPolicyChanged()
      } else {
        showToast(`保存失败: ${result?.error || '未知错误'}`, 'error')
      }
    }

    if (els.recoveryCleanupButton) els.recoveryCleanupButton.onclick = async () => {
      if (!window.api?.cleanupRecoveryPoints) return
      const result = await window.api.cleanupRecoveryPoints(readRecoveryPolicy())
      if (result?.success) {
        showToast(`已清理 ${result.deletedCount || 0} 个旧自动恢复点`, 'success')
        if (result.status) renderRecoveryStatus(result.status)
        else await loadRecoveryPolicy()
        notifyRecoveryPolicyChanged()
      } else {
        showToast(`清理失败: ${result?.error || '未知错误'}`, 'error')
      }
    }

    if (els.refreshButton) els.refreshButton.onclick = loadSettingsPaths
    if (els.backButton) els.backButton.onclick = () => {
      document.getElementById('settingsContentStorage')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      els.backButton.blur()
    }
    if (els.memoOpenButton) els.memoOpenButton.onclick = async () => {
      const memoPath = els.memoPath?.dataset?.path || ''
      if (!memoPath || !window.api?.openProjectFolder) return showToast('请先打开一个项目', 'warning')
      const result = await window.api.openProjectFolder(memoPath)
      if (result?.error) showToast(`打开失败: ${result.error}`, 'error')
    }
    if (els.policySaveButton) els.policySaveButton.onclick = async () => {
      if (!window.api?.setTrashRetentionDays) return
      const result = await window.api.setTrashRetentionDays(els.trashRetentionDays?.value || 15)
      if (result?.success) {
        showToast('存储与清理设置已保存', 'success')
        await loadTrashStatus()
      } else {
        showToast(`保存失败: ${result?.error || '未知错误'}`, 'error')
      }
    }
    return { loadSettingsPaths, loadRecoveryPolicy }
  }

  window.StorageSettings = { bind }
})()
