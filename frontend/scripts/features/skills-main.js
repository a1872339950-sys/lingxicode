/**
 * 能力中心 UI
 *
 * 入口：能力 → Skill | 插件（两个独立界面）
 * Skill：启用池 / 已安装上传（启用 ≠ 对模型可见）
 * 插件：已安装 / 商城（后续能力包）
 * 输入框：仅从已启用 Skill 中单选，选中才注入模型
 */
(function () {
  function getElements() {
    return {
      btnSkill: document.getElementById('btnSkill'),
      skillPanel: document.getElementById('skillPanel'),
      skillPanelTitle: document.getElementById('skillPanelTitle'),
      skillPanelSubtitle: document.getElementById('skillPanelSubtitle'),
      skillPanelBack: document.getElementById('skillPanelBack'),
      capabilityHome: document.getElementById('capabilityHome'),
      capabilitySection: document.getElementById('capabilitySection'),
      skillSearchInput: document.getElementById('skillSearchInput'),
      skillRefreshBtn: document.getElementById('skillRefreshBtn'),
      skillUploadBtn: document.getElementById('skillUploadBtn'),
      skillList: document.getElementById('skillList'),
      skillCategoryTabs: document.getElementById('skillCategoryTabs'),
      skillCapabilityTabs: document.getElementById('skillCapabilityTabs'),
      skillMarketplaceMount: document.getElementById('skillMarketplaceMount'),
      skillDetailModal: document.getElementById('skillDetailModal'),
      skillDetailClose: document.getElementById('skillDetailClose'),
      skillDetailTitle: document.getElementById('skillDetailTitle'),
      skillDetailDesc: document.getElementById('skillDetailDesc'),
      skillDetailIconSvg: document.getElementById('skillDetailIconSvg'),
      skillDetailStatus: document.getElementById('skillDetailStatus'),
      skillDetailType: document.getElementById('skillDetailType'),
      skillDetailContent: document.getElementById('skillDetailContent'),
      skillDetailToggle: document.getElementById('skillDetailToggle'),
      skillDetailDelete: document.getElementById('skillDetailDelete'),
      skillSelector: document.getElementById('skillSelector'),
      skillSelectBtn: document.getElementById('skillSelectBtn'),
      skillSelectMenu: document.getElementById('skillSelectMenu'),
      skillMenuSearch: document.getElementById('skillMenuSearch'),
      skillMenuList: document.getElementById('skillMenuList')
    }
  }

  function bind(options = {}) {
    const getAllSkills = options.getAllSkills || function () { return [] }
    const setAllSkills = options.setAllSkills || function () {}
    const getEnabledSkills = options.getEnabledSkills || function () { return [] }
    const setEnabledSkills = options.setEnabledSkills || function () {}
    const getCurrentSkill = options.getCurrentSkill || function () { return null }
    const setCurrentSkill = options.setCurrentSkill || function () {}
    const getActiveProject = options.getActiveProject || function () { return null }
    const showToast = options.showToast || ((message, type = 'info') => window.ToastUI?.show?.(message, type))
    const els = getElements()
    let currentDetailSkill = null
    // 导航：home | skill | plugin
    let capabilityView = 'home'
    // Skill 子栏：enabled | installed
    // 插件子栏：installed | marketplace
    let capabilityHubTab = 'installed'
    // Skill 已安装筛选：all | builtin | user
    let currentSkillCategory = 'all'
    /** @type {{ marketplace?: object, plugins?: array } | null} */
    let marketplaceCatalog = null
    /** @type {array} */
    let installedPlugins = []

    function allSkills() {
      return getAllSkills() || []
    }

    /** 已启用 = 可选池（资源中心管理） */
    function enabledSkills() {
      return getEnabledSkills() || []
    }

    /** 输入框当前选中 = 对模型可见的那一个 */
    function activeSkillName() {
      return getCurrentSkill() || null
    }

    const escapeHtml = HtmlUtils.escapeHtml

    function skillSourceLabel(skill) {
      if (!skill) return '未知'
      if (skill.projectSkill) return '项目'
      if (skill.builtin) return '内置'
      if (skill.pluginId || skill.kind === 'plugin') return `插件·${skill.pluginId || skill.pluginName || skill.name}`
      return '自定义'
    }

    function skillKind(skill) {
      if (skill?.pluginId || skill?.kind === 'plugin') return 'plugin'
      return 'skill'
    }

    function matchesSkill(skill, filter) {
      const keyword = String(filter || '').trim().toLowerCase()
      if (!keyword) return true
      return [skill.name, skill.title, skill.description, skill.pluginId, skill.pluginName]
        .filter(Boolean)
        .some(text => String(text).toLowerCase().includes(keyword))
    }

    const skillIconSvgMap = {
      code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/><path d="m14.5 4-5 16"/>',
      diagnose: '<path d="M8 8h8v7a4 4 0 0 1-8 0V8Z"/><path d="m9 2 1.5 3h3L15 2"/><path d="M3 13h4"/><path d="M17 13h4"/><path d="m5 19 3-2"/><path d="m19 19-3-2"/>',
      docs: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"/><path d="M8 7h8"/><path d="M8 11h6"/>',
      image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="9.5" r="1.5"/>',
      architecture: '<rect x="9" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="15" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M12 9v3"/><path d="M6 15v-2h12v2"/>',
      testing: '<path d="M9 11 11 13 15 8"/><path d="M8 4h8"/><path d="M9 2h6a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v13H4V7a2 2 0 0 1 2-2h1V4a2 2 0 0 1 2-2Z"/><path d="M8 17h8"/>',
      plugin: '<path d="M9 3v4"/><path d="M15 3v4"/><path d="M7 7h10v4a5 5 0 0 1-10 0V7Z"/><path d="M12 16v5"/><path d="M8 21h8"/>',
      planning: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="m3 6 1 1 2-2"/><path d="m3 12 1 1 2-2"/><path d="m3 18 1 1 2-2"/>',
      agent: '<rect x="6" y="7" width="12" height="10" rx="3"/><path d="M12 3v4"/><circle cx="9.5" cy="12" r="1"/><circle cx="14.5" cy="12" r="1"/><path d="M9 17v2"/><path d="M15 17v2"/><path d="M3 12h3"/><path d="M18 12h3"/>'
    }

    function getSkillIconType(skill) {
      const key = `${skill.name || ''} ${skill.title || ''} ${skill.description || ''}`.toLowerCase()
      const hasAny = words => words.some(word => key.includes(word))
      if (skillKind(skill) === 'plugin') return 'plugin'
      if (hasAny(['image', '图片', '图像', 'svg', 'png', '视觉', '转换'])) return 'image'
      if (hasAny(['diagnose', 'bug', 'debug', '诊断', '错误', '排查'])) return 'diagnose'
      if (hasAny(['docs', 'doc', 'prd', '文档', '交接', 'handoff'])) return 'docs'
      if (hasAny(['architecture', '架构', '重构', '宏观'])) return 'architecture'
      if (hasAny(['tdd', 'test', '测试', '验证', 'verify'])) return 'testing'
      if (hasAny(['plugin', '插件', 'install', '安装'])) return 'plugin'
      if (hasAny(['issue', 'triage', '计划', '方案', '规划'])) return 'planning'
      if (hasAny(['agent', '协作', 'office', 'ppt'])) return 'agent'
      return 'code'
    }

    function getSkillIconSvg(type) {
      return skillIconSvgMap[type] || skillIconSvgMap.code
    }

    /** 禁用某技能时，若输入框正选中它则清空 */
    function clearActiveIfDisabled(skillName) {
      if (activeSkillName() === skillName) {
        setCurrentSkill(null)
        const project = getActiveProject()
        if (project) project.skillName = null
      }
    }

    async function setSkillEnabled(skillName, enabled) {
      if (!skillName || !window.api) return
      const list = enabledSkills()
      const isOn = list.includes(skillName)
      if (enabled && !isOn) {
        setEnabledSkills([...list, skillName])
        await window.api.enableSkill(skillName)
      } else if (!enabled && isOn) {
        setEnabledSkills(list.filter(n => n !== skillName))
        await window.api.disableSkill(skillName)
        clearActiveIfDisabled(skillName)
      }
      renderAll()
    }

    /** 输入框：从已启用列表中选中（或清空） */
    function pickActiveSkill(skillName) {
      const name = skillName || null
      if (name && !enabledSkills().includes(name)) {
        showToast('请先在资源中心启用该技能', 'error')
        return
      }
      setCurrentSkill(name)
      const project = getActiveProject()
      if (project) project.skillName = name
      updateSkillButton()
      renderSkillMenu(els.skillMenuSearch?.value || '')
      els.skillSelectMenu?.classList.remove('show')
    }

    function renderSkillItem(skill, enabled) {
      const isEnabled = enabled.includes(skill.name)
      const isActive = activeSkillName() === skill.name
      const title = escapeHtml(skill.title || skill.name)
      const description = escapeHtml(skill.description || '暂无描述')
      const typeText = skillSourceLabel(skill)
      const iconType = getSkillIconType(skill)
      const enabledIcon = isEnabled
        ? '<svg class="skill-list-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>'
        : ''
      const activeBadge = isActive ? '<span class="skill-primary-badge">使用中</span>' : ''
      const deleteButton = !skill.builtin && skillKind(skill) === 'skill' && !skill.projectSkill
        ? `<button class="skill-list-delete" type="button" data-name="${escapeHtml(skill.name)}" title="删除技能"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`
        : ''

      return `
        <div class="skill-list-item ${isEnabled ? 'enabled' : ''}" data-name="${escapeHtml(skill.name)}">
          <div class="skill-list-icon skill-list-icon-${iconType}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${getSkillIconSvg(iconType)}</svg>
          </div>
          <div class="skill-list-info">
            <div class="skill-list-title">${title}${activeBadge}</div>
            <div class="skill-list-desc">${description}</div>
          </div>
          <div class="skill-list-meta">
            ${isEnabled ? enabledIcon : `<span class="skill-list-type">${escapeHtml(typeText)}</span>`}
            ${deleteButton}
          </div>
        </div>
      `
    }

    function renderSkillSection(title, skills, enabled) {
      if (!skills.length) return ''
      return `
        <section class="skill-list-section">
          <div class="skill-list-section-title">${title}</div>
          <div class="skill-list-grid">
            ${skills.map(skill => renderSkillItem(skill, enabled)).join('')}
          </div>
        </section>
      `
    }

    async function loadPlugins() {
      if (!window.api?.listPluginMarketplace) {
        marketplaceCatalog = { plugins: [] }
        installedPlugins = []
        return
      }
      try {
        const [market, installed] = await Promise.all([
          window.api.listPluginMarketplace(),
          window.api.listInstalledPlugins()
        ])
        marketplaceCatalog = market || { plugins: [] }
        installedPlugins = Array.isArray(installed) ? installed : []
      } catch (e) {
        console.error('[Frontend] 加载插件失败:', e)
        marketplaceCatalog = { plugins: [] }
        installedPlugins = []
      }
    }

    async function loadSkills() {
      if (!window.api) return
      try {
        const projectPath = getActiveProject()?.path || ''
        const skills = await window.api.getAllSkills(projectPath)
        const enabledData = await window.api.getEnabledSkills(projectPath)
        setAllSkills(skills)
        setEnabledSkills(enabledData.map(s => s.name))
        await loadPlugins()
        // 若当前选中已不在启用列表，清空
        const active = activeSkillName()
        if (active && !enabledSkills().includes(active)) {
          setCurrentSkill(null)
          const project = getActiveProject()
          if (project) project.skillName = null
        }
        renderAll()
      } catch (e) {
        console.error('[Frontend] 加载技能失败:', e)
      }
    }

    function pureSkills() {
      // 纯 Skill：非插件项（后续插件 skill 带 pluginId）
      return allSkills().filter(s => skillKind(s) === 'skill')
    }

    function setHeaderForView() {
      if (els.skillPanelTitle) {
        els.skillPanelTitle.textContent =
          capabilityView === 'skill' ? 'Skill' : capabilityView === 'plugin' ? '插件' : '能力'
      }
      if (els.skillPanelSubtitle) {
        els.skillPanelSubtitle.textContent =
          capabilityView === 'skill'
            ? '启用后进入输入框可选池；在输入框选中后才对模型可见'
            : capabilityView === 'plugin'
              ? '安装与管理能力包；启用后其 Skill 可出现在输入框可选池'
              : '选择 Skill 或插件进入对应管理界面'
      }
    }

    function showHome() {
      capabilityView = 'home'
      closeSkillDetail()
      if (els.capabilityHome) els.capabilityHome.hidden = false
      if (els.capabilitySection) els.capabilitySection.hidden = true
      setHeaderForView()
      renderHome()
    }

    function enterKind(kind) {
      capabilityView = kind === 'plugin' ? 'plugin' : 'skill'
      capabilityHubTab = kind === 'plugin' ? 'marketplace' : 'installed'
      currentSkillCategory = 'all'
      if (els.capabilityHome) els.capabilityHome.hidden = true
      if (els.capabilitySection) els.capabilitySection.hidden = false
      setHeaderForView()
      renderSection()
    }

    function renderHome() {
      if (!els.capabilityHome) return
      const skillCount = pureSkills().length
      const enabledCount = enabledSkills().filter(n => pureSkills().some(s => s.name === n)).length
      els.capabilityHome.innerHTML = `
        <div class="capability-entry-grid">
          <button type="button" class="capability-entry-card" data-cap-kind="skill">
            <div class="capability-entry-icon skill-list-icon-code">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">${skillIconSvgMap.code}</svg>
            </div>
            <div class="capability-entry-body">
              <div class="capability-entry-title">Skill</div>
              <div class="capability-entry-desc">纯提示词技能：上传、启用、在输入框选中后注入模型</div>
              <div class="capability-entry-meta">${skillCount} 已安装 · ${enabledCount} 已启用</div>
            </div>
            <div class="capability-entry-arrow">→</div>
          </button>
          <button type="button" class="capability-entry-card" data-cap-kind="plugin">
            <div class="capability-entry-icon skill-list-icon-plugin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">${skillIconSvgMap.plugin}</svg>
            </div>
            <div class="capability-entry-body">
              <div class="capability-entry-title">插件</div>
              <div class="capability-entry-desc">能力包：商城安装、本地管理；可含多个 Skill / 运行时</div>
              <div class="capability-entry-meta">${(marketplaceCatalog?.plugins || []).length} 商城 · ${installedPlugins.length} 已安装</div>
            </div>
            <div class="capability-entry-arrow">→</div>
          </button>
        </div>
      `
      els.capabilityHome.querySelectorAll('[data-cap-kind]').forEach(btn => {
        btn.onclick = () => enterKind(btn.dataset.capKind)
      })
    }

    function updateToolbarForHub() {
      if (capabilityView === 'home') return
      const isPlugin = capabilityView === 'plugin'
      const isSkillInstalled = capabilityView === 'skill' && capabilityHubTab === 'installed'
      if (els.skillUploadBtn) els.skillUploadBtn.style.display = isSkillInstalled ? '' : 'none'
      const searchWrap = els.skillSearchInput?.closest('.skill-search-wrap')
      if (searchWrap) searchWrap.style.display = ''
      if (els.skillSearchInput) {
        if (capabilityView === 'skill') {
          els.skillSearchInput.placeholder = capabilityHubTab === 'enabled' ? '搜索已启用 Skill' : '搜索已安装 Skill'
        } else {
          els.skillSearchInput.placeholder = capabilityHubTab === 'marketplace' ? '搜索商城插件' : '搜索已安装插件'
        }
      }
    }

    function renderCapabilityHubTabs() {
      if (!els.skillCapabilityTabs) return
      if (capabilityView === 'skill') {
        const enabledCount = enabledSkills().filter(n => pureSkills().some(s => s.name === n)).length
        const installedCount = pureSkills().length
        const tabs = [
          { id: 'enabled', label: '已启用', count: enabledCount },
          { id: 'installed', label: '已安装', count: installedCount }
        ]
        els.skillCapabilityTabs.innerHTML = tabs.map(t => `
          <button type="button" class="skill-capability-tab ${capabilityHubTab === t.id ? 'active' : ''}" data-cap-tab="${t.id}">
            ${t.label}<span class="skill-category-count">${t.count}</span>
          </button>
        `).join('')
      } else if (capabilityView === 'plugin') {
        const marketCount = (marketplaceCatalog?.plugins || []).length
        const tabs = [
          { id: 'installed', label: '已安装', count: installedPlugins.length },
          { id: 'marketplace', label: '商城', count: marketCount }
        ]
        els.skillCapabilityTabs.innerHTML = tabs.map(t => `
          <button type="button" class="skill-capability-tab ${capabilityHubTab === t.id ? 'active' : ''}" data-cap-tab="${t.id}">
            ${t.label}${t.count != null ? `<span class="skill-category-count">${t.count}</span>` : ''}
          </button>
        `).join('')
      } else {
        els.skillCapabilityTabs.innerHTML = ''
        return
      }
      els.skillCapabilityTabs.querySelectorAll('.skill-capability-tab').forEach(tab => {
        tab.onclick = () => {
          capabilityHubTab = tab.dataset.capTab
          if (capabilityHubTab === 'installed') currentSkillCategory = 'all'
          renderSection()
        }
      })
    }

    function renderSkillCategoryTabs() {
      if (!els.skillCategoryTabs) return
      // 仅 Skill · 已安装 需要 全部/内置/自定义
      if (capabilityView !== 'skill' || capabilityHubTab !== 'installed') {
        els.skillCategoryTabs.hidden = true
        els.skillCategoryTabs.innerHTML = ''
        els.skillCategoryTabs.style.display = 'none'
        return
      }
      els.skillCategoryTabs.hidden = false
      els.skillCategoryTabs.style.display = ''
      const skills = pureSkills()
      if (currentSkillCategory === 'enabled') currentSkillCategory = 'all'
      const tabs = [
        { id: 'all', label: '全部', count: skills.length },
        { id: 'builtin', label: '内置', count: skills.filter(s => s.builtin).length },
        { id: 'user', label: '自定义', count: skills.filter(s => !s.builtin).length }
      ]
      els.skillCategoryTabs.innerHTML = tabs.map(t => `
        <div class="skill-category-tab ${currentSkillCategory === t.id ? 'active' : ''}" data-category="${t.id}">
          ${t.label}<span class="skill-category-count">${t.count}</span>
        </div>
      `).join('')
      els.skillCategoryTabs.querySelectorAll('.skill-category-tab').forEach(tab => {
        tab.onclick = () => {
          currentSkillCategory = tab.dataset.category
          renderSkillCategoryTabs()
          renderSkillList(els.skillSearchInput?.value || '')
        }
      })
    }

    function renderPluginCard(plugin, mode) {
      const installed = !!plugin.installed || mode === 'installed'
      const brand = escapeHtml(plugin.brandColor || '#a78bfa')
      const skillCount = plugin.skillCount != null
        ? plugin.skillCount
        : (Array.isArray(plugin.skills) ? plugin.skills.length : null)
      const metaBits = [
        plugin.category,
        plugin.version ? `v${plugin.version}` : '',
        skillCount != null ? `${skillCount} Skill` : '',
        plugin.developerName
      ].filter(Boolean)
      const actionLabel = mode === 'marketplace'
        ? (installed ? '已安装' : '安装')
        : '卸载'
      const actionDisabled = mode === 'marketplace' && installed
      return `
        <article class="plugin-market-card" data-plugin-id="${escapeHtml(plugin.id || plugin.name)}">
          <div class="plugin-market-card-accent" style="background:${brand}"></div>
          <div class="plugin-market-card-body">
            <div class="plugin-market-card-head">
              <div class="plugin-market-card-title">${escapeHtml(plugin.displayName || plugin.name)}</div>
              <div class="plugin-market-card-badge">${escapeHtml(plugin.category || '插件')}</div>
            </div>
            <div class="plugin-market-card-desc">${escapeHtml(plugin.description || plugin.longDescription || '暂无描述')}</div>
            <div class="plugin-market-card-meta">${escapeHtml(metaBits.join(' · '))}</div>
            <div class="plugin-market-card-actions">
              <button type="button" class="plugin-market-btn ${mode === 'installed' ? 'danger' : ''} ${actionDisabled ? 'is-disabled' : ''}"
                data-plugin-action="${mode === 'marketplace' ? 'install' : 'uninstall'}"
                data-plugin-id="${escapeHtml(plugin.id || plugin.name)}"
                ${actionDisabled ? 'disabled' : ''}>
                ${actionLabel}
              </button>
            </div>
          </div>
        </article>
      `
    }

    async function handlePluginAction(action, pluginId) {
      if (!window.api || !pluginId) return
      try {
        if (action === 'install') {
          const result = await window.api.installPlugin(pluginId)
          if (result?.error) {
            showToast(result.error, 'error')
            return
          }
          showToast(result?.message || '插件已安装', 'success')
          // 后端安装时已启用聚合入口；再确保前端状态刷新
          await loadSkills()
          const rootName = pluginId
          if (!enabledSkills().includes(rootName)) {
            await window.api.enableSkill(rootName)
            await loadSkills()
          }
          const installedPlugin = (marketplaceCatalog?.plugins || []).find(plugin => (plugin.id || plugin.name) === pluginId)
          const installedName = installedPlugin?.displayName || installedPlugin?.name || pluginId
          showToast(`已加入输入框可选技能，打开下拉即可选中「${installedName}」`, 'success')
          capabilityHubTab = 'installed'
          renderSection()
          return
        }
        if (action === 'uninstall') {
          if (!confirm(`确定卸载插件「${pluginId}」？其 Skill 将一并移除。`)) return
          // 先禁用相关 skill
          const pluginSkills = allSkills().filter(s => s.pluginId === pluginId)
          for (const s of pluginSkills) {
            if (enabledSkills().includes(s.name)) {
              await window.api.disableSkill(s.name)
            }
            if (activeSkillName() === s.name) {
              setCurrentSkill(null)
              const project = getActiveProject()
              if (project) project.skillName = null
            }
          }
          const result = await window.api.uninstallPlugin(pluginId)
          if (result?.error) {
            showToast(result.error, 'error')
            return
          }
          showToast(result?.message || '插件已卸载', 'success')
          await loadSkills()
        }
      } catch (e) {
        console.error('[Frontend] plugin action failed:', e)
        showToast('操作失败: ' + (e.message || e), 'error')
      }
    }

    function bindPluginCardActions() {
      if (!els.skillList) return
      els.skillList.querySelectorAll('[data-plugin-action]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation()
          handlePluginAction(btn.dataset.pluginAction, btn.dataset.pluginId)
        }
      })
    }

    function renderPluginView() {
      if (!els.skillList) return
      updateToolbarForHub()
      const filter = String(els.skillSearchInput?.value || '').trim().toLowerCase()
      if (capabilityHubTab === 'marketplace') {
        const marketName = marketplaceCatalog?.marketplace?.displayName || '灵犀官方'
        let plugins = marketplaceCatalog?.plugins || []
        if (filter) {
          plugins = plugins.filter(p =>
            [p.displayName, p.name, p.description, p.category, p.developerName]
              .filter(Boolean)
              .some(t => String(t).toLowerCase().includes(filter))
          )
        }
        if (!plugins.length) {
          els.skillList.innerHTML = `
            <div class="skill-marketplace-placeholder">
              <div class="skill-marketplace-title">插件商城 · ${escapeHtml(marketName)}</div>
              <div class="skill-marketplace-desc">暂无上架插件。</div>
              <div class="skill-marketplace-hint">可将能力包放入项目 plugins/ 并登记 marketplace.json。</div>
            </div>
          `
          return
        }
        els.skillList.innerHTML = `
          <section class="skill-list-section">
            <div class="skill-list-section-title">商城 · ${escapeHtml(marketName)}</div>
            <div class="plugin-market-grid">
              ${plugins.map(p => renderPluginCard(p, 'marketplace')).join('')}
            </div>
          </section>
          <div class="skill-marketplace-hint" style="margin:12px 4px 0">
            安装后到「已安装」查看；插件 Skill 会进入可选池，需在输入框下拉中选中才注入模型。
          </div>
        `
        bindPluginCardActions()
        return
      }

      let plugins = installedPlugins.slice()
      if (filter) {
        plugins = plugins.filter(p =>
          [p.displayName, p.name, p.description, p.category]
            .filter(Boolean)
            .some(t => String(t).toLowerCase().includes(filter))
        )
      }
      if (!plugins.length) {
        els.skillList.innerHTML = `
          <div class="skill-empty">
            尚未安装插件。<br>
            可到「商城」安装能力包；纯提示词请使用 <strong>Skill</strong> 界面上传。
          </div>
        `
        return
      }
      els.skillList.innerHTML = `
        <section class="skill-list-section">
          <div class="skill-list-section-title">已安装插件</div>
          <div class="plugin-market-grid">
            ${plugins.map(p => renderPluginCard(p, 'installed')).join('')}
          </div>
        </section>
      `
      bindPluginCardActions()
    }

    function renderSkillList(filter = '') {
      if (!els.skillList) return
      if (capabilityView === 'plugin') {
        renderPluginView()
        return
      }
      if (capabilityView !== 'skill') return

      updateToolbarForHub()
      const enabled = enabledSkills()
      let filtered = pureSkills().filter(s => matchesSkill(s, filter))

      if (capabilityHubTab === 'enabled') {
        filtered = filtered.filter(s => enabled.includes(s.name))
      } else if (currentSkillCategory === 'builtin') {
        filtered = filtered.filter(s => s.builtin)
      } else if (currentSkillCategory === 'user') {
        filtered = filtered.filter(s => !s.builtin)
      }

      if (filtered.length === 0) {
        const empty = capabilityHubTab === 'enabled'
          ? '<div class="skill-empty">尚未启用 Skill。<br>到「已安装」启用后，会出现在输入框下拉中。</div>'
          : '<div class="skill-empty">暂无 Skill。可点击「上传技能」添加纯提示词。</div>'
        els.skillList.innerHTML = empty
        return
      }

      const sectionTitle = capabilityHubTab === 'enabled'
        ? '已启用 · 可在输入框下拉中选中'
        : currentSkillCategory === 'builtin'
          ? '内置 Skill'
          : currentSkillCategory === 'user'
            ? '自定义 Skill'
            : '已安装 Skill'
      els.skillList.innerHTML = renderSkillSection(sectionTitle, filtered, enabled)

      els.skillList.querySelectorAll('.skill-list-item').forEach(card => {
        card.onclick = e => {
          if (e.target.closest('.skill-list-delete')) return
          showSkillDetail(card.dataset.name)
        }
      })

      els.skillList.querySelectorAll('.skill-list-delete').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation()
          const name = btn.dataset.name
          if (confirm(`确定删除技能 "${name}"？`)) {
            await window.api.deleteSkill(name)
            await loadSkills()
          }
        }
      })
    }

    function renderSection() {
      if (capabilityView === 'home') {
        showHome()
        return
      }
      renderCapabilityHubTabs()
      renderSkillCategoryTabs()
      renderSkillList(els.skillSearchInput?.value || '')
    }

    function showSkillDetail(skillName) {
      const skill = allSkills().find(s => s.name === skillName)
      if (!skill || !els.skillDetailModal) return

      currentDetailSkill = skillName
      const isEnabled = enabledSkills().includes(skillName)
      const isActive = activeSkillName() === skillName
      const iconType = getSkillIconType(skill)
      els.skillDetailTitle.textContent = skill.title || skill.name
      els.skillDetailDesc.textContent = skill.description || '暂无描述'
      if (els.skillDetailIconSvg) {
        const iconWrap = els.skillDetailIconSvg.closest('.skill-detail-icon')
        if (iconWrap) iconWrap.className = 'skill-detail-icon skill-list-icon-' + iconType
        els.skillDetailIconSvg.innerHTML = getSkillIconSvg(iconType)
      }
      els.skillDetailStatus.textContent = isEnabled
        ? (isActive ? '已启用 · 输入框使用中' : '已启用 · 可在输入框选中')
        : '未启用 · 启用后才能在输入框选中'
      els.skillDetailStatus.className = 'skill-detail-status' + (isEnabled ? ' enabled' : '')
      els.skillDetailType.textContent = skillSourceLabel(skill) + (skillKind(skill) === 'plugin' ? ' · 插件' : ' · 纯技能')
      els.skillDetailType.className = 'skill-detail-type' + (skill.builtin ? ' builtin' : '')
      els.skillDetailContent.textContent = skill.content || '暂无详细内容'

      els.skillDetailToggle.classList.toggle('enabled', isEnabled)
      els.skillDetailToggle.querySelector('span').textContent = isEnabled ? '禁用技能' : '启用技能'
      if (isEnabled) {
        els.skillDetailToggle.querySelector('svg').innerHTML = '<path d="M18 6L6 18M6 6l12 12"/>'
      } else {
        els.skillDetailToggle.querySelector('svg').innerHTML = '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>'
      }

      // 详情内快捷：在输入框使用 / 取消使用
      ensureUseInChatAction(isEnabled, isActive)

      if (skill.builtin || skill.projectSkill || skillKind(skill) === 'plugin') {
        els.skillDetailDelete.classList.add('hidden')
      } else {
        els.skillDetailDelete.classList.remove('hidden')
      }
      els.skillDetailModal.classList.add('show')
    }

    function ensureUseInChatAction(isEnabled, isActive) {
      let btn = els.skillDetailModal?.querySelector('[data-skill-use-btn]')
      if (!btn && els.skillDetailToggle?.parentElement) {
        btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'skill-detail-action'
        btn.dataset.skillUseBtn = '1'
        btn.innerHTML = '<span></span>'
        els.skillDetailToggle.parentElement.insertBefore(btn, els.skillDetailToggle.nextSibling)
        btn.onclick = () => {
          if (!currentDetailSkill || !enabledSkills().includes(currentDetailSkill)) return
          if (activeSkillName() === currentDetailSkill) pickActiveSkill(null)
          else pickActiveSkill(currentDetailSkill)
          showSkillDetail(currentDetailSkill)
        }
      }
      if (!btn) return
      btn.hidden = !isEnabled
      btn.querySelector('span').textContent = isActive ? '取消输入框选中' : '在输入框选中'
    }

    function closeSkillDetail() {
      if (!els.skillDetailModal) return
      els.skillDetailModal.classList.remove('show')
      currentDetailSkill = null
    }

    function closeSkillPanel() {
      closeSkillDetail()
      if (els.skillPanel) els.skillPanel.classList.remove('show')
    }

    if (els.skillDetailClose) els.skillDetailClose.onclick = closeSkillDetail

    if (els.skillDetailToggle) {
      els.skillDetailToggle.onclick = async () => {
        if (!currentDetailSkill) return
        const isEnabled = enabledSkills().includes(currentDetailSkill)
        await setSkillEnabled(currentDetailSkill, !isEnabled)
        showSkillDetail(currentDetailSkill)
      }
    }

    if (els.skillDetailDelete) {
      els.skillDetailDelete.onclick = async () => {
        if (!currentDetailSkill) return
        if (confirm(`确定删除技能 "${currentDetailSkill}"？`)) {
          await window.api.deleteSkill(currentDetailSkill)
          closeSkillDetail()
          await loadSkills()
        }
      }
    }

    document.addEventListener('click', e => {
      if (!els.skillDetailModal || !els.skillDetailModal.classList.contains('show')) return
      const isInsideModal = e.target.closest('.skill-detail-content')
      const isSkillCard = e.target.closest('.skill-list-item')
      if (!isInsideModal && !isSkillCard) closeSkillDetail()
    })

    /**
     * 输入框下拉候选项：已启用技能；同一插件只展示聚合入口（isPluginRoot 或 pluginId 同名）
     */
    function dropdownEnabledSkills() {
      const enabled = allSkills().filter(s => enabledSkills().includes(s.name))
      const result = []
      const seenPlugin = new Set()
      for (const s of enabled) {
        if (s.pluginId || s.kind === 'plugin') {
          const pid = s.pluginId || s.name
          if (seenPlugin.has(pid)) continue
          // 优先用聚合根入口
          const root = enabled.find(x => x.name === pid && (x.isPluginRoot || x.pluginId === pid))
            || enabled.find(x => x.pluginId === pid && x.isPluginRoot)
            || enabled.find(x => x.pluginId === pid)
            || s
          seenPlugin.add(pid)
          result.push(root)
        } else {
          result.push(s)
        }
      }
      return result
    }

    /**
     * 输入框下拉：仅展示已启用技能，单选选中 / 无技能
     */
    function renderSkillMenu(filter = '') {
      if (!els.skillMenuList) return
      const keyword = String(filter || '').trim().toLowerCase()
      const enabled = dropdownEnabledSkills()
      const filtered = enabled.filter(s =>
        !keyword ||
        matchesSkill(s, keyword)
      )
      const current = activeSkillName()

      let html = `<div class="skill-menu-item ${!current ? 'selected' : ''}" data-name="">
        <span class="skill-menu-item-none">无技能</span>
      </div>`

      if (!enabled.length) {
        html += `<div class="skill-menu-empty">暂无已启用技能。请先在资源中心 · 能力中启用，或到插件商城安装能力包。</div>`
      } else if (!filtered.length) {
        html += `<div class="skill-menu-empty">没有匹配的已启用技能</div>`
      } else {
        html += filtered.map(s => `
          <div class="skill-menu-item ${current === s.name ? 'selected' : ''}" data-name="${escapeHtml(s.name)}">
            <span class="skill-menu-item-name">${escapeHtml(s.title || s.name)}</span>
            <span class="skill-menu-badge muted">${escapeHtml(skillSourceLabel(s))}</span>
          </div>
        `).join('')
      }

      html += `
        <div class="skill-menu-footer">
          <button type="button" class="skill-menu-link" data-action="open-skill">管理 Skill →</button>
        </div>
      `
      els.skillMenuList.innerHTML = html

      els.skillMenuList.querySelectorAll('.skill-menu-item[data-name]').forEach(item => {
        item.onclick = () => {
          const name = item.dataset.name || null
          pickActiveSkill(name || null)
        }
      })
      const openSkill = els.skillMenuList.querySelector('[data-action="open-skill"]')
      if (openSkill) {
        openSkill.onclick = e => {
          e.stopPropagation()
          els.skillSelectMenu?.classList.remove('show')
          openCapabilityHub('skill')
        }
      }
    }

    function updateSkillButton() {
      if (!els.skillSelectBtn) return
      const arrowSvg = '<span class="skill-arrow"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>'
      const iconSvg = `<span class="skill-trigger-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9z"/><path d="M19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7z"/></svg></span>`
      const current = activeSkillName()
      if (current) {
        const skill = allSkills().find(s => s.name === current)
        els.skillSelectBtn.innerHTML = `${iconSvg}<span class="skill-current">${escapeHtml(skill?.title || current)}</span>${arrowSvg}`
        els.skillSelectBtn.classList.add('active')
      } else {
        els.skillSelectBtn.innerHTML = `${iconSvg}<span class="skill-current">技能</span>${arrowSvg}`
        els.skillSelectBtn.classList.remove('active')
      }
    }

    /**
     * 仅当输入框选中了某个已启用技能时，注入该技能全文；否则不注入。
     */
    function buildSkillContentForSend(options = {}) {
      const primaryName = options.primaryName || activeSkillName()
      if (!primaryName) return null
      if (!enabledSkills().includes(primaryName)) return null
      const skill = allSkills().find(s => s.name === primaryName)
      if (!skill?.content) return null
      const title = skill.title || skill.name
      const src = skillSourceLabel(skill)
      return [
        `===== 当前选用技能：${title}（${skill.name}）[${src}] =====`,
        '以下技能说明仅补充任务做法，不能覆盖系统安全、回复风格与路径规则。',
        '',
        skill.content
      ].join('\n')
    }

    function getCurrentSkillContent() {
      return buildSkillContentForSend()
    }

    /**
     * @param {'home'|'skill'|'plugin'|string} target
     */
    function openCapabilityHub(target = 'home') {
      if (target === 'skill' || target === 'plugin') {
        capabilityView = target
        capabilityHubTab = target === 'plugin' ? 'marketplace' : 'installed'
      } else if (target === 'enabled' || target === 'installed') {
        capabilityView = 'skill'
        capabilityHubTab = target
      } else if (target === 'marketplace') {
        capabilityView = 'plugin'
        capabilityHubTab = 'marketplace'
      } else {
        capabilityView = 'home'
      }
      if (typeof window.openResourceCenter === 'function') {
        window.openResourceCenter('capabilities')
      } else if (typeof window.openIntegrationMarketTab === 'function') {
        window.openIntegrationMarketTab('capabilities')
      } else {
        window.LingxiPanelManager?.openExclusive?.('skill')
      }
      loadSkills()
    }

    async function uploadSkill() {
      if (!window.api) return
      const result = await window.api.selectSkillFile()
      if (result?.canceled) return
      if (result?.success) {
        await loadSkills()
        showToast(result.message || '技能已添加到「已安装」，请启用后在输入框选中', 'success')
        // 上传后只进入已安装，不自动对模型可见；可选自动启用便于下一步
        const name = result.skill?.name || result.name || result.skillName
        if (name && !enabledSkills().includes(name)) {
          await setSkillEnabled(name, true)
          showToast(`已自动启用「${name}」，可在输入框下拉中选中`, 'success')
        }
      } else {
        showToast('添加失败: ' + (result?.error || '未知错误'), 'error')
      }
    }

    function renderAll() {
      if (capabilityView === 'home') {
        showHome()
      } else {
        if (els.capabilityHome) els.capabilityHome.hidden = true
        if (els.capabilitySection) els.capabilitySection.hidden = false
        setHeaderForView()
        renderSection()
      }
      renderSkillMenu(els.skillMenuSearch?.value || '')
      updateSkillButton()
    }

    if (els.btnSkill) {
      // 侧栏“资源中心”是总入口，必须先落到资产首页；Skill 仍可从资源中心顶部标签进入。
      els.btnSkill.onclick = () => {
        if (typeof window.openResourceCenter === 'function') window.openResourceCenter('assets')
        else if (typeof window.openIntegrationMarketTab === 'function') window.openIntegrationMarketTab('assets')
        else openCapabilityHub('home')
      }
    }

    if (els.skillPanelBack) {
      els.skillPanelBack.onclick = () => {
        // Skill/插件 内返回能力首页；首页再返回资源中心/聊天
        if (capabilityView === 'skill' || capabilityView === 'plugin') {
          closeSkillDetail()
          showHome()
          return
        }
        closeSkillPanel()
        window.ProjectSwitcher?.returnToChatArea?.()
      }
    }

    if (els.skillSearchInput) {
      els.skillSearchInput.oninput = () => renderSkillList(els.skillSearchInput.value)
    }

    if (els.skillRefreshBtn) els.skillRefreshBtn.onclick = () => loadSkills()
    if (els.skillUploadBtn) els.skillUploadBtn.onclick = () => uploadSkill()

    if (els.skillSelectBtn) {
      els.skillSelectBtn.onclick = e => {
        e.stopPropagation()
        els.skillSelectMenu.classList.toggle('show')
        if (els.skillSelectMenu.classList.contains('show')) {
          loadSkills()
        }
      }
    }

    if (els.skillMenuSearch) {
      els.skillMenuSearch.oninput = () => renderSkillMenu(els.skillMenuSearch.value)
    }

    document.addEventListener('integration-market:skills-open', () => {
      // 打开能力时默认落在入口页（Skill | 插件）
      capabilityView = 'home'
      loadSkills()
    })
    document.addEventListener('integration-market:capabilities-open', e => {
      const tab = e.detail?.tab
      if (tab === 'skill' || tab === 'plugin' || tab === 'home') {
        capabilityView = tab
        if (tab === 'plugin') capabilityHubTab = 'marketplace'
        if (tab === 'skill') capabilityHubTab = 'installed'
      } else if (tab === 'enabled' || tab === 'installed') {
        capabilityView = 'skill'
        capabilityHubTab = tab
      } else if (tab === 'marketplace' || tab === 'selected') {
        capabilityView = tab === 'marketplace' ? 'plugin' : 'skill'
        capabilityHubTab = tab === 'marketplace' ? 'marketplace' : 'enabled'
      } else {
        capabilityView = 'home'
      }
      loadSkills()
    })

    document.addEventListener('click', e => {
      if (els.skillSelector && !els.skillSelector.contains(e.target)) {
        els.skillSelectMenu?.classList.remove('show')
      }
    })

    return {
      loadSkills,
      renderSkillCategoryTabs,
      renderSkillList,
      showSkillDetail,
      closeSkillDetail,
      closeSkillPanel,
      renderSkillMenu,
      updateSkillButton,
      getCurrentSkillContent,
      buildSkillContentForSend,
      openCapabilityHub,
      setSkillEnabled,
      pickActiveSkill
    }
  }

  window.SkillsMain = { bind }
})()
