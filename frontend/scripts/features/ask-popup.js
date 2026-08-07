(function () {
  const escapeHtml = HtmlUtils.escapeHtml

  function optionCardHtml({ index, label, value, desc = '', recommended = false, custom = false, extra = '', previewHtml = '', design = false }) {
    const attrs = custom
      ? 'data-ask-custom="true"'
      : `data-ask-label="${escapeHtml(label)}" data-ask-value="${escapeHtml(value)}"`

    // 自定义：选项本身就是输入框，不再点击后在下方另弹一层
    if (custom) {
      const placeholder = desc || label || ((window.i18n?.t?.('auto.js_ask_popup_114_28') ?? '输入更具体的处理方式'))
      return `
        <div class="ask-option-item is-custom" ${attrs}>
          <span class="ask-option-key">${index}</span>
          <span class="ask-option-main ask-option-custom-main">
            <span class="ask-option-custom-row">
              <input
                type="text"
                class="ask-option-custom-input"
                placeholder="${escapeHtml(placeholder)}"
                aria-label="${escapeHtml(label || '自定义')}"
                autocomplete="off"
              />
              <button type="button" class="ask-option-custom-submit">${escapeHtml((window.i18n?.t?.('auto.l701') ?? '提交'))}</button>
            </span>
          </span>
        </div>
      `
    }

    if (design) {
      return `
        <div class="ask-option-item ask-design-card ${recommended ? 'recommended' : ''}" ${attrs}>
          <div class="ask-design-preview" data-preview-slot="1"></div>
          <div class="ask-design-meta">
            <span class="ask-option-key">${index}</span>
            <span class="ask-option-main">
              <span class="ask-option-title-row">
                <span class="ask-option-title">${escapeHtml(label)}</span>
                ${recommended ? '<span class="ask-option-badge">推荐</span>' : ''}
              </span>
              ${desc ? `<span class="ask-option-desc">${escapeHtml(desc)}</span>` : ''}
            </span>
          </div>
          ${extra || ''}
        </div>
      `
    }

    return `
      <div class="ask-option-item ${recommended ? 'recommended' : ''}" ${attrs}>
        <span class="ask-option-key">${index}</span>
        <span class="ask-option-main">
          <span class="ask-option-title-row">
            <span class="ask-option-title">${escapeHtml(label)}</span>
            ${recommended ? ((window.i18n?.t?.('auto.js_ask_popup_18_1') ?? '<span class="ask-option-badge">推荐</span>')) : ''}
          </span>
          ${desc ? `<span class="ask-option-desc">${escapeHtml(desc)}</span>` : ''}
        </span>
        ${extra || ''}
      </div>
    `
  }

  function modeLabel(mode) {
    if (mode === 'full') return ((window.i18n?.t?.('auto.l1089') ?? '完整授权'))
    return ((window.i18n?.t?.('auto.l1084') ?? '询问授权'))
  }

  function toolLabel(name) {
    const labels = {
      read_file: ((window.i18n?.t?.('auto.js_ask_popup_35_5') ?? '读取文件')),
      write_file: ((window.i18n?.t?.('auto.js_ask_popup_36_6') ?? '写入文件')),
      edit_file: ((window.i18n?.t?.('auto.js_ask_popup_37_7') ?? '编辑文件')),
      delete_file: ((window.i18n?.t?.('auto.js_ask_popup_38_8') ?? '删除文件')),
      create_directory: ((window.i18n?.t?.('auto.js_ask_popup_39_9') ?? '创建文件夹')),
      list_files: ((window.i18n?.t?.('auto.js_ask_popup_40_10') ?? '查看文件列表')),
      discover_code: '发现代码',
      search_project: '搜索项目',
      grep_code: '搜索代码',
      render_svg_asset: ((window.i18n?.t?.('auto.js_ask_popup_41_11') ?? '生成图片资源')),
      capture_screenshot: ((window.i18n?.t?.('auto.js_ask_popup_42_12') ?? '网页截图')),
      inspect_image: ((window.i18n?.t?.('auto.js_ask_popup_43_13') ?? '查看图片')),
      run_command: ((window.i18n?.t?.('auto.js_ask_popup_44_14') ?? '执行短命令')),
      terminal_run: ((window.i18n?.t?.('auto.js_ask_popup_45_15') ?? '运行终端命令')),
      find_software: ((window.i18n?.t?.('auto.js_ask_popup_46_16') ?? '查找本地软件')),
      open_software: ((window.i18n?.t?.('auto.js_ask_popup_47_17') ?? '打开本地软件')),
      blender_status: ((window.i18n?.t?.('auto.js_ask_popup_48_18') ?? '检查 Blender')),
      blender_open: ((window.i18n?.t?.('auto.js_ask_popup_49_19') ?? '打开 Blender')),
      blender_run_script: ((window.i18n?.t?.('auto.js_ask_popup_50_20') ?? '运行 Blender 脚本')),
      blender_create_demo_model: ((window.i18n?.t?.('auto.js_ask_popup_51_21') ?? '创建 Blender 模型')),
      blender_modify_scene: ((window.i18n?.t?.('auto.js_ask_popup_52_22') ?? '修改 Blender 场景')),
      blender_import_asset: ((window.i18n?.t?.('auto.js_ask_popup_53_23') ?? '导入 Blender 素材')),
      blender_inspect_scene: ((window.i18n?.t?.('auto.js_ask_popup_54_24') ?? '检查 Blender 场景'))
    }
    return labels[name] || name || ((window.i18n?.t?.('auto.js_ask_popup_56_25') ?? '工具操作'))
  }

  function reset(elements) {
    elements.popup.classList.remove('show')
    elements.popup.classList.remove('is-design-layout')
    elements.options?.classList?.remove('ask-options-design')
    // 兼容旧底部输入区：始终隐藏，不再使用
    if (elements.customInputBox) {
      elements.customInputBox.classList.remove('show')
      elements.customInputBox.hidden = true
    }
    if (elements.customInput) elements.customInput.value = ''
  }

  function selectFirstOption(elements) {
    const firstOption = elements.options.querySelector('[data-ask-value]')
    if (firstOption) firstOption.click()
  }

  function bindCustomOption(item, onCustomSubmit) {
    const input = item.querySelector('.ask-option-custom-input')
    const submitBtn = item.querySelector('.ask-option-custom-submit')
    if (!input) return

    const submit = () => {
      const value = String(input.value || '').trim()
      if (!value) {
        input.focus()
        item.classList.add('is-empty')
        window.setTimeout(() => item.classList.remove('is-empty'), 500)
        return
      }
      onCustomSubmit?.(value)
    }

    // 点击整行时聚焦输入，不要再弹出底部输入框
    item.onclick = event => {
      if (event.target === submitBtn || submitBtn?.contains(event.target)) return
      input.focus()
    }

    input.onclick = event => event.stopPropagation()
    input.onkeydown = event => {
      event.stopPropagation()
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    }

    if (submitBtn) {
      submitBtn.onclick = event => {
        event.preventDefault()
        event.stopPropagation()
        submit()
      }
    }
  }

  function bindOptionClicks(elements, onSelect, onCustomSubmit) {
    // 始终隐藏旧的底部自定义输入区
    if (elements.customInputBox) {
      elements.customInputBox.classList.remove('show')
      elements.customInputBox.hidden = true
    }

    elements.options.querySelectorAll('[data-ask-value]').forEach(item => {
      item.onclick = () => onSelect(item.dataset.askLabel, item.dataset.askValue)
    })
    elements.options.querySelectorAll('[data-ask-custom]').forEach(item => {
      bindCustomOption(item, onCustomSubmit)
    })
    const modeItem = elements.options.querySelector('[data-ask-mode-select]')
    const modeSelect = elements.options.querySelector('#askModeSelect')
    if (modeSelect) {
      modeSelect.onclick = event => event.stopPropagation()
      modeSelect.onkeydown = event => event.stopPropagation()
    }
    if (modeItem && modeSelect) {
      modeItem.onclick = () => {
        const newMode = modeSelect.value
        onSelect(((window.i18n?.t?.('auto.js_ask_popup_86_26') ?? '执行并切换为')) + modeLabel(newMode), 'approved_with_mode:' + newMode)
      }
    }
  }

  function showPlan(elements, question, options, recommended, handlers, meta = {}) {
    reset(elements)
    setTimeout(() => {
      const normalizedOptions = (Array.isArray(options) ? options : []).map(option => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) return null
        const label = String(option.label ?? '').trim()
        const value = String(option.value ?? '').trim()
        const desc = String(option.desc ?? option.description ?? '').trim()
        const isGeneric = value => /^(?:选项|方案)\s*[#：:]?\s*\d+$|^choice[_-]?\d+$/i.test(String(value || '').trim())
        if (!label || isGeneric(label) || !value || desc.length < 6) return null
        return {
          ...option,
          label,
          value,
          desc
        }
      }).filter(Boolean)
      const layout = String(meta.layout || '').toLowerCase()
      const isDesign = layout === 'design' || normalizedOptions.some(opt =>
        opt?.presentation === 'design' || opt?.preview_html || opt?.previewHtml
      )

      elements.content.innerHTML = `
        <div class="ask-title-row">
          <span class="ask-title-mark"></span>
          <span class="ask-title-text">${isDesign ? '请选择一个视觉方向' : '需要你选择一个方向'}</span>
        </div>
        <div class="ask-question">${escapeHtml(question)}</div>
      `

      let html = ''
      const displayOptions = normalizedOptions.slice(0, 3)
      if (isDesign) {
        elements.options.classList.add('ask-options-design')
      } else {
        elements.options.classList.remove('ask-options-design')
      }
      displayOptions.forEach((opt, i) => {
        const isRecommended = recommended === opt.value || recommended === opt.label
        html += optionCardHtml({
          index: i + 1,
          label: opt.label,
          value: opt.value,
          desc: opt.desc,
          recommended: isRecommended,
          design: isDesign,
          previewHtml: opt.preview_html || opt.previewHtml || ''
        })
      })
      html += optionCardHtml({ index: displayOptions.length + 1, label: ((window.i18n?.t?.('auto.js_ask_popup_114_27') ?? '自定义')), custom: true, desc: ((window.i18n?.t?.('auto.js_ask_popup_114_28') ?? '输入更具体的处理方式')) })

      elements.options.innerHTML = html

      // 设计预览：用 DOM 属性写入 srcdoc，避免 HTML 属性转义炸掉
      if (isDesign) {
        const cards = elements.options.querySelectorAll('.ask-design-card')
        cards.forEach((card, i) => {
          const opt = displayOptions[i]
          const slot = card.querySelector('[data-preview-slot]')
          if (!slot) return
          const preview = opt?.preview_html || opt?.previewHtml || ''
          if (!preview) {
            slot.innerHTML = '<div class="ask-design-empty">暂无预览</div>'
            return
          }
          const iframe = document.createElement('iframe')
          iframe.className = 'ask-design-frame'
          iframe.setAttribute('sandbox', 'allow-scripts')
          iframe.setAttribute('referrerpolicy', 'no-referrer')
          iframe.title = opt.label || `方案 ${i + 1}`
          iframe.srcdoc = preview
          slot.innerHTML = ''
          slot.appendChild(iframe)
        })
      }

      bindOptionClicks(elements, handlers.onSelect, handlers.onCustom)
      elements.popup.classList.add('show')
      if (isDesign) elements.popup.classList.add('is-design-layout')
      else elements.popup.classList.remove('is-design-layout')
    }, 50)
  }

  function showExec(elements, step, isCritical, handlers) {
    reset(elements)
    setTimeout(() => {
      elements.content.innerHTML = `
        <div class="ask-title-row">
          <span class="ask-title-mark ${isCritical ? 'critical' : ''}"></span>
          <span class="ask-title-text">${isCritical ? ((window.i18n?.t?.('auto.js_ask_popup_128_29') ?? '关键步骤确认')) : ((window.i18n?.t?.('auto.js_ask_popup_128_30') ?? '执行前确认'))}</span>
        </div>
        <div class="ask-question">${escapeHtml(step)}</div>
      `
      elements.options.innerHTML = `
        ${optionCardHtml({ index: 1, label: ((window.i18n?.t?.('auto.js_ask_popup_133_31') ?? '执行')), value: 'approved', recommended: true })}
        <div class="ask-option-item" data-ask-mode-select="true">
          <span class="ask-option-key">2</span>
          <span class="ask-option-main">
            <span class="ask-option-title-row">
              <span class="ask-option-title">执行并切换模式</span>
            </span>
            <span class="ask-option-desc">本次同意，并调整后续询问频率</span>
          </span>
          <select id="askModeSelect" class="ask-mode-select">
            <option value="ask">询问授权</option>
            <option value="full">完整授权</option>
          </select>
        </div>
        ${optionCardHtml({ index: 3, label: ((window.i18n?.t?.('auto.js_ask_popup_148_32') ?? '暂停')), value: 'rejected', desc: ((window.i18n?.t?.('auto.js_ask_popup_148_33') ?? '停止当前步骤，等待后续指令')) })}
        ${optionCardHtml({ index: 4, label: ((window.i18n?.t?.('auto.js_ask_popup_149_34') ?? '自定义')), custom: true, desc: ((window.i18n?.t?.('auto.js_ask_popup_149_35') ?? '输入你的具体要求')) })}
      `

      bindOptionClicks(elements, handlers.onSelect, handlers.onCustom)
      elements.popup.classList.add('show')
    }, 50)
  }

  function showPlanConfirm(elements, plan, handlers) {
    elements.customInputBox.classList.remove('show')
    elements.customInput.value = ''

    let stepsHtml = `
      <div class="ask-title-row">
        <span class="ask-title-mark"></span>
        <span class="ask-title-text">执行计划确认</span>
      </div>
    `
    if (plan && plan.length > 0) {
      stepsHtml += `
        <div class="ask-plan-preview">
          ${plan.map((s, i) => `
            <div class="ask-plan-step">
              <span class="ask-plan-step-index">${i + 1}</span>
              <span class="ask-plan-step-text">${escapeHtml(s)}</span>
            </div>
          `).join('')}
        </div>
      `
    }
    elements.content.innerHTML = stepsHtml
    elements.options.innerHTML = `
      ${optionCardHtml({ index: 1, label: ((window.i18n?.t?.('auto.js_ask_popup_181_36') ?? '确认执行')), value: 'confirmed', recommended: true })}
      ${optionCardHtml({ index: 2, label: ((window.i18n?.t?.('auto.js_ask_popup_182_37') ?? '暂不执行')), value: 'not_now', desc: ((window.i18n?.t?.('auto.js_ask_popup_182_38') ?? '保留计划，先不进入执行')) })}
      ${optionCardHtml({ index: 3, label: ((window.i18n?.t?.('auto.js_ask_popup_183_39') ?? '自定义')), custom: true, desc: ((window.i18n?.t?.('auto.js_ask_popup_183_40') ?? '补充或调整计划')) })}
    `
    bindOptionClicks(elements, handlers.onSelect, handlers.onCustom)
    elements.popup.classList.add('show')
  }

  function showPathPermission(elements, data, handlers) {
    reset(elements)
    const targetPath = data?.path || ''
    const projectPath = data?.projectPath || ''
    const operation = data?.operation || data?.toolName || 'tool'
    elements.content.innerHTML = `
      <div class="ask-title-row">
        <span class="ask-title-mark critical"></span>
        <span class="ask-title-text">项目外路径授权</span>
      </div>
      <div class="ask-question">AI 需要访问项目外的位置。</div>
      <div class="ask-plan-preview ask-permission-detail">
        <div class="ask-plan-step">
          <span class="ask-plan-step-index">项目路径</span>
          <span class="ask-plan-step-text">${escapeHtml(projectPath || ((window.i18n?.t?.('auto.js_ask_popup_203_41') ?? '未识别项目路径')))}</span>
        </div>
        <div class="ask-plan-step">
          <span class="ask-plan-step-index">访问路径</span>
          <span class="ask-plan-step-text">${escapeHtml(targetPath)}</span>
        </div>
        <div class="ask-plan-step">
          <span class="ask-plan-step-index">操作类型</span>
          <span class="ask-plan-step-text">${escapeHtml(toolLabel(operation))}</span>
        </div>
      </div>
    `
    elements.options.innerHTML = `
      ${optionCardHtml({ index: 1, label: ((window.i18n?.t?.('auto.js_ask_popup_216_42') ?? '允许本次操作')), value: 'allow_once', recommended: true, desc: ((window.i18n?.t?.('auto.js_ask_popup_216_43') ?? '只允许这一次，后续同类操作还会再次询问。')) })}
      ${optionCardHtml({ index: 2, label: ((window.i18n?.t?.('auto.js_ask_popup_217_44') ?? '后续都允许本次操作')), value: 'allow_always', desc: ((window.i18n?.t?.('auto.js_ask_popup_217_45') ?? '记住这个操作和路径，后续不再弹窗。')) })}
      ${optionCardHtml({ index: 3, label: ((window.i18n?.t?.('auto.js_ask_popup_218_46') ?? '不允许')), value: 'rejected', desc: ((window.i18n?.t?.('auto.js_ask_popup_218_47') ?? '拒绝本次项目外访问。')) })}
    `
    bindOptionClicks(elements, handlers.onSelect, handlers.onCustom)
    elements.popup.classList.add('show')
  }

  function showCustomInput(elements) {
    // 兼容旧调用：聚焦行内自定义输入，不再显示底部多余输入框
    if (elements.customInputBox) {
      elements.customInputBox.classList.remove('show')
      elements.customInputBox.hidden = true
    }
    const inline = elements.options?.querySelector?.('.ask-option-custom-input')
    if (inline) {
      inline.focus()
      return
    }
    if (elements.customInput) elements.customInput.focus()
  }

  function hide(elements) {
    elements.popup.classList.remove('show')
    if (elements.customInputBox) {
      elements.customInputBox.classList.remove('show')
      elements.customInputBox.hidden = true
    }
    if (elements.customInput) elements.customInput.value = ''
  }

  function bindKeyboard(elements) {
    if (window.__askPopupKeyboardBound) return
    window.__askPopupKeyboardBound = true

    document.addEventListener('keydown', event => {
      if (!elements.popup?.classList.contains('show')) return

      const target = event.target
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return

      if (event.key === 'Escape') {
        event.preventDefault()
        hide()
        return
      }

      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      selectFirstOption(elements)
    })
  }

  window.AskPopup = {
    modeLabel,
    showPlan,
    showExec,
    showPlanConfirm,
    showPathPermission,
    showCustomInput,
    hide,
    bindKeyboard
  }
})()
