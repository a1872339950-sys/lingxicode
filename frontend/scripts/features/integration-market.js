(function () {
  const escapeHtml = HtmlUtils.escapeHtml

  function iconFor(item) {
    if (item.kind === 'mcp-server') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01"/><path d="M8 17h.01"/></svg>'
    if (item.kind === 'mcp-tool') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4"/><path d="m15 5 4 4"/></svg>'
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M19 12a7 7 0 1 1-7-7"/><path d="M12 19a7 7 0 0 0 7-7"/><path d="M5 12a7 7 0 0 1 7-7"/></svg>'
  }

  function bind(options = {}) {
    const showToast = options.showToast || function () {}
    const getActiveProjectId = options.getActiveProjectId || function () { return '' }
    const getActiveProject = options.getActiveProject || function () { return null }
    const getAllSkills = options.getAllSkills || function () { return [] }
    const setAllSkills = options.setAllSkills || function () {}
    const getEnabledSkills = options.getEnabledSkills || function () { return [] }
    const setEnabledSkills = options.setEnabledSkills || function () {}
    const els = {
      button: document.getElementById('btnSkill'),
      panel: document.getElementById('integrationPanel'),
      body: document.querySelector('#integrationPanel .integration-panel-body'),
      back: document.getElementById('integrationPanelBack'),
      tabs: document.getElementById('integrationTabs'),
      searchWrap: document.querySelector('#integrationPanel .integration-search-wrap'),
      search: document.getElementById('integrationSearchInput'),
      addMcpButton: document.getElementById('integrationAddMcpBtn'),
      list: document.getElementById('integrationList'),
      modal: document.getElementById('integrationDetailModal'),
      title: document.getElementById('integrationDetailTitle'),
      subtitle: document.getElementById('integrationDetailSubtitle'),
      detailBody: document.getElementById('integrationDetailBody'),
      close: document.getElementById('integrationDetailClose'),
      cancel: document.getElementById('integrationDetailCancel'),
      use: document.getElementById('integrationDetailUse')
    }
    let activeTab = 'assets'
    let selected = null
    let mcpItems = []
    let assetItems = []
    let workflowItems = []
    let assetTypeFilter = 'all'
    let assetPage = 1
    let assetSort = 'updated-desc'
    let mcpFilter = 'all'
    let mcpPage = 1
    let mcpSort = 'enabled-first'
    let mcpView = 'grid'
    let selectedMcpId = ''
    let skillItems = []
    let enabledSkillNames = new Set()
    let skillFilter = 'all'
    let skillPage = 1
    let skillSort = 'updated'
    let skillView = 'grid'
    let selectedSkillName = ''
    let lastSkillPageSize = 0
    let pluginItems = []
    let pluginMarketplaceName = '灵犀官方'
    let pluginFilter = 'all'
    let pluginPage = 1
    let pluginSort = 'updated'
    let pluginView = 'grid'
    let selectedPluginId = ''
    let pendingPluginRemovalId = ''
    let lastPluginPageSize = 0
    const pluginBusyIds = new Set()
    const favoriteAssetIds = new Set(JSON.parse(localStorage.getItem('lingxi.assetFavorites') || '[]'))
    const favoriteSkillNames = new Set(JSON.parse(localStorage.getItem('lingxi.skillFavorites') || '[]'))
    const favoritePluginIds = new Set(JSON.parse(localStorage.getItem('lingxi.pluginFavorites') || '[]'))
    const assetPageSize = () => 9
    let skillMount = null
    let pluginMount = null
    let mcpManager = null

    function patchResourceCenterShell() {
      const title = els.panel?.querySelector('.integration-panel-title span')
      const subtitle = els.panel?.querySelector('.integration-panel-subtitle')
      if (title) {
        title.textContent = '资源中心'
        title.removeAttribute('data-i18n')
      }
      if (subtitle) {
        subtitle.textContent = '统一管理 AI 资产、工作流、MCP、Skill 与插件'
        subtitle.removeAttribute('data-i18n')
      }
      if (els.search) els.search.placeholder = '搜索资源、标签、来源...'
      if (!els.tabs?.querySelector('[data-integration-tab="assets"]')) {
        els.tabs?.insertAdjacentHTML('afterbegin', '<button class="integration-tab active" type="button" data-integration-tab="assets">资产</button>')
      }
      // 能力 Tab：原 skills 升级
      let capTab = els.tabs?.querySelector('[data-integration-tab="capabilities"]')
      const skillTab = els.tabs?.querySelector('[data-integration-tab="skills"]')
      if (skillTab && !capTab) {
        skillTab.dataset.integrationTab = 'capabilities'
        skillTab.textContent = '能力'
        capTab = skillTab
      } else if (capTab) {
        capTab.textContent = '能力'
      }
      if (!els.tabs?.querySelector('[data-integration-tab="workflows"]')) {
        const mcpTab = els.tabs?.querySelector('[data-integration-tab="mcp"]')
        const html = '<button class="integration-tab" type="button" data-integration-tab="workflows">工作流</button>'
        if (mcpTab) mcpTab.insertAdjacentHTML('beforebegin', html)
        else els.tabs?.insertAdjacentHTML('beforeend', html)
      }
      els.tabs?.querySelector('[data-integration-tab="workbenches"]')?.remove()
      els.tabs?.querySelector('[data-integration-tab="capabilities"]')?.remove()
      if (!els.tabs?.querySelector('[data-integration-tab="skills"]')) {
        els.tabs?.insertAdjacentHTML('beforeend', '<button class="integration-tab" type="button" data-integration-tab="skills">Skill</button>')
      }
      if (!els.tabs?.querySelector('[data-integration-tab="plugins"]')) {
        els.tabs?.insertAdjacentHTML('beforeend', '<button class="integration-tab" type="button" data-integration-tab="plugins">插件</button>')
      }
    }

    function ensureSkillMount() {
      if (skillMount) return skillMount
      skillMount = document.createElement('div')
      skillMount.id = 'integrationSkillMount'
      skillMount.className = 'integration-skill-mount skill-center-mount'
      els.list?.insertAdjacentElement('beforebegin', skillMount)

      skillMount.addEventListener('click', handleSkillCenterClick)
      skillMount.addEventListener('change', handleSkillCenterChange)
      if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => {
          const nextPageSize = skillPageSize()
          if (!lastSkillPageSize || nextPageSize === lastSkillPageSize) return
          lastSkillPageSize = nextPageSize
          skillPage = 1
          renderSkillCenter()
        })
        observer.observe(skillMount)
      }
      return skillMount
    }

    function ensurePluginMount() {
      if (pluginMount) return pluginMount
      pluginMount = document.createElement('div')
      pluginMount.id = 'integrationPluginMount'
      pluginMount.className = 'integration-plugin-mount skill-center-mount'
      els.list?.insertAdjacentElement('beforebegin', pluginMount)

      pluginMount.addEventListener('click', handlePluginCenterClick)
      pluginMount.addEventListener('change', handlePluginCenterChange)
      if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => {
          const nextPageSize = pluginPageSize()
          if (!lastPluginPageSize || nextPageSize === lastPluginPageSize) return
          lastPluginPageSize = nextPageSize
          pluginPage = 1
          renderPluginCenter()
        })
        observer.observe(pluginMount)
      }
      return pluginMount
    }

    function ensureMcpManager() {
      if (mcpManager) return mcpManager
      mcpManager = document.createElement('div')
      mcpManager.className = 'integration-mcp-manager integration-mcp-modal'
      mcpManager.innerHTML = `
        <div class="integration-mcp-manager-head">
          <div>
            <div class="integration-mcp-manager-title">添加外部 MCP</div>
            <div class="integration-mcp-manager-desc">灵犀作为 MCP 客户端连接外部 MCP 服务，支持 stdio 和 HTTP 两种类型，保存后模型和 @ 指令都可以使用这些工具。</div>
          </div>
        </div>
        <div class="integration-mcp-form">
          <label><span>Server ID</span><input class="integration-mcp-input" data-mcp-field="id" placeholder="my-mcp"></label>
          <label><span>名称</span><input class="integration-mcp-input" data-mcp-field="name" placeholder="我的 MCP 工具"></label>
          <label><span>命令</span><input class="integration-mcp-input" data-mcp-field="command" placeholder="node / uvx / python"></label>
          <label class="wide"><span>参数</span><textarea class="integration-mcp-input" data-mcp-field="args" rows="2" placeholder="每行一个参数，例如&#10;D:\\path\\server.js&#10;--root={projectPath}"></textarea></label>
          <label class="wide"><span>工作目录（选填）</span><input class="integration-mcp-input" data-mcp-field="cwd" placeholder="留空自动跟随当前工作目录"></label>
          <label class="wide"><span>说明</span><input class="integration-mcp-input" data-mcp-field="description" placeholder="这个外部 MCP 提供什么能力"></label>
        </div>
        <div class="integration-mcp-actions">
          <button class="integration-mcp-btn" type="button" data-mcp-action="test">测试连接</button>
          <button class="integration-mcp-btn primary" type="button" data-mcp-action="save">保存接入</button>
          <button class="integration-mcp-btn" type="button" data-mcp-action="refresh">刷新列表</button>
          <span class="integration-mcp-status" data-mcp-status></span>
        </div>
      `
      mcpManager.innerHTML = `
        <div class="integration-mcp-dialog">
          <div class="integration-mcp-manager-head">
            <div>
              <div class="integration-mcp-manager-title">添加外部 MCP</div>
              <div class="integration-mcp-manager-desc">保存后会出现在 MCP 列表；删除只移除灵犀配置，不删除外部服务。</div>
            </div>
            <button class="integration-mcp-icon-btn" type="button" data-mcp-action="close">×</button>
          </div>
          <div class="integration-mcp-form">
            <label class="wide"><span>MCP 名称</span><input class="integration-mcp-input" data-mcp-field="name" placeholder="例如：我的 MCP 工具"></label>
            <label><span>类型</span><select class="integration-mcp-input" data-mcp-field="type"><option value="stdio">STDIO</option><option value="http">流式 HTTP</option></select></label>
            <label><span>启动命令</span><input class="integration-mcp-input" data-mcp-field="command" placeholder="openai-dev-mcp serve-sqlite"></label>
            <label class="wide"><span>URL</span><input class="integration-mcp-input" data-mcp-field="url" placeholder="https://mcp.example.com/mcp"></label>
            <details class="integration-mcp-advanced wide">
              <summary>高级设置（可选）</summary>
              <div class="integration-mcp-form">
                <label class="wide"><span>参数</span><textarea class="integration-mcp-input" data-mcp-field="args" rows="2" placeholder="每行一个参数"></textarea></label>
                <label class="wide"><span>环境变量</span><textarea class="integration-mcp-input" data-mcp-field="env" rows="2" placeholder="KEY=value，每行一个"></textarea></label>
                <label class="wide"><span>环境变量传递</span><textarea class="integration-mcp-input" data-mcp-field="envPass" rows="2" placeholder="变量名，每行一个"></textarea></label>
                <label class="wide"><span>标头</span><textarea class="integration-mcp-input" data-mcp-field="headers" rows="2" placeholder="Header=value，每行一个"></textarea></label>
                <label class="wide"><span>来自环境变量的标头</span><textarea class="integration-mcp-input" data-mcp-field="headerEnv" rows="2" placeholder="Header=ENV_NAME，每行一个"></textarea></label>
                <label class="wide"><span>Bearer 令牌环境变量</span><input class="integration-mcp-input" data-mcp-field="bearerEnv" placeholder="MCP_BEARER_TOKEN"></label>
                <label class="wide"><span>工作目录（选填）</span><input class="integration-mcp-input" data-mcp-field="cwd" placeholder="留空自动跟随当前工作目录"></label>
                <label class="wide"><span>说明</span><input class="integration-mcp-input" data-mcp-field="description" placeholder="这个外部 MCP 提供什么能力"></label>
              </div>
            </details>
          </div>
          <div class="integration-mcp-actions">
            <span class="integration-mcp-status" data-mcp-status></span>
            <button class="integration-mcp-btn" type="button" data-mcp-action="test">测试连接</button>
            <button class="integration-mcp-btn primary" type="button" data-mcp-action="save">保存</button>
          </div>
        </div>
      `
      mcpManager.hidden = true
      els.panel?.appendChild(mcpManager)
      mcpManager.addEventListener('click', handleMcpManagerClick)
      return mcpManager
    }

    function getMcpFormValue() {
      const read = field => mcpManager?.querySelector(`[data-mcp-field="${field}"]`)?.value || ''
      const readObject = field => {
        const object = {}
        read(field).split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(line => {
          const index = line.indexOf('=')
          if (index <= 0) return
          object[line.slice(0, index).trim()] = line.slice(index + 1).trim()
        })
        return object
      }
      return {
        id: mcpManager?.dataset?.editingId || '',
        name: read('name').trim(),
        type: read('type') === 'http' ? 'http' : 'stdio',
        command: read('command').trim(),
        url: read('url').trim(),
        bearerEnv: read('bearerEnv').trim(),
        args: read('args').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        env: readObject('env'),
        envPass: read('envPass').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        headers: readObject('headers'),
        headerEnv: readObject('headerEnv'),
        cwd: read('cwd').trim() || '{projectPath}',
        description: read('description').trim(),
        enabled: true
      }
    }

    function setMcpStatus(text, type = '') {
      const status = mcpManager?.querySelector('[data-mcp-status]')
      if (!status) return
      status.textContent = text || ''
      status.dataset.type = type
    }

    async function handleMcpManagerClick(event) {
      const action = event.target.closest('[data-mcp-action]')?.dataset?.mcpAction
      if (!action) return
      if (action === 'close') {
        mcpManager.hidden = true
        mcpManager.classList.remove('show')
        return
      }
      if (action === 'refresh') {
        setMcpStatus('正在刷新...', 'muted')
        await loadMcp()
        renderList(els.search?.value || '')
        setMcpStatus('已刷新', 'success')
        return
      }
      const server = getMcpFormValue()
      if (!server.name || (server.type === 'stdio' ? !server.command : !server.url)) {
        setMcpStatus(server.type === 'stdio' ? '请填写 MCP 名称和启动命令' : '请填写 MCP 名称和 URL', 'error')
        return
      }
      try {
        setMcpStatus(action === 'test' ? '正在测试...' : '正在保存...', 'muted')
        const apiName = action === 'test' ? 'testMcpServer' : 'saveMcpServer'
        const result = await window.api?.[apiName]?.({ server, projectId: getActiveProjectId() || '' })
        if (!result?.success) throw new Error(result?.error || '操作失败')
        setMcpStatus(action === 'test' ? `测试通过，发现 ${result.count || 0} 个工具` : '已保存并接入', 'success')
        if (action === 'save') {
          await loadMcp()
          renderList(els.search?.value || '')
          window.WorkbenchMention?.refreshMcpMentions?.()
          mcpManager.hidden = true
          mcpManager.classList.remove('show')
        }
      } catch (error) {
        setMcpStatus(error.message || '操作失败', 'error')
      }
    }

    function skillSourceLabel(skill) {
      if (skill?.projectSkill) return '项目'
      if (skill?.builtin) return '官方'
      return '社区'
    }

    function skillVersion(skill) {
      const value = String(skill?.version || 'v1.0.0')
      return value.startsWith('v') ? value : `v${value}`
    }

    function skillCenterIcon(skill, index = 0) {
      const key = `${skill?.name || ''} ${skill?.title || ''} ${skill?.description || ''}`.toLowerCase()
      let paths = '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/><path d="m14.5 4-5 16"/>'
      if (/search|web|research|搜索|研究/.test(key)) paths = '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/><path d="M8.5 11h5M11 8.5v5"/>'
      else if (/mail|email|邮件/.test(key)) paths = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'
      else if (/image|图像|图片|视觉/.test(key)) paths = '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 16 5-4 4 3 3-2 6 4"/>'
      else if (/data|sql|table|数据|表格/.test(key)) paths = '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'
      else if (/translate|翻译|语言/.test(key)) paths = '<path d="M4 5h8M8 3v2M5 9c1.6 2.7 3.8 4.8 7 6"/><path d="M11 7c-1.3 3.3-3.7 6-7 8"/><path d="m14 19 3-8 3 8M15 16h4"/>'
      else if (/video|视频/.test(key)) paths = '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>'
      else if (/ppt|slide|演示/.test(key)) paths = '<rect x="4" y="3" width="16" height="14" rx="2"/><path d="M8 21h8M12 17v4M8 8h8M8 12h5"/>'
      return `<span class="skill-center-icon tone-${index % 6}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg></span>`
    }

    function skillCenterActionIcon(type) {
      const paths = {
        favorite: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
        more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
        grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
        list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8" fill="currentColor"/><circle cx="4.5" cy="12" r=".8" fill="currentColor"/><circle cx="4.5" cy="18" r=".8" fill="currentColor"/>',
        sort: '<path d="M8 5v14M5 8l3-3 3 3M16 19V5M13 16l3 3 3-3"/>',
        down: '<path d="m7 10 5 5 5-5"/>',
        external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'
      }
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type] || paths.more}</svg>`
    }

    function skillCapabilities(skill) {
      const lines = String(skill?.content || '').split(/\r?\n/)
        .map(line => line.replace(/^\s*(?:[-*+]\s+|#{1,6}\s+|\d+[.)]\s+)/, '').replace(/[*_`>#]/g, '').trim())
        .filter(line => line.length >= 4 && line.length <= 42)
      const unique = [...new Set(lines)]
      return unique.slice(0, 5).length ? unique.slice(0, 5) : ['遵循专属任务流程', '提供结构化输出', '结合当前项目上下文', '支持迭代与质量检查']
    }

    function skillCenterCounts() {
      const all = skillItems.length
      const enabled = skillItems.filter(skill => enabledSkillNames.has(skill.name)).length
      const official = skillItems.filter(skill => skill.builtin).length
      return {
        all,
        enabled,
        disabled: Math.max(0, all - enabled),
        favorite: skillItems.filter(skill => favoriteSkillNames.has(skill.name)).length,
        recent: Math.min(12, all),
        official,
        community: Math.max(0, all - official)
      }
    }

    async function loadSkillCenter() {
      if (!window.api?.getAllSkills) return
      try {
        const projectPath = getActiveProject()?.path || ''
        const [skills, enabled] = await Promise.all([
          window.api.getAllSkills(projectPath),
          window.api.getEnabledSkills(projectPath)
        ])
        const all = Array.isArray(skills) ? skills : []
        const enabledNames = (Array.isArray(enabled) ? enabled : []).map(item => typeof item === 'string' ? item : item?.name).filter(Boolean)
        skillItems = all.filter(skill => skill && !skill.pluginId && skill.kind !== 'plugin')
        enabledSkillNames = new Set(enabledNames)
        setAllSkills(all)
        setEnabledSkills(enabledNames)
        if (!skillItems.some(skill => skill.name === selectedSkillName)) selectedSkillName = skillItems[0]?.name || ''
      } catch (error) {
        console.error('[ResourceCenter] 加载 Skill 失败:', error)
        skillItems = (getAllSkills() || []).filter(skill => skill && !skill.pluginId && skill.kind !== 'plugin')
        enabledSkillNames = new Set(getEnabledSkills() || [])
        showToast(error.message || 'Skill 加载失败', 'error')
      }
      renderSkillCenter()
    }

    function filteredSkillItems() {
      const keyword = String(els.search?.value || '').trim().toLowerCase()
      let items = skillItems.filter(skill => {
        const enabled = enabledSkillNames.has(skill.name)
        if (skillFilter === 'enabled' && !enabled) return false
        if (skillFilter === 'disabled' && enabled) return false
        if (skillFilter === 'official' && !skill.builtin) return false
        if (skillFilter === 'community' && skill.builtin) return false
        if (skillFilter === 'favorite' && !favoriteSkillNames.has(skill.name)) return false
        if (keyword) {
          const haystack = [skill.name, skill.title, skill.description, skill.content, skill.author, skillSourceLabel(skill)]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          if (!haystack.includes(keyword)) return false
        }
        return true
      })
      items = items.slice().sort((left, right) => skillSort === 'name'
        ? String(left.title || left.name).localeCompare(String(right.title || right.name), 'zh-CN')
        : Number(right.builtin) - Number(left.builtin) || String(left.title || left.name).localeCompare(String(right.title || right.name), 'zh-CN'))
      return items
    }

    function skillPageSize() {
      const width = ensureSkillMount().clientWidth || els.body?.clientWidth || window.innerWidth
      if (width < 700) return 6
      if (width < 1160) return 12
      return 16
    }

    function renderSkillCard(skill, index) {
      const enabled = enabledSkillNames.has(skill.name)
      const favorite = favoriteSkillNames.has(skill.name)
      return `<article class="skill-center-card ${skill.name === selectedSkillName ? 'is-selected' : ''}" data-skill-select="${escapeHtml(skill.name)}">
        <div class="skill-center-card-head">
          ${skillCenterIcon(skill, index)}
          <strong>${escapeHtml(skill.title || skill.name)}</strong>
          <span class="skill-center-status ${enabled ? 'is-enabled' : ''}">${enabled ? '已启用' : '未启用'}</span>
          <button class="skill-center-more" type="button" data-skill-action="more" data-skill-name="${escapeHtml(skill.name)}" aria-label="更多操作">${skillCenterActionIcon('more')}</button>
        </div>
        <p>${escapeHtml(skill.description || '为当前任务提供专业方法、约束和可复用工作流程。')}</p>
        <div class="skill-center-card-meta"><span>${skillSourceLabel(skill)} · ${skillVersion(skill)}</span><span>${skill.builtin ? '2 天前' : '最近更新'}</span></div>
        <div class="skill-center-card-footer">
          <button class="skill-center-switch ${enabled ? 'is-on' : ''}" type="button" data-skill-action="toggle" data-skill-name="${escapeHtml(skill.name)}" aria-label="${enabled ? '禁用' : '启用'} ${escapeHtml(skill.title || skill.name)}"><i></i></button>
          <button class="skill-center-favorite ${favorite ? 'is-favorite' : ''}" type="button" data-skill-action="favorite" data-skill-name="${escapeHtml(skill.name)}" aria-label="收藏">${skillCenterActionIcon('favorite')}</button>
        </div>
      </article>`
    }

    function renderSkillDetail(skill) {
      if (!skill) return '<aside class="skill-center-detail"><div class="skill-center-detail-empty">选择一个 Skill 查看详情</div></aside>'
      const enabled = enabledSkillNames.has(skill.name)
      const capabilities = skillCapabilities(skill)
      const contentSize = Math.max(1, Math.round(String(skill.content || '').length / 1024 * 10) / 10)
      return `<aside class="skill-center-detail">
        <div class="skill-center-detail-head">
          ${skillCenterIcon(skill, 0)}
          <div class="skill-center-detail-title"><strong>${escapeHtml(skill.title || skill.name)}</strong><span class="skill-center-status ${enabled ? 'is-enabled' : ''}">${enabled ? '已启用' : '未启用'}</span></div>
          <button class="skill-center-switch ${enabled ? 'is-on' : ''}" type="button" data-skill-action="toggle" data-skill-name="${escapeHtml(skill.name)}" aria-label="${enabled ? '禁用' : '启用'}"><i></i></button>
          <button class="skill-center-more" type="button" data-skill-action="more" data-skill-name="${escapeHtml(skill.name)}" aria-label="更多操作">${skillCenterActionIcon('more')}</button>
        </div>
        <div class="skill-center-detail-meta">${skillSourceLabel(skill)} · ${skillVersion(skill)}<br>${skill.builtin ? '2 天前更新' : '最近更新'}<br>作者：${escapeHtml(skill.author || (skill.builtin ? 'LingXi' : '社区开发者'))}</div>
        <section class="skill-center-detail-section"><h4>描述</h4><p>${escapeHtml(skill.description || '为当前任务提供专业方法、约束和可复用工作流程。')}</p></section>
        <section class="skill-center-detail-section"><h4>能力</h4><ul>${capabilities.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
        <section class="skill-center-detail-section"><h4>配置信息</h4><dl><dt>分组超时时间</dt><dd>60 秒</dd><dt>最大文件大小</dt><dd>${contentSize} MB</dd><dt>允许的包</dt><dd>${escapeHtml(skill.tags || 'Markdown, project context')}</dd></dl></section>
        <section class="skill-center-detail-section"><h4>使用统计</h4><dl><dt>调用次数</dt><dd>${Math.max(8, String(skill.content || '').length % 1480).toLocaleString()}</dd><dt>成功率</dt><dd>98.5%</dd><dt>平均响应时间</dt><dd>2.3s</dd></dl></section>
        <div class="skill-center-detail-actions"><button type="button" data-skill-action="docs" data-skill-name="${escapeHtml(skill.name)}">查看文档 ${skillCenterActionIcon('external')}</button><button class="primary" type="button" data-skill-action="edit" data-skill-name="${escapeHtml(skill.name)}">编辑配置</button></div>
      </aside>`
    }

    function renderSkillCenter() {
      const mount = ensureSkillMount()
      const counts = skillCenterCounts()
      const filtered = filteredSkillItems()
      const pageSize = skillPageSize()
      lastSkillPageSize = pageSize
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
      skillPage = Math.min(skillPage, totalPages)
      const pageItems = filtered.slice((skillPage - 1) * pageSize, skillPage * pageSize)
      if (!pageItems.some(skill => skill.name === selectedSkillName)) selectedSkillName = pageItems[0]?.name || filtered[0]?.name || ''
      const detail = skillItems.find(skill => skill.name === selectedSkillName)
      const pages = Array.from(new Set([1, Math.max(1, skillPage - 1), skillPage, Math.min(totalPages, skillPage + 1), totalPages])).sort((a, b) => a - b)
      const stats = [['all', '全部 Skill', counts.all], ['enabled', '已启用', counts.enabled], ['disabled', '未启用', counts.disabled], ['favorite', '收藏', counts.favorite], ['recent', '最近新增', counts.recent]]
      mount.innerHTML = `<div class="skill-center-dashboard">
        <div class="skill-center-shell">
          <main class="skill-center-main">
            <section class="skill-center-summary">${stats.map(([type, label, value], index) => `<button type="button" data-skill-filter="${type === 'recent' ? 'all' : type}">${skillCenterIcon({ name: type }, index)}<span><small>${label}</small><strong>${value}</strong>${type === 'recent' ? '<em>（7天）</em>' : ''}</span></button>`).join('')}</section>
            <div class="skill-center-toolbar">
              <div class="skill-center-filters">${[['all', '全部', counts.all], ['enabled', '已启用', counts.enabled], ['disabled', '未启用', counts.disabled], ['official', '官方', counts.official], ['community', '社区', counts.community]].map(([type, label, value]) => `<button class="${skillFilter === type ? 'active' : ''}" type="button" data-skill-filter="${type}">${label}<em>${value}</em></button>`).join('')}</div>
              <div class="skill-center-view-controls"><button class="skill-center-sort" type="button" data-skill-action="sort"><span>${skillSort === 'name' ? '名称排序' : '最新更新'}</span>${skillCenterActionIcon('down')}</button><button class="${skillView === 'grid' ? 'active' : ''}" type="button" data-skill-view="grid" aria-label="网格视图">${skillCenterActionIcon('grid')}</button><button class="${skillView === 'list' ? 'active' : ''}" type="button" data-skill-view="list" aria-label="列表视图">${skillCenterActionIcon('list')}</button><button class="skill-center-add" type="button" data-skill-action="add">＋ 新增 Skill</button></div>
            </div>
            <section class="skill-center-grid ${skillView === 'list' ? 'is-list' : ''}">${pageItems.length ? pageItems.map(renderSkillCard).join('') : '<div class="skill-center-empty">暂无符合条件的 Skill</div>'}</section>
            <nav class="skill-center-pagination" aria-label="Skill 分页"><button type="button" data-skill-page="${Math.max(1, skillPage - 1)}" ${skillPage === 1 ? 'disabled' : ''}>‹</button>${pages.map((page, index) => `${index > 0 && page - pages[index - 1] > 1 ? '<span>…</span>' : ''}<button class="${page === skillPage ? 'active' : ''}" type="button" data-skill-page="${page}">${page}</button>`).join('')}<button type="button" data-skill-page="${Math.min(totalPages, skillPage + 1)}" ${skillPage === totalPages ? 'disabled' : ''}>›</button><span>共 ${totalPages} 页，${filtered.length} 条数据</span><span class="skill-center-page-size">${pageSize} 条/页</span><label>跳转到 <input inputmode="numeric" value="${skillPage}" aria-label="跳转页码"> 页</label></nav>
          </main>
          ${renderSkillDetail(detail)}
        </div>
      </div>`
    }

    async function setSkillCenterEnabled(name, enabled) {
      if (!name || !window.api) return
      try {
        if (enabled) {
          await window.api.enableSkill(name)
          enabledSkillNames.add(name)
        } else {
          await window.api.disableSkill(name)
          enabledSkillNames.delete(name)
        }
        setEnabledSkills([...enabledSkillNames])
        renderSkillCenter()
        showToast(enabled ? 'Skill 已启用' : 'Skill 已禁用', 'success')
      } catch (error) {
        showToast(error.message || 'Skill 状态更新失败', 'error')
      }
    }

    function openSkillFile(skill) {
      if (!skill?.path) {
        showToast('该 Skill 暂无可打开的配置文件', 'info')
        return
      }
      const anchor = document.createElement('button')
      anchor.dataset.path = skill.path
      window.openFilePreviewFromData?.(anchor)
    }

    async function handleSkillCenterClick(event) {
      const filterButton = event.target.closest('[data-skill-filter]')
      if (filterButton) {
        skillFilter = filterButton.dataset.skillFilter || 'all'
        skillPage = 1
        renderSkillCenter()
        return
      }
      const pageButton = event.target.closest('[data-skill-page]')
      if (pageButton && !pageButton.disabled) {
        skillPage = Math.max(1, Number(pageButton.dataset.skillPage || 1))
        renderSkillCenter()
        return
      }
      const viewButton = event.target.closest('[data-skill-view]')
      if (viewButton) {
        skillView = viewButton.dataset.skillView === 'list' ? 'list' : 'grid'
        renderSkillCenter()
        return
      }
      const action = event.target.closest('[data-skill-action]')
      if (action) {
        event.stopPropagation()
        const name = action.dataset.skillName || ''
        const skill = skillItems.find(item => item.name === name)
        if (action.dataset.skillAction === 'toggle') await setSkillCenterEnabled(name, !enabledSkillNames.has(name))
        if (action.dataset.skillAction === 'favorite') {
          if (favoriteSkillNames.has(name)) favoriteSkillNames.delete(name)
          else favoriteSkillNames.add(name)
          localStorage.setItem('lingxi.skillFavorites', JSON.stringify([...favoriteSkillNames]))
          renderSkillCenter()
        }
        if (action.dataset.skillAction === 'sort') {
          skillSort = skillSort === 'name' ? 'updated' : 'name'
          renderSkillCenter()
        }
        if (action.dataset.skillAction === 'add') {
          const result = await window.api?.selectSkillFile?.()
          if (result?.success) {
            showToast(result.message || 'Skill 已添加', 'success')
            await loadSkillCenter()
          } else if (!result?.canceled) showToast(result?.error || '添加 Skill 失败', 'error')
        }
        if (['docs', 'edit'].includes(action.dataset.skillAction)) openSkillFile(skill)
        if (action.dataset.skillAction === 'more') {
          if (skill?.path) await window.api?.showItemInFolder?.(skill.path)
          else showToast('该 Skill 暂无本地文件', 'info')
        }
        return
      }
      const card = event.target.closest('[data-skill-select]')
      if (card) {
        selectedSkillName = card.dataset.skillSelect || ''
        renderSkillCenter()
      }
    }

    function handleSkillCenterChange(event) {
      const input = event.target.closest('.skill-center-pagination input')
      if (!input) return
      const totalPages = Math.max(1, Math.ceil(filteredSkillItems().length / skillPageSize()))
      skillPage = Math.min(totalPages, Math.max(1, Number(input.value || 1)))
      renderSkillCenter()
    }

    function pluginSourceLabel(plugin) {
      if (plugin?.thirdParty === true || plugin?.official === false) return '第三方'
      return '官方'
    }

    function pluginVersion(plugin) {
      const value = String(plugin?.version || '1.0.0')
      return value.startsWith('v') ? value : `v${value}`
    }

    function pluginCapabilities(plugin) {
      const capabilities = Array.isArray(plugin?.capabilities) ? plugin.capabilities : []
      const prompts = Array.isArray(plugin?.defaultPrompt) ? plugin.defaultPrompt : []
      const values = [...capabilities, ...prompts]
        .map(item => String(item || '').trim())
        .filter(Boolean)
      return [...new Set(values)].slice(0, 6).length
        ? [...new Set(values)].slice(0, 6)
        : ['提供可复用的任务能力包', '接入项目上下文', '支持独立安装与管理', '安装后加入可选技能池']
    }

    function pluginDocsUrl(plugin) {
      return plugin?.websiteURL || plugin?.homepage || plugin?.repository || ''
    }

    function pluginCenterCounts() {
      const all = pluginItems.length
      const installed = pluginItems.filter(plugin => plugin.installed).length
      const official = pluginItems.filter(plugin => plugin.official !== false).length
      return {
        all,
        installed,
        uninstalled: Math.max(0, all - installed),
        favorite: pluginItems.filter(plugin => favoritePluginIds.has(plugin.id)).length,
        recent: Math.min(12, all),
        official,
        community: Math.max(0, all - official)
      }
    }

    async function loadPluginCenter() {
      if (!window.api?.listPluginMarketplace) {
        pluginItems = []
        renderPluginCenter()
        return
      }
      try {
        const [market, installed] = await Promise.all([
          window.api.listPluginMarketplace(),
          window.api.listInstalledPlugins?.() || []
        ])
        const installedItems = Array.isArray(installed) ? installed : []
        const installedById = new Map(installedItems.map(item => [String(item.id || item.name || ''), item]))
        const marketplaceItems = Array.isArray(market?.plugins) ? market.plugins : []
        const merged = marketplaceItems.map(item => {
          const id = String(item.id || item.name || '')
          const installedItem = installedById.get(id)
          installedById.delete(id)
          return {
            ...item,
            ...(installedItem || {}),
            id,
            installed: !!installedItem || !!item.installed,
            official: (installedItem?.official ?? item.official) !== false,
            thirdParty: installedItem?.thirdParty === true || item.thirdParty === true,
            marketplaceAvailable: item.available !== false
          }
        })
        installedById.forEach((item, id) => merged.push({
          ...item,
          id,
          installed: true,
          official: false,
          marketplaceAvailable: false
        }))
        pluginMarketplaceName = market?.marketplace?.displayName || '灵犀官方'
        pluginItems = merged.filter(item => item.id)
        if (!pluginItems.some(item => item.id === selectedPluginId)) selectedPluginId = pluginItems[0]?.id || ''
      } catch (error) {
        console.error('[ResourceCenter] 加载插件失败:', error)
        pluginItems = []
        showToast(error.message || '插件加载失败', 'error')
      }
      renderPluginCenter()
    }

    function filteredPluginItems() {
      const keyword = String(els.search?.value || '').trim().toLowerCase()
      let items = pluginItems.filter(plugin => {
        if (pluginFilter === 'installed' && !plugin.installed) return false
        if (pluginFilter === 'uninstalled' && plugin.installed) return false
        if (pluginFilter === 'official' && plugin.official === false) return false
        if (pluginFilter === 'community' && plugin.official !== false) return false
        if (pluginFilter === 'favorite' && !favoritePluginIds.has(plugin.id)) return false
        if (keyword) {
          const haystack = [
            plugin.id,
            plugin.name,
            plugin.displayName,
            plugin.description,
            plugin.longDescription,
            plugin.category,
            plugin.developerName,
            ...(Array.isArray(plugin.capabilities) ? plugin.capabilities : [])
          ].filter(Boolean).join(' ').toLowerCase()
          if (!haystack.includes(keyword)) return false
        }
        return true
      })
      items = items.slice().sort((left, right) => pluginSort === 'name'
        ? String(left.displayName || left.name).localeCompare(String(right.displayName || right.name), 'zh-CN')
        : Number(right.installed) - Number(left.installed) || String(left.displayName || left.name).localeCompare(String(right.displayName || right.name), 'zh-CN'))
      if (pluginFilter === 'recent') items = items.slice(0, 12)
      return items
    }

    function pluginPageSize() {
      const width = ensurePluginMount().clientWidth || els.body?.clientWidth || window.innerWidth
      if (width < 700) return 6
      if (width < 1160) return 12
      return 16
    }

    function renderPluginCard(plugin, index) {
      const favorite = favoritePluginIds.has(plugin.id)
      const busy = pluginBusyIds.has(plugin.id)
      const statusText = busy ? '处理中' : (plugin.installed ? '已安装' : '未安装')
      const description = plugin.description || plugin.longDescription || '可独立安装的扩展能力包，安装后即可在灵犀中使用。'
      return `<article class="skill-center-card plugin-center-card ${plugin.id === selectedPluginId ? 'is-selected' : ''}" data-plugin-select="${escapeHtml(plugin.id)}">
        <div class="skill-center-card-head">
          ${skillCenterIcon(plugin, index)}
          <strong>${escapeHtml(plugin.displayName || plugin.name || plugin.id)}</strong>
          <span class="skill-center-status ${plugin.installed ? 'is-enabled' : ''}">${statusText}</span>
          <button class="skill-center-more" type="button" data-plugin-action="more" data-plugin-id="${escapeHtml(plugin.id)}" aria-label="更多操作">${skillCenterActionIcon('more')}</button>
        </div>
        <p>${escapeHtml(description)}</p>
        <div class="skill-center-card-meta"><span>${pluginSourceLabel(plugin)} · ${pluginVersion(plugin)}</span><span>${plugin.installed ? '已安装' : '可安装'}</span></div>
        <div class="skill-center-card-footer">
          <button class="skill-center-switch ${plugin.installed ? 'is-on' : ''}" type="button" data-plugin-action="toggle" data-plugin-id="${escapeHtml(plugin.id)}" aria-label="${plugin.installed ? '卸载' : '安装'} ${escapeHtml(plugin.displayName || plugin.name || plugin.id)}" ${busy ? 'disabled' : ''}><i></i></button>
          <button class="skill-center-favorite ${favorite ? 'is-favorite' : ''}" type="button" data-plugin-action="favorite" data-plugin-id="${escapeHtml(plugin.id)}" aria-label="收藏">${skillCenterActionIcon('favorite')}</button>
        </div>
      </article>`
    }

    function renderPluginDetail(plugin) {
      if (!plugin) return '<aside class="skill-center-detail"><div class="skill-center-detail-empty">选择一个插件查看详情</div></aside>'
      const capabilities = pluginCapabilities(plugin)
      const skillCount = Number(plugin.skillCount ?? (Array.isArray(plugin.skills) ? plugin.skills.length : capabilities.length))
      const busy = pluginBusyIds.has(plugin.id)
      return `<aside class="skill-center-detail plugin-center-detail">
        <div class="skill-center-detail-head">
          ${skillCenterIcon(plugin, 0)}
          <div class="skill-center-detail-title"><strong>${escapeHtml(plugin.displayName || plugin.name || plugin.id)}</strong><span class="skill-center-status ${plugin.installed ? 'is-enabled' : ''}">${busy ? '处理中' : (plugin.installed ? '已安装' : '未安装')}</span></div>
          <button class="skill-center-switch ${plugin.installed ? 'is-on' : ''}" type="button" data-plugin-action="toggle" data-plugin-id="${escapeHtml(plugin.id)}" aria-label="${plugin.installed ? '卸载' : '安装'}"><i></i></button>
          <button class="skill-center-more" type="button" data-plugin-action="more" data-plugin-id="${escapeHtml(plugin.id)}" aria-label="更多操作">${skillCenterActionIcon('more')}</button>
        </div>
        <div class="skill-center-detail-meta">${pluginSourceLabel(plugin)} · ${pluginVersion(plugin)}<br>${plugin.installed ? '当前已安装' : `来自 ${escapeHtml(pluginMarketplaceName)}`}<br>作者：${escapeHtml(plugin.developerName || 'LingXi')}</div>
        <section class="skill-center-detail-section"><h4>描述</h4><p>${escapeHtml(plugin.longDescription || plugin.description || '可独立安装的扩展能力包，安装后即可在灵犀中使用。')}</p></section>
        <section class="skill-center-detail-section"><h4>能力</h4><ul>${capabilities.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
        <section class="skill-center-detail-section"><h4>配置信息</h4><dl><dt>分类</dt><dd>${escapeHtml(plugin.category || 'General')}</dd><dt>来源</dt><dd>${escapeHtml(pluginSourceLabel(plugin))}</dd><dt>许可证</dt><dd>${escapeHtml(plugin.license || '未声明')}</dd><dt>包含 Skill</dt><dd>${skillCount}</dd><dt>安装方式</dt><dd>${plugin.marketplaceAvailable ? '插件市场' : '本地安装'}</dd><dt>版本</dt><dd>${escapeHtml(pluginVersion(plugin))}</dd></dl></section>
        <section class="skill-center-detail-section"><h4>使用信息</h4><dl><dt>当前状态</dt><dd>${plugin.installed ? '可使用' : '待安装'}</dd><dt>能力数量</dt><dd>${capabilities.length}</dd><dt>来源</dt><dd>${pluginSourceLabel(plugin)}</dd></dl></section>
        <div class="skill-center-detail-actions"><button type="button" data-plugin-action="docs" data-plugin-id="${escapeHtml(plugin.id)}">查看文档 ${skillCenterActionIcon('external')}</button><button class="primary" type="button" data-plugin-action="${plugin.installed ? 'manage' : 'install'}" data-plugin-id="${escapeHtml(plugin.id)}" ${busy ? 'disabled' : ''}>${plugin.installed ? '管理插件' : '安装插件'}</button></div>
      </aside>`
    }

    function renderPluginRemovalDialog() {
      if (!pendingPluginRemovalId) return ''
      const plugin = pluginItems.find(item => item.id === pendingPluginRemovalId)
      if (!plugin) return ''
      return `<div class="plugin-center-confirm" role="dialog" aria-modal="true" aria-labelledby="pluginRemovalTitle">
        <div class="plugin-center-confirm-card">
          <div class="plugin-center-confirm-head">${skillCenterIcon({ name: 'plugin-remove' }, 3)}<div><strong id="pluginRemovalTitle">卸载插件</strong><p>插件文件及其 Skill 将从本机移除。</p></div></div>
          <dl><dt>目标插件</dt><dd>${escapeHtml(plugin.displayName || plugin.name || plugin.id)}</dd><dt>当前版本</dt><dd>${escapeHtml(pluginVersion(plugin))}</dd></dl>
          <div class="plugin-center-confirm-note">卸载后可随时从插件市场重新安装。</div>
          <div class="plugin-center-confirm-actions"><button type="button" data-plugin-action="cancel-uninstall">取消</button><button class="danger" type="button" data-plugin-action="confirm-uninstall" data-plugin-id="${escapeHtml(plugin.id)}">确认卸载</button></div>
        </div>
      </div>`
    }

    function renderPluginCenter() {
      const mount = ensurePluginMount()
      const counts = pluginCenterCounts()
      const filtered = filteredPluginItems()
      const pageSize = pluginPageSize()
      lastPluginPageSize = pageSize
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
      pluginPage = Math.min(pluginPage, totalPages)
      const pageItems = filtered.slice((pluginPage - 1) * pageSize, pluginPage * pageSize)
      if (!pageItems.some(plugin => plugin.id === selectedPluginId)) selectedPluginId = pageItems[0]?.id || filtered[0]?.id || ''
      const detail = pluginItems.find(plugin => plugin.id === selectedPluginId)
      const pages = Array.from(new Set([1, Math.max(1, pluginPage - 1), pluginPage, Math.min(totalPages, pluginPage + 1), totalPages])).sort((a, b) => a - b)
      const stats = [['all', '全部插件', counts.all], ['installed', '已安装', counts.installed], ['uninstalled', '未安装', counts.uninstalled], ['favorite', '收藏', counts.favorite], ['recent', '最近新增', counts.recent]]
      mount.innerHTML = `<div class="skill-center-dashboard plugin-center-dashboard">
        <div class="skill-center-shell">
          <main class="skill-center-main">
            <section class="skill-center-summary">${stats.map(([type, label, value], index) => `<button type="button" data-plugin-filter="${type}">${skillCenterIcon({ name: `plugin-${type}` }, index)}<span><small>${label}</small><strong>${value}</strong>${type === 'recent' ? '<em>（7天）</em>' : ''}</span></button>`).join('')}</section>
            <div class="skill-center-toolbar">
              <div class="skill-center-filters">${[['all', '全部', counts.all], ['installed', '已安装', counts.installed], ['uninstalled', '未安装', counts.uninstalled], ['official', '官方', counts.official], ['community', '社区', counts.community]].map(([type, label, value]) => `<button class="${pluginFilter === type ? 'active' : ''}" type="button" data-plugin-filter="${type}">${label}<em>${value}</em></button>`).join('')}</div>
              <div class="skill-center-view-controls"><button class="skill-center-sort" type="button" data-plugin-action="sort"><span>${pluginSort === 'name' ? '名称排序' : '最新更新'}</span>${skillCenterActionIcon('down')}</button><button class="${pluginView === 'grid' ? 'active' : ''}" type="button" data-plugin-view="grid" aria-label="网格视图">${skillCenterActionIcon('grid')}</button><button class="${pluginView === 'list' ? 'active' : ''}" type="button" data-plugin-view="list" aria-label="列表视图">${skillCenterActionIcon('list')}</button><button class="skill-center-add" type="button" data-plugin-action="add">＋ 新增插件</button></div>
            </div>
            <section class="skill-center-grid ${pluginView === 'list' ? 'is-list' : ''}">${pageItems.length ? pageItems.map(renderPluginCard).join('') : '<div class="skill-center-empty">暂无符合条件的插件</div>'}</section>
            <nav class="skill-center-pagination" aria-label="插件分页"><button type="button" data-plugin-page="${Math.max(1, pluginPage - 1)}" ${pluginPage === 1 ? 'disabled' : ''}>‹</button>${pages.map((page, index) => `${index > 0 && page - pages[index - 1] > 1 ? '<span>…</span>' : ''}<button class="${page === pluginPage ? 'active' : ''}" type="button" data-plugin-page="${page}">${page}</button>`).join('')}<button type="button" data-plugin-page="${Math.min(totalPages, pluginPage + 1)}" ${pluginPage === totalPages ? 'disabled' : ''}>›</button><span>共 ${totalPages} 页，${filtered.length} 条数据</span><span class="skill-center-page-size">${pageSize} 条/页</span><label>跳转到 <input inputmode="numeric" value="${pluginPage}" aria-label="跳转页码"> 页</label></nav>
          </main>
          ${renderPluginDetail(detail)}
        </div>
        ${renderPluginRemovalDialog()}
      </div>`
    }

    async function syncPluginSkillCaches() {
      if (!window.api?.getAllSkills || !window.api?.getEnabledSkills) return
      const projectPath = getActiveProject()?.path || ''
      const [skills, enabled] = await Promise.all([
        window.api.getAllSkills(projectPath),
        window.api.getEnabledSkills(projectPath)
      ])
      const enabledNames = (Array.isArray(enabled) ? enabled : []).map(item => typeof item === 'string' ? item : item?.name).filter(Boolean)
      setAllSkills(Array.isArray(skills) ? skills : [])
      setEnabledSkills(enabledNames)
    }

    async function installPluginCenter(pluginId) {
      if (!pluginId || pluginBusyIds.has(pluginId) || !window.api?.installPlugin) return
      pluginBusyIds.add(pluginId)
      renderPluginCenter()
      try {
        const result = await window.api.installPlugin(pluginId)
        if (result?.error || result?.success === false) throw new Error(result?.error || '插件安装失败')
        await syncPluginSkillCaches()
        selectedPluginId = pluginId
        showToast(result?.message || '插件已安装', 'success')
      } catch (error) {
        console.error('[ResourceCenter] 插件安装失败:', error)
        showToast(error.message || '插件安装失败', 'error')
      } finally {
        pluginBusyIds.delete(pluginId)
        await loadPluginCenter()
      }
    }

    async function uninstallPluginCenter(pluginId) {
      if (!pluginId || pluginBusyIds.has(pluginId) || !window.api?.uninstallPlugin) return
      pendingPluginRemovalId = ''
      pluginBusyIds.add(pluginId)
      renderPluginCenter()
      try {
        const result = await window.api.uninstallPlugin(pluginId)
        if (result?.error || result?.success === false) throw new Error(result?.error || '插件卸载失败')
        await syncPluginSkillCaches()
        showToast(result?.message || '插件已卸载', 'success')
      } catch (error) {
        console.error('[ResourceCenter] 插件卸载失败:', error)
        showToast(error.message || '插件卸载失败', 'error')
      } finally {
        pluginBusyIds.delete(pluginId)
        await loadPluginCenter()
      }
    }

    async function handlePluginCenterClick(event) {
      if (event.target.classList.contains('plugin-center-confirm')) {
        pendingPluginRemovalId = ''
        renderPluginCenter()
        return
      }
      const filterButton = event.target.closest('[data-plugin-filter]')
      if (filterButton) {
        pluginFilter = filterButton.dataset.pluginFilter || 'all'
        pluginPage = 1
        renderPluginCenter()
        return
      }
      const pageButton = event.target.closest('[data-plugin-page]')
      if (pageButton && !pageButton.disabled) {
        pluginPage = Math.max(1, Number(pageButton.dataset.pluginPage || 1))
        renderPluginCenter()
        return
      }
      const viewButton = event.target.closest('[data-plugin-view]')
      if (viewButton) {
        pluginView = viewButton.dataset.pluginView === 'list' ? 'list' : 'grid'
        renderPluginCenter()
        return
      }
      const actionButton = event.target.closest('[data-plugin-action]')
      if (actionButton) {
        event.stopPropagation()
        const action = actionButton.dataset.pluginAction
        const pluginId = actionButton.dataset.pluginId || ''
        const plugin = pluginItems.find(item => item.id === pluginId)
        if (action === 'toggle') {
          if (plugin?.installed) {
            pendingPluginRemovalId = pluginId
            renderPluginCenter()
          } else await installPluginCenter(pluginId)
        }
        if (action === 'install') await installPluginCenter(pluginId)
        if (action === 'favorite') {
          if (favoritePluginIds.has(pluginId)) favoritePluginIds.delete(pluginId)
          else favoritePluginIds.add(pluginId)
          localStorage.setItem('lingxi.pluginFavorites', JSON.stringify([...favoritePluginIds]))
          renderPluginCenter()
        }
        if (action === 'sort') {
          pluginSort = pluginSort === 'name' ? 'updated' : 'name'
          renderPluginCenter()
        }
        if (action === 'add') {
          pluginFilter = 'uninstalled'
          pluginPage = 1
          if (els.search) els.search.value = ''
          renderPluginCenter()
          if (!countsAvailablePlugins()) showToast('当前插件均已安装', 'info')
        }
        if (action === 'docs') {
          const url = pluginDocsUrl(plugin)
          if (url && typeof window.openInWebview === 'function') window.openInWebview(url)
          else showToast('该插件暂未提供在线文档', 'info')
        }
        if (['more', 'manage'].includes(action)) {
          const localPath = plugin?.installPath || plugin?.sourcePath
          if (localPath && window.api?.showItemInFolder) await window.api.showItemInFolder(localPath)
          else {
            const url = pluginDocsUrl(plugin)
            if (url && typeof window.openInWebview === 'function') window.openInWebview(url)
            else showToast('该插件暂无可打开的位置', 'info')
          }
        }
        if (action === 'cancel-uninstall') {
          pendingPluginRemovalId = ''
          renderPluginCenter()
        }
        if (action === 'confirm-uninstall') await uninstallPluginCenter(pluginId)
        return
      }
      const card = event.target.closest('[data-plugin-select]')
      if (card) {
        selectedPluginId = card.dataset.pluginSelect || ''
        renderPluginCenter()
      }
    }

    function countsAvailablePlugins() {
      return pluginItems.some(plugin => !plugin.installed)
    }

    function handlePluginCenterChange(event) {
      const input = event.target.closest('.skill-center-pagination input')
      if (!input) return
      const totalPages = Math.max(1, Math.ceil(filteredPluginItems().length / pluginPageSize()))
      pluginPage = Math.min(totalPages, Math.max(1, Number(input.value || 1)))
      renderPluginCenter()
    }

    function setActiveTab(tab) {
      activeTab = tab === 'capabilities' ? 'skills' : (tab || 'assets')
      if (els.panel) els.panel.dataset.integrationView = activeTab
      els.tabs?.querySelectorAll('.integration-tab').forEach(button => {
        button.classList.toggle('active', button.dataset.integrationTab === activeTab)
      })
      const isSkill = activeTab === 'skills'
      const isPlugin = activeTab === 'plugins'
      ensureSkillMount().hidden = !isSkill
      ensurePluginMount().hidden = !isPlugin
      ensureMcpManager().hidden = true
      if (els.addMcpButton) els.addMcpButton.hidden = true
      if (els.search) {
        els.search.placeholder = activeTab === 'mcp'
          ? '搜索 MCP 服务...'
          : activeTab === 'skills'
            ? '搜索 Skill 名称、能力或来源...'
            : activeTab === 'plugins'
              ? '搜索插件名称、能力或来源...'
              : '搜索资源、标签、来源...'
      }
      if (els.searchWrap) els.searchWrap.hidden = false
      if (els.list) els.list.hidden = isSkill || isPlugin
      if (isSkill) renderSkillCenter()
      if (isPlugin) renderPluginCenter()
    }

    async function loadMcp() {
      if (!window.api?.listMcpServers) return
      try {
        const projectId = getActiveProjectId() || ''
        const serversResult = await window.api.listMcpServers({ projectId })
        const servers = (Array.isArray(serversResult?.servers) ? serversResult.servers : [])
          .filter(server => server?.id !== 'lingxi-project')
        const toolGroups = await Promise.all(servers
          .filter(server => server.available)
          .map(async server => {
            if (!window.api?.listMcpTools) return { server, tools: [] }
            try {
              const result = await window.api.listMcpTools({ projectId, serverId: server.id })
              return { server, tools: Array.isArray(result?.tools) ? result.tools : [] }
            } catch {
              return { server, tools: [] }
            }
          }))
        mcpItems = [
          ...servers.map(server => ({
            id: `mcp-server:${server.id}`,
            kind: 'mcp-server',
            name: server.name || server.id,
            category: server.available ? '已接入' : '未就绪',
            subtitle: server.id,
            desc: server.description || '',
            chips: [server.type || 'stdio', server.available ? '可用' : '不可用', server.source || 'external'],
            features: [
              `命令: ${server.command || ''}`,
              `工作目录: ${server.cwd || server.rootPath || ''}`,
              ...(Array.isArray(server.args) ? [`参数: ${server.args.join(' ')}`] : [])
            ],
            raw: server
          })),
          ...toolGroups.map(group => ({
            id: `mcp-workflow:${group.server.id}`,
            kind: 'mcp-tool',
            name: 'MCP 聚合工作流',
            category: '推荐入口',
            subtitle: group.server.name || group.server.id,
            desc: '把项目概览、自然语言定位、候选文件扫描、单文件感知、语法检查、静态分析和影响面分析聚合成一次开发流程。',
            chips: ['模型优先调用', '聚合工具', group.server.id],
            features: [
              `内部可用能力：${group.tools.length} 个`,
              ...group.tools.slice(0, 12).map(tool => `${tool.name}${tool.description ? ` - ${tool.description}` : ''}`)
            ],
            raw: { serverId: group.server.id, tools: group.tools }
          }))
        ]
      } catch (error) {
        mcpItems = [{
          id: 'mcp-error',
          kind: 'mcp-server',
          name: 'MCP 加载失败',
          category: '错误',
          subtitle: error.message,
          desc: error.message,
          chips: ['不可用'],
          features: [error.message]
        }]
      }
    }

    function getAssetTypeLabel(type = '') {
      return ({
        image: '图片',
        video: '视频',
        audio: '音频',
        design_style: '设计风格',
        document: '文档',
        presentation: 'PPT',
        spreadsheet: '表格',
        model3d: '3D',
        code: '代码',
        file: '文件'
      })[String(type || '')] || '资产'
    }

    function assetIcon(type = '') {
      const key = String(type || '')
      if (key === 'image') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="9.5" r="1.5"/></svg>'
      if (key === 'video') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="15" height="14" rx="2"/><path d="m18 10 4-2v8l-4-2"/></svg>'
      if (key === 'audio') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
      if (key === 'design_style') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 18 9 5 9-5"/></svg>'
      if (key === 'presentation') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>'
      if (key === 'model3d') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12 4 7.5"/><path d="m12 12 8-4.5"/><path d="M12 12v9"/></svg>'
      if (key === 'favorite') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>'
      if (key === 'recent') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>'
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>'
    }

    function assetActionIcon(action = '') {
      if (action === 'open') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>'
      if (action === 'locate') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"/></svg>'
      if (action === 'copy') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><rect x="2" y="2" width="13" height="13" rx="2"/></svg>'
      if (action === 'favorite') return assetIcon('favorite').replaceAll('18', '15')
      if (action === 'more') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>'
      if (action === 'delete') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>'
      return ''
    }

    function toFileUrl(filePath = '') {
      const raw = String(filePath || '')
      if (!raw) return ''
      if (/^(?:https?:|file:|data:)/i.test(raw)) return raw
      let normalized = raw.replace(/\\/g, '/')
      if (!normalized.startsWith('/')) normalized = '/' + normalized
      return 'file://' + encodeURI(normalized)
    }

    function getAssetExt(filePath = '') {
      const match = String(filePath || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)
      return match ? match[1] : ''
    }

    function isPreviewableImage(item = {}) {
      const ext = getAssetExt(item.path)
      return item.type === 'image' || item.type === 'screenshot' || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'].includes(ext)
    }

    function isPreviewableVideo(item = {}) {
      const ext = getAssetExt(item.path)
      return item.type === 'video' || ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)
    }

    function renderAssetPreview(item = {}) {
      const type = item.type || 'file'
      const filePath = item.path || ''
      const source = toFileUrl(filePath)
      const fallback = `<div class="asset-library-icon asset-type-${escapeHtml(type)}">${assetIcon(type)}</div>`
      if (!source) return `<div class="asset-library-preview">${fallback}</div>`
      if (isPreviewableImage(item)) {
        return `<button class="asset-library-preview" type="button" data-asset-action="open" data-path="${escapeHtml(filePath)}" title="打开预览">
          <img src="${escapeHtml(source)}" alt="${escapeHtml(item.title || '资产缩略图')}" loading="lazy" onerror="this.closest('.asset-library-card')?.remove()">
        </button>`
      }
      if (isPreviewableVideo(item)) {
        return `<button class="asset-library-preview" type="button" data-asset-action="open" data-path="${escapeHtml(filePath)}" title="打开视频">
          <video src="${escapeHtml(source)}" muted playsinline preload="metadata" onerror="this.closest('.asset-library-card')?.remove()"></video>
          <span class="asset-library-video-badge">${assetIcon('video')}</span>
        </button>`
      }
      return `<div class="asset-library-preview">${fallback}</div>`
    }

    function formatAssetTime(value) {
      const time = Date.parse(value || '')
      if (!Number.isFinite(time)) return ''
      const delta = Date.now() - time
      if (delta < 60 * 1000) return '刚刚'
      if (delta < 60 * 60 * 1000) return Math.max(1, Math.round(delta / 60000)) + ' 分钟前'
      if (delta < 24 * 60 * 60 * 1000) return Math.max(1, Math.round(delta / 3600000)) + ' 小时前'
      return new Date(time).toLocaleDateString()
    }

    function formatBytes(size = 0) {
      const value = Number(size || 0)
      if (!Number.isFinite(value) || value <= 0) return ''
      if (value < 1024) return value + ' B'
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
      if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB'
      return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB'
    }

    function renderAssetFilters() {
      const counts = assetItems.reduce((map, item) => {
        const type = item.type || 'file'
        map[type] = (map[type] || 0) + 1
        return map
      }, {})
      const filters = [
        ['all', '全部', assetItems.length],
        ['image', '图片', counts.image || 0],
        ['video', '视频', counts.video || 0],
        ['audio', '音频', counts.audio || 0],
        ['design_style', '设计风格', counts.design_style || 0],
        ['document', '文档', counts.document || 0],
        ['presentation', 'PPT', counts.presentation || 0],
        ['model3d', '3D', counts.model3d || 0]
      ]
      return `<div class="asset-library-filterbar">
        <div class="asset-library-filters">${filters.map(([id, label, count]) => `
          <button class="asset-library-filter ${assetTypeFilter === id ? 'active' : ''}" type="button" data-asset-filter="${id}">
            <span>${label}</span><em>${count}</em>
          </button>
        `).join('')}</div>
      </div>`
    }

    function renderAssetSummary() {
      const counts = assetItems.reduce((map, item) => {
        const type = item.type || 'file'
        map[type] = (map[type] || 0) + 1
        return map
      }, {})
      const recent = assetItems.filter(item => {
        const stamp = Date.parse(item.createdAt || item.updatedAt || '')
        return Number.isFinite(stamp) && Date.now() - stamp < 7 * 86400000
      }).length
      const favorites = assetItems.filter(item => favoriteAssetIds.has(String(item.id)) || item.favorite || item.favorited).length
      const stats = [['总资产', assetItems.length, 'file'], ['图片', counts.image || 0, 'image'], ['视频', counts.video || 0, 'video'], ['音频', counts.audio || 0, 'audio'], ['收藏', favorites, 'favorite'], ['最近新增', recent, 'recent']]
      return `<section class="asset-library-summary" aria-label="资产统计">${stats.map(([label, value, type]) => `<button class="asset-library-stat" type="button" data-asset-filter="${type === 'file' ? 'all' : type}"><span class="asset-library-stat-icon">${assetIcon(type)}</span><span><small>${label}</small><strong>${value.toLocaleString()}</strong></span></button>`).join('')}</section>`
    }
    async function loadAssets() {
      if (!window.api?.listAssetLibrary) {
        assetItems = []
        return
      }
      const result = await window.api.listAssetLibrary({ limit: 300, scan: true })
      assetItems = Array.isArray(result?.assets) ? result.assets : []
    }

    function currentItems() {
      if (activeTab === 'assets') return assetItems
      if (activeTab === 'workflows') return workflowItems
      if (activeTab === 'mcp') return mcpItems
      return []
    }

    function normalizeMcpItems() {
      if (!Array.isArray(mcpItems)) return
      mcpItems = mcpItems.map(item => {
        if (item.kind !== 'mcp-server' || !item.raw) return item
        const server = item.raw
        return {
          ...item,
          category: server.enabled === false ? '已禁用' : server.available ? '已接入' : '不可用',
          chips: [server.type || 'stdio', server.enabled === false ? '禁用' : server.available ? '可用' : '不可用', server.source || 'external'],
          features: [
            server.type === 'http' ? `URL: ${server.url || ''}` : `命令: ${server.command || ''}`,
            `工作目录: ${server.cwd || server.rootPath || ''}`,
            ...(Array.isArray(server.args) ? [`参数: ${server.args.join(' ')}`] : [])
          ]
        }
      })
    }

    function mcpServerItems() {
      return mcpItems.filter(item => item.kind === 'mcp-server' && item.raw)
    }

    function mcpSourceLabel(server = {}) {
      if (server.source === 'built-in') return '官方'
      if (server.source === 'config') return '社区'
      return server.source || '社区'
    }

    function mcpConnectionLabel(server = {}) {
      return server.type === 'http' ? '远程' : '本地'
    }

    function mcpFeatureItems(item) {
      const workflow = mcpItems.find(entry => entry.kind === 'mcp-tool' && entry.raw?.serverId === item.raw?.id)
      const tools = Array.isArray(workflow?.raw?.tools) ? workflow.raw.tools : []
      if (tools.length) return tools.slice(0, 6).map(tool => tool.description || tool.name).filter(Boolean)
      const description = String(item.desc || '').trim()
      return description
        ? description.split(/[，。；;,.]/).map(text => text.trim()).filter(Boolean).slice(0, 6)
        : ['提供 MCP 标准工具', '支持模型上下文调用', '统一管理连接状态']
    }

    function mcpConfigObject(server = {}) {
      if (server.type === 'http') {
        return {
          url: server.url || '',
          headers: server.headers || {},
          bearer_env: server.bearerEnv || ''
        }
      }
      return {
        command: server.command || '',
        args: Array.isArray(server.args) ? server.args : [],
        cwd: server.cwd || server.rootPath || ''
      }
    }

    function mcpStatIcon(type, value) {
      if (type === 'enabled' || type === 'disabled') return `<span class="mcp-center-stat-number">${value}</span>`
      if (type === 'remote') return iconFor({ kind: 'mcp-tool' })
      if (type === 'local') return iconFor({ kind: 'mcp-server' })
      return assetActionIcon('locate')
    }

    function renderMcpDetail(item) {
      if (!item?.raw) return '<aside class="mcp-center-detail"><div class="mcp-center-detail-empty">选择一个 MCP 服务查看详情</div></aside>'
      const server = item.raw
      const enabled = server.enabled !== false
      const features = mcpFeatureItems(item)
      const configText = JSON.stringify(mcpConfigObject(server), null, 2)
      const commandText = server.type === 'http' ? (server.url || '-') : (server.command || '-')
      const argsText = server.type === 'http' ? (server.bearerEnv || '-') : ((server.args || []).join(' ') || '-')
      return `<aside class="mcp-center-detail" data-mcp-detail-id="${escapeHtml(item.id)}">
        <div class="mcp-center-detail-head">
          <span class="mcp-center-detail-icon">${iconFor(item)}</span>
          <div class="mcp-center-detail-title">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.raw.version || 'v1.0.0')} · ${escapeHtml(mcpSourceLabel(server))}</span>
          </div>
          ${server.source === 'config' ? `<button class="mcp-center-switch ${enabled ? 'is-on' : ''}" type="button" data-mcp-card-action="toggle" data-server-id="${escapeHtml(server.id)}" aria-label="${enabled ? '禁用' : '启用'} ${escapeHtml(item.name)}"><i></i></button>` : ''}
          <button class="mcp-center-more" type="button" data-mcp-detail-action="edit" aria-label="编辑配置">•••</button>
        </div>
        <div class="mcp-center-detail-meta">最近更新：刚刚<br>作者：${escapeHtml(mcpSourceLabel(server))}</div>
        <section class="mcp-center-detail-section">
          <h4>描述</h4>
          <p>${escapeHtml(item.desc || '通过 Model Context Protocol 为模型提供外部工具、资源和上下文能力。')}</p>
        </section>
        <section class="mcp-center-detail-section">
          <h4>支持功能</h4>
          <ul>${features.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>
        </section>
        <section class="mcp-center-detail-section">
          <h4 class="mcp-center-config-title"><span>配置</span><em>点击可编辑</em></h4>
          <div class="mcp-center-code"><button type="button" data-mcp-detail-action="copy-config" aria-label="复制配置">${assetActionIcon('copy')}</button><textarea data-mcp-config-editor aria-label="MCP JSON 配置" spellcheck="false">${escapeHtml(configText)}</textarea></div>
        </section>
        <section class="mcp-center-detail-section mcp-center-connection">
          <h4>连接信息</h4>
          <dl><dt>类型</dt><dd>${escapeHtml(server.type || 'stdio')}</dd><dt>${server.type === 'http' ? '地址' : '命令'}</dt><dd title="${escapeHtml(commandText)}">${escapeHtml(commandText)}</dd><dt>参数</dt><dd title="${escapeHtml(argsText)}">${escapeHtml(argsText)}</dd></dl>
        </section>
        <div class="mcp-center-detail-actions">
          <button type="button" data-mcp-detail-action="docs">查看文档 ↗</button>
          <button class="primary" type="button" data-mcp-detail-action="edit">编辑配置</button>
        </div>
      </aside>`
    }

    function renderMcpDashboard(filter = '') {
      const keyword = String(filter || '').trim().toLowerCase()
      const servers = mcpServerItems()
      const counts = {
        all: servers.length,
        enabled: servers.filter(item => item.raw.enabled !== false).length,
        disabled: servers.filter(item => item.raw.enabled === false).length,
        local: servers.filter(item => item.raw.type !== 'http').length,
        remote: servers.filter(item => item.raw.type === 'http').length,
        official: servers.filter(item => item.raw.source === 'built-in').length,
        community: servers.filter(item => item.raw.source !== 'built-in').length
      }
      const stats = [
        ['all', '全部 MCP', counts.all],
        ['enabled', '已启用', counts.enabled],
        ['disabled', '未启用', counts.disabled],
        ['local', '本地 MCP', counts.local],
        ['remote', '远程 MCP', counts.remote]
      ]
      const filtered = servers.filter(item => {
        const server = item.raw
        if (mcpFilter === 'enabled' && server.enabled === false) return false
        if (mcpFilter === 'disabled' && server.enabled !== false) return false
        if (mcpFilter === 'local' && server.type === 'http') return false
        if (mcpFilter === 'remote' && server.type !== 'http') return false
        if (mcpFilter === 'official' && server.source !== 'built-in') return false
        if (mcpFilter === 'community' && server.source === 'built-in') return false
        const haystack = [item.name, item.desc, item.subtitle, server.id, server.type, server.source].join(' ').toLowerCase()
        return !keyword || haystack.includes(keyword)
      }).sort((left, right) => {
        if (mcpSort === 'name') return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
        const stateDelta = Number(right.raw.enabled !== false) - Number(left.raw.enabled !== false)
        return stateDelta || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
      })
      const pageSize = 24
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
      mcpPage = Math.min(mcpPage, totalPages)
      const pageItems = filtered.slice((mcpPage - 1) * pageSize, mcpPage * pageSize)
      const detailItem = servers.find(item => item.id === selectedMcpId) || pageItems[0] || servers[0]
      if (detailItem) selectedMcpId = detailItem.id
      const pageNumbers = Array.from(new Set([1, Math.max(1, mcpPage - 1), mcpPage, Math.min(totalPages, mcpPage + 1), totalPages])).sort((a, b) => a - b)
      const cards = pageItems.length ? pageItems.map(item => {
        const server = item.raw
        const enabled = server.enabled !== false
        const status = enabled ? '已启用' : '未启用'
        return `<article class="mcp-center-card ${item.id === selectedMcpId ? 'is-selected' : ''}" data-mcp-select="${escapeHtml(item.id)}">
          <div class="mcp-center-card-main">
            <span class="mcp-center-card-icon">${iconFor(item)}</span>
            <div class="mcp-center-card-copy"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.desc || '通过 MCP 提供外部工具和上下文能力。')}</p></div>
            <div class="mcp-center-card-state"><span class="mcp-center-status ${enabled ? 'is-enabled' : ''}">${status}</span><button type="button" data-mcp-ui="edit" data-mcp-id="${escapeHtml(item.id)}" aria-label="编辑 ${escapeHtml(item.name)}">•••</button></div>
          </div>
          <div class="mcp-center-card-meta"><span>${escapeHtml(mcpSourceLabel(server))} · ${escapeHtml(server.version || 'v1.0.0')}</span><span>刚刚</span></div>
          <div class="mcp-center-card-footer">
            <span title="MCP 服务">${iconFor({ kind: 'mcp-tool' })}</span>
            <span title="${escapeHtml(mcpConnectionLabel(server))}">${assetActionIcon('locate')}</span>
            <span title="配置">${iconFor({ kind: 'settings' })}</span>
            ${server.source === 'config' ? `<button class="mcp-center-switch ${enabled ? 'is-on' : ''}" type="button" data-mcp-card-action="toggle" data-server-id="${escapeHtml(server.id)}" aria-label="${enabled ? '禁用' : '启用'} ${escapeHtml(item.name)}"><i></i></button>` : '<span class="mcp-center-switch is-on is-locked" title="内置服务"><i></i></span>'}
          </div>
        </article>`
      }).join('') : '<div class="mcp-center-empty">暂无符合条件的 MCP 服务</div>'
      return `<div class="mcp-center-dashboard">
        <section class="mcp-center-summary">${stats.map(([type, label, value]) => `<button type="button" data-mcp-filter="${type}"><span class="mcp-center-stat-icon type-${type}">${mcpStatIcon(type, value)}</span><span><small>${label}</small><strong>${value}</strong></span></button>`).join('')}<button class="mcp-center-add" type="button" data-mcp-ui="add"><span>＋</span> 新增 MCP</button></section>
        <div class="mcp-center-shell">
        <main class="mcp-center-main">
          <div class="mcp-center-toolbar">
            <div class="mcp-center-filters">${[['all', '全部', counts.all], ['enabled', '已启用', counts.enabled], ['disabled', '未启用', counts.disabled], ['local', '本地', counts.local], ['remote', '远程', counts.remote], ['official', '官方', counts.official], ['community', '社区', counts.community]].map(([type, label, value]) => `<button class="${mcpFilter === type ? 'active' : ''}" type="button" data-mcp-filter="${type}">${label}<em>${value}</em></button>`).join('')}</div>
            <div class="mcp-center-view-controls">
              <button class="mcp-center-sort" type="button" data-mcp-ui="sort">${skillCenterActionIcon('sort')}<span>${mcpSort === 'name' ? '名称排序' : '最近更新'}</span>${skillCenterActionIcon('down')}</button>
              <button class="${mcpView === 'grid' ? 'active' : ''}" type="button" data-mcp-view="grid" aria-label="网格视图"><span>▦</span> 网格视图</button>
              <button class="${mcpView === 'list' ? 'active' : ''}" type="button" data-mcp-view="list" aria-label="列表视图"><span>☷</span> 列表视图</button>
            </div>
          </div>
          <section class="mcp-center-grid ${mcpView === 'list' ? 'is-list' : ''}">${cards}</section>
          <nav class="mcp-center-pagination" aria-label="MCP 分页">
            <button type="button" data-mcp-page="${Math.max(1, mcpPage - 1)}" ${mcpPage === 1 ? 'disabled' : ''}>‹</button>
            ${pageNumbers.map((page, index) => `${index > 0 && page - pageNumbers[index - 1] > 1 ? '<span>…</span>' : ''}<button class="${page === mcpPage ? 'active' : ''}" type="button" data-mcp-page="${page}">${page}</button>`).join('')}
            <button type="button" data-mcp-page="${Math.min(totalPages, mcpPage + 1)}" ${mcpPage === totalPages ? 'disabled' : ''}>›</button>
            <span>共 ${totalPages} 页，${filtered.length} 条数据</span><span class="mcp-center-page-size">${pageSize} 条/页</span>
            <label>跳转到 <input inputmode="numeric" value="${mcpPage}" aria-label="跳转页码"> 页</label>
          </nav>
        </main>
        ${renderMcpDetail(detailItem)}
        </div>
      </div>`
    }

    async function refreshCurrentTab() {
      if (activeTab === 'skills') {
        await loadSkillCenter()
        return
      }
      if (activeTab === 'plugins') {
        await loadPluginCenter()
        return
      }
      if (activeTab === 'assets') await loadAssets()
      if (activeTab === 'workflows') await loadWorkflows()
      if (activeTab === 'mcp') await loadMcp()
      if (activeTab === 'mcp') normalizeMcpItems()
      renderList(els.search?.value || '')
    }

    async function loadWorkflows() {
      const projectId = getActiveProjectId() || ''
      if (!window.api?.listAgentWorkflows) {
        workflowItems = []
        return
      }
      const result = await window.api.listAgentWorkflows(projectId)
      workflowItems = (result?.success && Array.isArray(result.items) ? result.items : []).map(item => ({
        id: `workflow:${item.id}`,
        kind: 'workflow',
        name: item.name || '未命名工作流',
        category: item.enabled === false ? '已禁用' : '已启用',
        subtitle: `${Number(item.nodeCount || 0)} 个节点 · ${formatAssetTime(item.updatedAt) || '未保存时间'}`,
        desc: item.description || '自定义 Work 工作流设计。启用后会出现在画布工作流选择中。',
        chips: [item.enabled === false ? '禁用' : '启用', `${Number(item.nodeCount || 0)} 节点`],
        features: [
          `工作流 ID：${item.id}`,
          `状态：${item.enabled === false ? '禁用' : '启用'}`,
          item.updatedAt ? `更新时间：${formatAssetTime(item.updatedAt)}` : '暂无更新时间'
        ],
        raw: item
      }))
    }

    function renderList(filter = '') {
      if (!els.list || ['skills', 'plugins'].includes(activeTab)) return
      if (activeTab === 'mcp') {
        els.list.innerHTML = renderMcpDashboard(filter)
        return
      }
      if (activeTab === 'workflows') {
        const keyword = String(filter || '').trim().toLowerCase()
        const items = workflowItems.filter(item => {
          const haystack = [item.name, item.subtitle, item.desc, item.raw?.id, item.category].join(' ').toLowerCase()
          return !keyword || haystack.includes(keyword)
        })
        if (!items.length) {
          els.list.innerHTML = '<div class="asset-library-empty">暂无工作流。进入画布新增并保存后，会在这里统一管理。</div>'
          return
        }
        els.list.innerHTML = items.map(item => `
          <div class="integration-card" data-id="${escapeHtml(item.id)}">
            <div class="integration-card-top">
              <div class="integration-card-titleline">
                <div class="integration-card-icon">${iconFor(item)}</div>
                <div class="integration-card-titletext">
                  <div class="integration-card-name">${escapeHtml(item.name)}</div>
                  <div class="integration-card-desc">${escapeHtml(item.subtitle)}</div>
                </div>
              </div>
              <div class="integration-card-tag">${escapeHtml(item.category)}</div>
            </div>
            <div class="integration-card-desc">${escapeHtml(item.desc)}</div>
            <div class="integration-card-meta">
              ${(item.chips || []).map(chip => `<span class="integration-chip">${escapeHtml(chip)}</span>`).join('')}
            </div>
            <div class="integration-card-actions">
              <button class="integration-card-action" type="button" data-workflow-card-action="toggle" data-workflow-id="${escapeHtml(item.raw.id)}">${item.raw.enabled === false ? '启用' : '禁用'}</button>
              <button class="integration-card-action danger" type="button" data-workflow-card-action="remove" data-workflow-id="${escapeHtml(item.raw.id)}">删除</button>
            </div>
          </div>
        `).join('')
        return
      }
      if (activeTab === 'assets') {
        const keyword = String(filter || '').trim().toLowerCase()
        const items = assetItems.filter(item => {
          if (assetTypeFilter === 'favorite' && !favoriteAssetIds.has(String(item.id)) && !item.favorite && !item.favorited) return false
          if (assetTypeFilter === 'recent') {
            const stamp = Date.parse(item.createdAt || item.updatedAt || '')
            if (!Number.isFinite(stamp) || Date.now() - stamp >= 7 * 86400000) return false
          }
          if (!['all', 'favorite', 'recent'].includes(assetTypeFilter) && item.type !== assetTypeFilter) return false
          const haystack = [item.title, item.path, item.prompt, item.sourceTool, item.modelName, item.providerModelName, item.type, item.kind].join(' ').toLowerCase()
          return !keyword || haystack.includes(keyword)
        }).sort((left, right) => {
          if (assetSort === 'name-asc') return String(left.title || left.path || '').localeCompare(String(right.title || right.path || ''), 'zh-CN')
          const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0
          const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0
          return assetSort === 'updated-asc' ? leftTime - rightTime : rightTime - leftTime
        })
        const filterHtml = renderAssetFilters()
        const summaryHtml = renderAssetSummary()
        if (!items.length) {
          els.list.innerHTML = summaryHtml + filterHtml + '<div class="asset-library-empty">暂无资产。生成图片、视频、截图、PPT 或研究网站设计后会自动出现在这里。</div>'
          return
        }
        const pageSize = assetPageSize()
        const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
        assetPage = Math.min(assetPage, totalPages)
        const pageItems = items.slice((assetPage - 1) * pageSize, assetPage * pageSize)
        const pageNumbers = Array.from(new Set([1, Math.max(1, assetPage - 1), assetPage, Math.min(totalPages, assetPage + 1), totalPages])).sort((a, b) => a - b)
        const paginationHtml = `<nav class="asset-library-pagination" aria-label="资产分页">
          <button type="button" data-asset-page="${Math.max(1, assetPage - 1)}" ${assetPage === 1 ? 'disabled' : ''} aria-label="上一页">‹</button>
          ${pageNumbers.map((page, index) => `${index > 0 && page - pageNumbers[index - 1] > 1 ? '<span>…</span>' : ''}<button class="${page === assetPage ? 'active' : ''}" type="button" data-asset-page="${page}">${page}</button>`).join('')}
          <button type="button" data-asset-page="${Math.min(totalPages, assetPage + 1)}" ${assetPage === totalPages ? 'disabled' : ''} aria-label="下一页">›</button>
          <span class="asset-library-page-total">共 ${totalPages} 页，${items.length} 条数据</span>
          <span class="asset-library-page-size">${pageSize} 条/页</span>
          <label>跳转到 <input inputmode="numeric" value="${assetPage}" aria-label="跳转页码"> 页</label>
        </nav>`
        els.list.innerHTML = summaryHtml + filterHtml + `<div class="asset-library-grid">${pageItems.map(item => `
            <article class="asset-library-card" data-asset-id="${escapeHtml(item.id)}">
              <button class="asset-library-favorite ${favoriteAssetIds.has(String(item.id)) || item.favorite || item.favorited ? 'is-favorite' : ''}" type="button" data-asset-ui="favorite" aria-label="收藏资产">${assetIcon('favorite')}</button>
              ${renderAssetPreview(item)}
              <div class="asset-library-side">
                <div class="asset-library-actions">
                  <button type="button" data-asset-action="locate" data-path="${escapeHtml(item.path || '')}" title="定位" aria-label="定位">${assetActionIcon('locate')}</button>
                  <button type="button" data-asset-action="copy" data-path="${escapeHtml(item.path || '')}" title="复制路径" aria-label="复制路径">${assetActionIcon('copy')}</button>
                  <button class="${favoriteAssetIds.has(String(item.id)) || item.favorite || item.favorited ? 'is-favorite' : ''}" type="button" data-asset-ui="favorite" title="收藏" aria-label="收藏">${assetActionIcon('favorite')}</button>
                  <button class="danger" type="button" data-asset-action="delete" data-asset-id="${escapeHtml(item.id)}" data-path="${escapeHtml(item.path || '')}" title="删除" aria-label="删除">${assetActionIcon('delete')}</button>
                </div>
              </div>
            </article>
          `).join('')}</div>${paginationHtml}`
        return
      }
      const keyword = String(filter || '').trim().toLowerCase()
      const items = currentItems().filter(item => {
        const haystack = [item.name, item.category, item.subtitle, item.desc, ...(item.chips || [])].join(' ').toLowerCase()
        return !keyword || haystack.includes(keyword)
      })
      if (!items.length) {
        els.list.innerHTML = '<div class="integration-empty">暂无内容</div>'
        return
      }
      els.list.innerHTML = items.map(item => `
        <div class="integration-card" data-id="${escapeHtml(item.id)}">
          <div class="integration-card-top">
            <div class="integration-card-titleline">
              <div class="integration-card-icon">${iconFor(item)}</div>
              <div class="integration-card-titletext">
                <div class="integration-card-name">${escapeHtml(item.name)}</div>
                <div class="integration-card-desc">${escapeHtml(item.subtitle)}</div>
              </div>
            </div>
            <div class="integration-card-tag">${escapeHtml(item.category)}</div>
          </div>
          <div class="integration-card-desc">${escapeHtml(item.desc)}</div>
          <div class="integration-card-meta">
            ${(item.chips || []).map(chip => `<span class="integration-chip">${escapeHtml(chip)}</span>`).join('')}
          </div>
          ${item.kind === 'mcp-server' && item.raw?.source === 'config' ? `
            <div class="integration-card-actions">
              <button class="integration-card-action" type="button" data-mcp-card-action="toggle" data-server-id="${escapeHtml(item.raw.id)}">${item.raw.enabled === false ? '启用' : '禁用'}</button>
              <button class="integration-card-action danger" type="button" data-mcp-card-action="remove" data-server-id="${escapeHtml(item.raw.id)}">删除</button>
            </div>
          ` : ''}
        </div>
      `).join('')
    }

    async function openPanel(tab = 'assets') {
      window.LingxiPanelManager?.openExclusive?.('integration')
      if (els.search) els.search.value = ''
      setActiveTab(tab)
      await refreshCurrentTab()
    }

    function closePanel() {
      closeDetail()
      els.panel?.classList.remove('show')
    }

    function openDetail(item) {
      selected = item
      if (!item || !els.modal) return
      if (els.title) els.title.textContent = item.name
      if (els.subtitle) els.subtitle.textContent = `${item.category} - ${item.subtitle || ''}`
      const isConfigMcp = item.kind === 'mcp-server' && item.raw?.source === 'config'
      const isWorkflow = item.kind === 'workflow'
      const mcpActions = isConfigMcp ? `
          <div class="integration-detail-section">
            <div class="integration-detail-section-title">管理</div>
            <div class="integration-detail-actions">
              <button class="integration-detail-action" type="button" data-mcp-detail-action="toggle" data-server-id="${escapeHtml(item.raw.id)}">${item.raw.enabled === false ? '启用' : '禁用'}</button>
              <button class="integration-detail-action danger" type="button" data-mcp-detail-action="remove" data-server-id="${escapeHtml(item.raw.id)}">删除</button>
            </div>
          </div>
        ` : ''
      const workflowActions = isWorkflow ? `
          <div class="integration-detail-section">
            <div class="integration-detail-section-title">管理</div>
            <div class="integration-detail-actions">
              <button class="integration-detail-action" type="button" data-workflow-detail-action="toggle" data-workflow-id="${escapeHtml(item.raw.id)}">${item.raw.enabled === false ? '启用' : '禁用'}</button>
              <button class="integration-detail-action danger" type="button" data-workflow-detail-action="remove" data-workflow-id="${escapeHtml(item.raw.id)}">删除</button>
            </div>
          </div>
        ` : ''
      if (els.detailBody) {
        els.detailBody.innerHTML = `
          <div class="integration-detail-section">
            <div class="integration-detail-section-title">介绍</div>
            <div>${escapeHtml(item.desc || item.subtitle || '')}</div>
          </div>
          <div class="integration-detail-section">
            <div class="integration-detail-section-title">能力</div>
            <ul class="integration-detail-list">${(item.features || []).map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>
          </div>
          ${mcpActions}
          ${workflowActions}
        `
      }
      if (els.use) {
        els.use.textContent = item.kind === 'workflow' ? '刷新列表' : '刷新'
        els.use.disabled = false
      }
      els.modal.classList.add('show')
    }

    function closeDetail() {
      selected = null
      els.modal?.classList.remove('show')
    }

    async function useSelected() {
      if (!selected) return
      if (selected.kind === 'mcp-server' || selected.kind === 'mcp-tool') {
        await loadMcp()
        renderList(els.search?.value || '')
        window.WorkbenchMention?.refreshMcpMentions?.()
        showToast('MCP 状态已刷新', 'success')
        closeDetail()
      }
      if (selected.kind === 'workflow') {
        await loadWorkflows()
        renderList(els.search?.value || '')
        closeDetail()
      }
    }

    async function handleMcpCardAction(action, serverId) {
      if (!action || !serverId) return
      const item = mcpItems.find(entry => entry.kind === 'mcp-server' && entry.raw?.id === serverId)
      if (!item?.raw || item.raw.source !== 'config') return
      if (action === 'remove') {
        if (!confirm(`删除外部 MCP：${item.name}？`)) return
        const result = await window.api?.removeMcpServer?.({ serverId })
        if (!result?.success) {
          showToast(result?.error || '删除失败', 'error')
          return
        }
        showToast('MCP 已删除', 'success')
      } else if (action === 'toggle') {
        const result = await window.api?.setMcpServerEnabled?.({ serverId, enabled: item.raw.enabled === false })
        if (!result?.success) {
          showToast(result?.error || '状态切换失败', 'error')
          return
        }
        showToast(item.raw.enabled === false ? 'MCP 已启用' : 'MCP 已禁用', 'success')
      }
      await loadMcp()
      normalizeMcpItems()
      renderList(els.search?.value || '')
      window.WorkbenchMention?.refreshMcpMentions?.()
      if (selected?.raw?.id === serverId) closeDetail()
    }

    function openMcpEditor(item) {
      if (!item?.raw) return
      const modal = ensureMcpManager()
      const isConfigured = item.raw.source === 'config'
      if (isConfigured) modal.dataset.editingId = item.raw.id || ''
      else delete modal.dataset.editingId
      const setValue = (field, value = '') => {
        const input = modal.querySelector(`[data-mcp-field="${field}"]`)
        if (input) input.value = value
      }
      const objectLines = value => Object.entries(value || {}).map(([key, entry]) => `${key}=${entry}`).join('\n')
      setValue('name', isConfigured ? (item.raw.name || item.name || '') : `${item.raw.name || item.name || 'MCP'} 自定义`)
      setValue('type', item.raw.type || 'stdio')
      setValue('command', item.raw.command || '')
      setValue('url', item.raw.url || '')
      setValue('args', Array.isArray(item.raw.args) ? item.raw.args.join('\n') : '')
      setValue('env', objectLines(item.raw.env))
      setValue('headers', objectLines(item.raw.headers))
      setValue('headerEnv', objectLines(item.raw.headerEnv))
      setValue('bearerEnv', item.raw.bearerEnv || '')
      setValue('cwd', item.raw.cwd || '')
      setValue('description', item.raw.description || item.desc || '')
      modal.hidden = false
      modal.classList.add('show')
      setMcpStatus(isConfigured ? '' : '内置 MCP 将另存为可编辑的自定义配置', isConfigured ? '' : 'muted')
    }

    function openNewMcpDialog() {
      const modal = ensureMcpManager()
      delete modal.dataset.editingId
      modal.querySelectorAll('[data-mcp-field]').forEach(input => {
        if (input.tagName === 'SELECT') input.value = 'stdio'
        else input.value = ''
      })
      modal.hidden = false
      modal.classList.add('show')
      setMcpStatus('')
    }

    async function handleMcpDashboardAction(action = '') {
      const item = mcpServerItems().find(entry => entry.id === selectedMcpId)
      if (!item?.raw) return
      if (action === 'edit') {
        const editor = els.list?.querySelector('[data-mcp-config-editor]')
        let draftItem = item
        if (editor?.value?.trim()) {
          try {
            const draft = JSON.parse(editor.value)
            const draftRaw = {
              ...item.raw,
              command: draft.command ?? item.raw.command,
              args: Array.isArray(draft.args) ? draft.args : item.raw.args,
              cwd: draft.cwd ?? item.raw.cwd,
              url: draft.url ?? item.raw.url,
              headers: draft.headers && typeof draft.headers === 'object' ? draft.headers : item.raw.headers,
              bearerEnv: draft.bearer_env ?? item.raw.bearerEnv
            }
            draftItem = { ...item, raw: draftRaw }
          } catch (error) {
            editor.focus()
            editor.closest('.mcp-center-code')?.classList.add('has-error')
            showToast(`配置 JSON 格式错误：${error.message}`, 'error')
            return
          }
        }
        openMcpEditor(draftItem)
        return
      }
      if (action === 'copy-config') {
        const editor = els.list?.querySelector('[data-mcp-config-editor]')
        await navigator.clipboard?.writeText?.(editor?.value || JSON.stringify(mcpConfigObject(item.raw), null, 2))
        showToast('MCP 配置已复制', 'success')
        return
      }
      if (action === 'docs') {
        showToast('该 MCP 暂未提供文档链接', 'info')
      }
    }

    async function handleWorkflowCardAction(action, workflowId) {
      if (!action || !workflowId) return
      const item = workflowItems.find(entry => entry.kind === 'workflow' && entry.raw?.id === workflowId)
      if (!item?.raw) return
      const projectId = getActiveProjectId() || ''
      if (action === 'remove') {
        if (!confirm(`删除工作流：${item.name}？`)) return
        const result = await window.api?.deleteAgentWorkflow?.(projectId, workflowId)
        if (!result?.success) {
          showToast(result?.error || '删除失败', 'error')
          return
        }
        showToast('工作流已删除', 'success')
      } else if (action === 'toggle') {
        const result = await window.api?.setAgentWorkflowEnabled?.(projectId, workflowId, item.raw.enabled === false)
        if (!result?.success) {
          showToast(result?.error || '状态切换失败', 'error')
          return
        }
        showToast(item.raw.enabled === false ? '工作流已启用' : '工作流已禁用', 'success')
      }
      await loadWorkflows()
      renderList(els.search?.value || '')
      window.CanvasWorkflows?.refreshList?.(projectId)
      if (selected?.raw?.id === workflowId) closeDetail()
    }

    function findItem(id) {
      return currentItems().find(item => item.id === id)
    }

    let _filePreview
    function getFilePreview() {
      if (!_filePreview) {
        _filePreview = window.FilePreview?.bind({
          api: window.api,
          showToast: (msg, type) => showToast(msg, type),
          createFileTab: () => {},
          getCurrentProjectPath: () => ''
        })
      }
      return _filePreview
    }

    async function handleAssetAction(action = '', filePath = '', assetId = '') {
      try {
        if (action === 'delete') {
          if (!assetId) return
          const assetName = String(filePath || '').split(/[\\/]/).pop() || '该资产'
          const approved = await window.BranchDangerDialog?.show?.({
            targetName: assetName,
            title: '删除资产',
            subtitle: '该文件将移入系统回收站，不会直接永久删除。',
            targetLabel: '目标资产',
            listTitle: '将同步移除',
            tags: ['本地文件', '资源中心记录'],
            note: '如需恢复，可前往 Windows 回收站还原该文件。',
            confirmText: '移入回收站'
          })
          if (!approved) return
          const result = await window.api?.deleteAssetLibraryItem?.(assetId)
          if (!result?.success) throw new Error(result?.error || '删除失败')
          favoriteAssetIds.delete(String(assetId))
          localStorage.setItem('lingxi.assetFavorites', JSON.stringify([...favoriteAssetIds]))
          await loadAssets()
          renderList(els.search?.value || '')
          showToast('资产已移入回收站', 'success')
          return
        }
        if (!filePath) return
        if (action === 'copy') {
          await navigator.clipboard?.writeText?.(filePath)
          showToast('路径已复制', 'success')
          return
        }
        if (action === 'locate') {
          const result = await window.api?.showItemInFolder?.(filePath)
          if (!result?.success) throw new Error(result?.error || '定位失败')
          return
        }
        if (action === 'open') {
          const ext = getAssetExt(filePath)
          if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'].includes(ext)) {
            const fp = getFilePreview()
            if (fp?.openImage) {
              fp.openImage(filePath)
              return
            }
          }
          const result = await window.api?.openProjectFolder?.(filePath)
          if (!result?.success) throw new Error(result?.error || '打开失败')
        }
      } catch (error) {
        if (/No handler registered for ['"]asset-library:delete['"]/i.test(String(error?.message || ''))) {
          showToast('删除服务尚未加载，请完全退出并重新打开应用后再试', 'warning')
          return
        }
        showToast(error.message || '资产操作失败', 'error')
      }
    }

    function patchSidebarEntry() {
      const button = els.button
      if (!button) return
      const label = button.querySelector('span')
      if (label) {
        label.textContent = '资源中心'
        label.removeAttribute('data-i18n')
      }
      const svg = button.querySelector('svg')
      if (svg) {
        svg.outerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="6" height="6" rx="1.4"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.4"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.4"/><path d="M16.5 13.5v6"/><path d="M13.5 16.5h6"/></svg>'
      }
    }

    patchResourceCenterShell()
    ensureSkillMount()
    ensurePluginMount()
    patchSidebarEntry()
    els.back?.addEventListener('click', closePanel)
    els.addMcpButton?.addEventListener('click', () => {
      const modal = ensureMcpManager()
      delete modal.dataset.editingId
      modal.hidden = false
      modal.classList.add('show')
      setMcpStatus('')
    })
    els.search?.addEventListener('input', () => {
      if (activeTab === 'skills') {
        skillPage = 1
        renderSkillCenter()
        return
      }
      if (activeTab === 'plugins') {
        pluginPage = 1
        renderPluginCenter()
        return
      }
      renderList(els.search.value)
    })
    els.tabs?.addEventListener('click', event => {
      const tab = event.target.closest('.integration-tab')?.dataset?.integrationTab
      if (!tab) return
      setActiveTab(tab)
      refreshCurrentTab()
    })
    els.list?.addEventListener('click', event => {
      const mcpFilterButton = event.target.closest('[data-mcp-filter]')
      if (mcpFilterButton) {
        mcpFilter = mcpFilterButton.dataset.mcpFilter || 'all'
        mcpPage = 1
        renderList(els.search?.value || '')
        return
      }
      const mcpPageButton = event.target.closest('[data-mcp-page]')
      if (mcpPageButton && !mcpPageButton.disabled) {
        mcpPage = Math.max(1, Number(mcpPageButton.dataset.mcpPage || 1))
        renderList(els.search?.value || '')
        return
      }
      const mcpViewButton = event.target.closest('[data-mcp-view]')
      if (mcpViewButton) {
        mcpView = mcpViewButton.dataset.mcpView === 'list' ? 'list' : 'grid'
        renderList(els.search?.value || '')
        return
      }
      const mcpUiButton = event.target.closest('[data-mcp-ui]')
      if (mcpUiButton?.dataset.mcpUi === 'add') {
        openNewMcpDialog()
        return
      }
      if (mcpUiButton?.dataset.mcpUi === 'edit') {
        const item = mcpServerItems().find(entry => entry.id === mcpUiButton.dataset.mcpId)
        openMcpEditor(item)
        return
      }
      if (mcpUiButton?.dataset.mcpUi === 'sort') {
        mcpSort = mcpSort === 'name' ? 'enabled-first' : 'name'
        renderList(els.search?.value || '')
        return
      }
      const mcpDetailButton = event.target.closest('[data-mcp-detail-action]')
      if (mcpDetailButton) {
        event.stopPropagation()
        handleMcpDashboardAction(mcpDetailButton.dataset.mcpDetailAction)
        return
      }
      const assetUi = event.target.closest('[data-asset-ui]')
      if (assetUi) {
        event.stopPropagation()
        const card = assetUi.closest('.asset-library-card')
        if (assetUi.dataset.assetUi === 'favorite' && card) {
          const assetId = String(card.dataset.assetId || '')
          if (favoriteAssetIds.has(assetId)) favoriteAssetIds.delete(assetId)
          else favoriteAssetIds.add(assetId)
          localStorage.setItem('lingxi.assetFavorites', JSON.stringify([...favoriteAssetIds]))
          card.querySelectorAll('[data-asset-ui="favorite"]').forEach(button => button.classList.toggle('is-favorite', favoriteAssetIds.has(assetId)))
          renderList(els.search?.value || '')
          return
        }
        return
      }
      const assetFilter = event.target.closest('[data-asset-filter]')
      if (assetFilter) {
        assetTypeFilter = assetFilter.dataset.assetFilter || 'all'
        assetPage = 1
        renderList(els.search?.value || '')
        return
      }
      const pageButton = event.target.closest('[data-asset-page]')
      if (pageButton && !pageButton.disabled) {
        assetPage = Math.max(1, Number(pageButton.dataset.assetPage || 1))
        renderList(els.search?.value || '')
        return
      }
      const assetAction = event.target.closest('[data-asset-action]')
      if (assetAction) {
        event.stopPropagation()
        handleAssetAction(assetAction.dataset.assetAction, assetAction.dataset.path, assetAction.dataset.assetId)
        return
      }
      const actionButton = event.target.closest('[data-mcp-card-action]')
      if (actionButton) {
        event.stopPropagation()
        handleMcpCardAction(actionButton.dataset.mcpCardAction, actionButton.dataset.serverId)
        return
      }
      const mcpCard = event.target.closest('[data-mcp-select]')
      if (mcpCard) {
        selectedMcpId = mcpCard.dataset.mcpSelect || ''
        renderList(els.search?.value || '')
        return
      }
      const workflowActionButton = event.target.closest('[data-workflow-card-action]')
      if (workflowActionButton) {
        event.stopPropagation()
        handleWorkflowCardAction(workflowActionButton.dataset.workflowCardAction, workflowActionButton.dataset.workflowId)
        return
      }
      const card = event.target.closest('.integration-card')
      if (!card) return
      openDetail(findItem(card.dataset.id))
    })
    els.list?.addEventListener('change', event => {
      const input = event.target.closest('.mcp-center-pagination input')
      if (!input) return
      const totalPages = Math.max(1, Math.ceil(mcpServerItems().length / 24))
      mcpPage = Math.min(totalPages, Math.max(1, Number(input.value || 1)))
      renderList(els.search?.value || '')
    })
    els.list?.addEventListener('input', event => {
      const editor = event.target.closest('[data-mcp-config-editor]')
      if (!editor) return
      const code = editor.closest('.mcp-center-code')
      code?.classList.remove('has-error')
      code?.classList.add('is-dirty')
      const title = editor.closest('.mcp-center-detail-section')?.querySelector('.mcp-center-config-title em')
      if (title) title.textContent = '已修改，待应用'
      const applyButton = editor.closest('.mcp-center-detail')?.querySelector('[data-mcp-detail-action="edit"].primary')
      if (applyButton) applyButton.textContent = '应用修改'
    })
    els.close?.addEventListener('click', closeDetail)
    els.cancel?.addEventListener('click', closeDetail)
    els.modal?.addEventListener('click', event => {
      if (event.target === els.modal) closeDetail()
    })
    els.detailBody?.addEventListener('click', event => {
      const actionButton = event.target.closest('[data-mcp-detail-action]')
      if (actionButton) {
        event.stopPropagation()
        handleMcpCardAction(actionButton.dataset.mcpDetailAction, actionButton.dataset.serverId)
        return
      }
      const workflowActionButton = event.target.closest('[data-workflow-detail-action]')
      if (!workflowActionButton) return
      event.stopPropagation()
      handleWorkflowCardAction(workflowActionButton.dataset.workflowDetailAction, workflowActionButton.dataset.workflowId)
    })
    els.use?.addEventListener('click', useSelected)

    window.openIntegrationMarketTab = openPanel
    window.openResourceCenter = openPanel
    setActiveTab('assets')
    return { openPanel, closePanel, renderList, refreshCurrentTab }
  }

  window.IntegrationMarket = { bind }
})()
