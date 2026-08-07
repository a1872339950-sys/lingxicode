(function () {
  const screens = [
    {
      tab: 'model',
      contentId: 'settingsContentModel',
      group: '模型',
      title: '模型控制台',
      desc: '接入模型、配置代理、标注能力，并把调度、后台整理和本地模型放进同一个控制台。',
      items: [
        ['模型增加', '接入 API、代理、密钥和能力标签', 'model'],
        ['能力调度', '按视觉、图片、音乐、视频选择优先模型', 'routing'],
        ['后台整理模型', '为记忆、路线、账本整理选择轻量模型', 'worker'],
        ['本地模型', '扫描 Ollama 并加入可调用模型列表', 'localModels']
      ]
    },
    {
      tab: 'cloudTokenUsage',
      contentId: 'settingsContentCloudTokenUsage',
      group: '模型',
      title: '用量与账单',
      desc: '用时间、模型和任务维度观察云端 Token 消耗，避免模型配置页变成杂项堆叠。',
      items: []
    },
    {
      tab: 'permission',
      contentId: 'settingsContentPermission',
      group: '安全',
      title: 'AI 授权',
      desc: '把 AI 可访问路径、应用和授权模式放进一张清晰的安全边界图里。',
      items: [
        ['授权模式', '询问、自动审核或完整访问'],
        ['路径边界', '项目外路径按规则确认'],
        ['授权列表', '常用路径和应用白名单']
      ]
    },
    {
      tab: 'browserSettings',
      contentId: 'settingsContentBrowserSettings',
      group: '安全',
      title: '浏览器设置',
      desc: '管理浏览器导入登录的 Cookie，支持清除、查看和追加导入。',
      items: [
        ['追加导入', '只添加新 Cookie，不覆盖已有的'],
        ['覆盖导入', '清除现有 Cookie 后重新导入'],
        ['清除导入', '清除从浏览器导入的所有 Cookie']
      ]
    },
    {
      tab: 'storage',
      contentId: 'settingsContentStorage',
      group: '数据',
      title: '储存路径',
      desc: '统一查看软件数据目录、项目内备忘录、回收区和安全快照保留策略。',
      items: [
        ['数据根目录', 'skills、assets、cache、trash'],
        ['AI 备忘录', '项目发展史记录保存在项目内'],
        ['安全保留', '回收区与恢复点清理策略']
      ]
    },
    {
      tab: 'theme',
      contentId: 'settingsContentTheme',
      group: '体验',
      title: '外观与个性化',
      desc: '管理浅色、深色、主题预设、显示偏好和界面颜色 token。',
      items: [
        ['显示偏好', '历史压缩、消息折叠等界面开关'],
        ['主题预设', '快速切换整体视觉风格'],
        ['颜色 token', '细调聊天、侧栏和状态色']
      ]
    },
    {
      tab: 'other',
      contentId: 'settingsContentOther',
      group: '支持',
      title: '帮助',
      desc: '把模型接入、能力调度和常见排错整理成可快速扫描的支持中心。',
      items: [
        ['文生图', 'OpenAI / 智谱等示例'],
        ['能力调度', '保存模型后进入调度页排序'],
        ['排错线索', 'URL、Key、代理、能力标注']
      ]
    }
  ]

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char])
  }

  function renderHead(config) {
    return `
      <header class="settings-v2-page-head">
        <div class="settings-v2-kicker">${escapeHtml(config.group || '设置')}</div>
        <h2>${escapeHtml(config.title || '')}</h2>
        <p>${escapeHtml(config.desc || '')}</p>
        <div class="settings-v2-quick-nav">
          ${(config.items || []).map(([title, desc, modelSubtab]) => `
            <button class="settings-v2-quick-chip" type="button" ${modelSubtab ? `data-settings-model-subtab="${escapeHtml(modelSubtab)}"` : ''} title="${escapeHtml(desc || '')}">
              <span>${escapeHtml(title || '')}</span>
            </button>
          `).join('')}
        </div>
      </header>
    `
  }

  function enhanceControls(root) {
    if (!root || root.dataset.v2ControlsReady === 'true') return
    root.querySelectorAll('.settings-section').forEach(section => {
      section.classList.add('settings-v2-panel')
    })
    root.querySelectorAll('.settings-group').forEach(group => {
      if (group.dataset.v2RowReady === 'true') return
      const children = Array.from(group.childNodes)
      const meta = document.createElement('div')
      meta.className = 'settings-v2-row-meta'
      const control = document.createElement('div')
      control.className = 'settings-v2-row-control'
      children.forEach(node => {
        const isMetaNode = node.nodeType === 1 && (
          node.classList.contains('settings-label') ||
          node.classList.contains('settings-hint')
        )
        ;(isMetaNode ? meta : control).appendChild(node)
      })
      if (!meta.childNodes.length) {
        const spacer = document.createElement('div')
        spacer.className = 'settings-v2-row-title'
        spacer.textContent = ''
        meta.appendChild(spacer)
      }
      group.textContent = ''
      group.classList.add('settings-v2-row')
      group.appendChild(meta)
      group.appendChild(control)
      group.dataset.v2RowReady = 'true'
    })

    const addModelButton = root.querySelector('#settingsAddModelBtn')
    if (addModelButton && addModelButton.dataset.v2ActionReady !== 'true') {
      const footer = document.createElement('div')
      footer.className = 'settings-v2-action-row'
      addModelButton.parentNode.insertBefore(footer, addModelButton)
      footer.appendChild(addModelButton)
      addModelButton.classList.add('primary')
      addModelButton.dataset.v2ActionReady = 'true'
    }

    root.querySelectorAll('.settings-capability-grid, .model-capability-grid').forEach(grid => {
      grid.classList.add('settings-v2-switch-grid')
    })
    root.dataset.v2ControlsReady = 'true'
  }

  function ensureNav() {
    const tabsContainer = document.querySelector('.settings-main-tabs')
    if (!tabsContainer || tabsContainer.dataset.v2Grouped === 'true') return
    const groups = [
      { label: '模型', tabs: ['model', 'cloudTokenUsage'] },

      { label: '安全与数据', tabs: ['permission', 'browserSettings', 'storage'] },
      { label: '体验支持', tabs: ['theme', 'other'] }
    ]

    const tabByName = name => tabsContainer.querySelector(`[data-tab="${name}"]`)
    const fragment = document.createDocumentFragment()
    groups.forEach(group => {
      const groupEl = document.createElement('div')
      groupEl.className = 'settings-v2-nav-group'
      const label = document.createElement('div')
      label.className = 'settings-v2-nav-group-label'
      label.textContent = group.label
      const list = document.createElement('div')
      list.className = 'settings-v2-nav-group-list'
      group.tabs.forEach(tab => {
        const tabEl = tabByName(tab)
        if (!tabEl) return
        tabEl.classList.add('settings-v2-tab')
        tabEl.dataset.navGroup = group.label
        list.appendChild(tabEl)
      })
      if (!list.children.length) return
      groupEl.appendChild(label)
      groupEl.appendChild(list)
      fragment.appendChild(groupEl)
    })
    tabsContainer.textContent = ''
    tabsContainer.appendChild(fragment)
    tabsContainer.dataset.v2Grouped = 'true'
  }

  function ensure(options = {}) {
    const {
      panel = document.getElementById('settingsMainPanel'),
      onModelScreen,
      onModelSubtab
    } = options
    // 不再切换 settings-v2 class，统一使用一套样式
    // DOM 增强（导航分组、page-head、settings-v2-row 拆列）仍保留
    ensureNav()
    screens.forEach(config => {
      const content = document.getElementById(config.contentId)
      if (!content || content.dataset.v2Ready === 'true') return
      const existingNodes = Array.from(content.childNodes)
      const screen = document.createElement('div')
      screen.className = `settings-v2-screen settings-v2-screen-${config.tab}`
      screen.dataset.settingsV2Screen = config.tab
      screen.innerHTML = `${renderHead(config)}<main class="settings-v2-workbench"></main>`
      const workbench = screen.querySelector('.settings-v2-workbench')
      existingNodes.forEach(node => workbench.appendChild(node))
      content.appendChild(screen)
      enhanceControls(screen)
      if (config.tab === 'model') onModelScreen?.(screen)
      screen.querySelectorAll('[data-settings-model-subtab]').forEach(button => {
        button.addEventListener('click', () => {
          onModelSubtab?.(button.dataset.settingsModelSubtab || 'model')
        })
      })
      content.dataset.v2Ready = 'true'
    })
  }

  window.SettingsV2Shell = {
    enhanceControls,
    ensure,
    ensureNav,
    renderHead,
    screens
  }
})()
