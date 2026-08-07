(function () {
  function ensureStyles() {
    if (document.getElementById('deleteProjectDialogStyles')) return

    const style = document.createElement('style')
    style.id = 'deleteProjectDialogStyles'
    style.textContent = `
      .delete-project-dialog { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(6px); animation: fadeIn 0.2s ease; }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      .delete-project-content { width: 380px; background: var(--bg-secondary); border-radius: 16px; border: 1px solid var(--border-subtle); box-shadow: 0 20px 40px rgba(0,0,0,0.3); animation: slideUp 0.3s ease; }
      @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .delete-project-header { display: flex; align-items: center; gap: 12px; padding: 18px 24px; border-bottom: 1px solid var(--border-subtle); }
      .delete-project-icon { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: var(--error-muted); border-radius: 10px; color: var(--error); }
      .delete-project-title { font-size: 18px; color: var(--text-primary); font-weight: 600; flex: 1; }
      .delete-project-close { cursor: pointer; color: var(--text-muted); padding: 6px; border-radius: 6px; display: flex; align-items: center; transition: all 0.2s; }
      .delete-project-close:hover { color: var(--text-secondary); background: var(--bg-hover); }
      .delete-project-body { padding: 24px; }
      .delete-project-warning { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; color: var(--text-secondary); margin-bottom: 20px; }
      .warning-icon { color: var(--warning); }
      .warning-name { color: var(--text-primary); font-weight: 500; }
      .delete-project-options { display: flex; flex-direction: column; gap: 10px; }
      .delete-option { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; transition: all 0.2s; }
      .delete-option:hover { background: var(--bg-hover); border-color: var(--border-default); }
      .delete-option.selected { border-color: var(--accent-primary); background: var(--accent-glow); }
      .delete-option.selected .delete-option-check { opacity: 1; }
      .delete-option.danger:hover { border-color: var(--error); background: var(--error-muted); }
      .delete-option.danger.selected { border-color: var(--error); }
      .delete-option.danger.selected .delete-option-icon { color: var(--error); }
      .delete-option-icon { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); border-radius: 8px; color: var(--text-muted); }
      .delete-option-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
      .delete-option-title { font-size: 14px; color: var(--text-primary); font-weight: 500; }
      .delete-option-desc { font-size: 12px; color: var(--text-muted); }
      .delete-option-check { opacity: 0; color: var(--accent-primary); display: flex; align-items: center; transition: opacity 0.2s; }
      .delete-option.danger.selected .delete-option-check { color: var(--error); }
      .delete-project-footer { display: flex; gap: 12px; padding: 18px 24px; border-top: 1px solid var(--border-subtle); }
      .delete-btn { flex: 1; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
      .delete-btn.cancel { background: var(--bg-tertiary); border: 1px solid var(--border-subtle); color: var(--text-secondary); }
      .delete-btn.cancel:hover { background: var(--bg-hover); border-color: var(--border-default); }
      .delete-btn.confirm { background: var(--error); border: none; color: white; }
      .delete-btn.confirm:hover { filter: brightness(1.1); transform: translateY(-1px); }
    `
    document.head.appendChild(style)
  }

  function show(projectName) {
    ensureStyles()

    return new Promise(resolve => {
      const dialog = document.createElement('div')
      let selectedMode = 'light'

      function finish(result) {
        dialog.remove()
        resolve(result)
      }

      dialog.className = 'delete-project-dialog'
      dialog.innerHTML = `
        <div class="delete-project-content">
          <div class="delete-project-header">
            <div class="delete-project-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </div>
            <span class="delete-project-title">删除项目</span>
            <span class="delete-project-close" data-action="cancel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </span>
          </div>
          <div class="delete-project-body">
            <div class="delete-project-warning">
              <span class="warning-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </span>
              确定要删除项目 "<span class="warning-name">${projectName}</span>"？
            </div>
            <div class="delete-project-options">
              <div class="delete-option" data-mode="light">
                <div class="delete-option-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                </div>
                <div class="delete-option-info">
                  <span class="delete-option-title">保留项目文件</span>
                  <span class="delete-option-desc">仅删除聊天历史，项目文件夹保留</span>
                </div>
                <span class="delete-option-check">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
              </div>
              <div class="delete-option danger" data-mode="full">
                <div class="delete-option-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
                </div>
                <div class="delete-option-info">
                  <span class="delete-option-title">完全删除</span>
                  <span class="delete-option-desc">删除所有数据，无法恢复</span>
                </div>
                <span class="delete-option-check">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
              </div>
            </div>
          </div>
          <div class="delete-project-footer">
            <button class="delete-btn cancel" data-action="cancel">取消</button>
            <button class="delete-btn confirm" data-action="confirm">确认删除</button>
          </div>
        </div>
      `

      document.body.appendChild(dialog)

      dialog.querySelectorAll('.delete-option').forEach(opt => {
        opt.onclick = () => {
          dialog.querySelectorAll('.delete-option').forEach(o => o.classList.remove('selected'))
          opt.classList.add('selected')
          selectedMode = opt.dataset.mode
        }
      })

      dialog.querySelector('.delete-option[data-mode="light"]').classList.add('selected')
      dialog.querySelectorAll('[data-action="cancel"]').forEach(el => {
        el.onclick = () => finish('cancel')
      })
      dialog.querySelector('[data-action="confirm"]').onclick = () => finish(selectedMode)
    })
  }

  window.DeleteProjectDialog = { show }
})()
