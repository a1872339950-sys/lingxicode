(function () {
  const escapeHtml = HtmlUtils.escapeHtml

  function show(options = {}) {
    const targetName = String(options.targetName || options.branchName || '').trim()
    const title = options.title || '删除分支'
    const confirmText = options.confirmText || '确认删除'
    const subtitle = options.subtitle || '这会删除该分支关联的数据，源码分支也会被移除。'
    const targetLabel = options.targetLabel || '目标分支'
    const tags = Array.isArray(options.tags) && options.tags.length
      ? options.tags
      : ['聊天会话', '上下文', '协作记录', '临时 AI 记录', '项目路线数据']
    const note = options.note || '如果这个分支代码还没有合并到主线，删除后将无法继续从该分支找回。'
    const listTitle = options.listTitle || '将一并删除'

    return new Promise(resolve => {
      document.querySelector('.branch-danger-backdrop')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'branch-danger-backdrop'
      backdrop.innerHTML = `
        <div class="branch-danger-dialog" role="dialog" aria-modal="true" aria-labelledby="branchDangerTitle">
          <div class="branch-danger-head">
            <span class="branch-danger-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M3 6h18"/>
                <path d="M8 6V4h8v2"/>
                <path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v5"/>
                <path d="M14 11v5"/>
              </svg>
            </span>
            <div class="branch-danger-title-group">
              <div class="branch-danger-title" id="branchDangerTitle">${escapeHtml(title)}</div>
              <div class="branch-danger-subtitle">${escapeHtml(subtitle)}</div>
            </div>
            <button class="branch-danger-close" type="button" data-action="cancel" title="取消">
              <svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div class="branch-danger-body">
            <div class="branch-danger-branch">
              <span>${escapeHtml(targetLabel)}</span>
              <strong>${escapeHtml(targetName || '-')}</strong>
            </div>
            <div class="branch-danger-list">
              <span>${escapeHtml(listTitle)}</span>
              <div class="branch-danger-tags">
                ${tags.map(tag => `<b>${escapeHtml(tag)}</b>`).join('')}
              </div>
            </div>
            <div class="branch-danger-note">
              ${escapeHtml(note)}
            </div>
          </div>
          <div class="branch-danger-actions">
            <button class="branch-danger-btn" type="button" data-action="cancel">取消</button>
            <button class="branch-danger-btn danger" type="button" data-action="confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `

      const finish = value => {
        backdrop.remove()
        document.removeEventListener('keydown', onKeydown, true)
        // 关闭后把焦点交回页面，避免后续输入框 focus 被系统吞掉
        try {
          const inputEl = document.getElementById('inputBox')
          if (inputEl && !inputEl.disabled && !inputEl.readOnly) {
            requestAnimationFrame(() => {
              try { inputEl.focus({ preventScroll: true }) } catch (_) {
                try { inputEl.focus?.() } catch (_) {}
              }
            })
          } else {
            try { document.body?.focus?.() } catch (_) {}
          }
        } catch (_) {}
        resolve(value)
      }
      const onKeydown = event => {
        if (event.key === 'Escape') finish(false)
        if (event.key === 'Enter') {
          const focused = document.activeElement
          const action = focused?.closest('[data-action]')?.dataset?.action
          if (action === 'cancel') finish(false)
          else finish(true)
        }
      }

      backdrop.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset?.action
        if (event.target === backdrop || action === 'cancel') finish(false)
        if (action === 'confirm') finish(true)
      })
      document.body.appendChild(backdrop)
      requestAnimationFrame(() => {
        backdrop.querySelector('[data-action="confirm"]')?.focus()
      })
      requestAnimationFrame(() => {
        document.addEventListener('keydown', onKeydown, true)
      })
    })
  }

  window.BranchDangerDialog = { show }
})()
