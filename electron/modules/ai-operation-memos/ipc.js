const memos = require('./index')

function registerIPC(ipcMain) {
  ipcMain.handle('ai-operation-memo:get-settings', async () => {
    try {
      return { success: true, data: memos.getSettings() }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ai-operation-memo:save-settings', async (event, config = {}) => {
    try {
      return memos.saveSettings(config)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ai-operation-memo:save-draft', async (event, projectPath = '', memoId = '') => {
    try {
      return memos.saveDraft(projectPath, memoId)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ai-operation-memo:delete-draft', async (event, projectPath = '', memoId = '') => {
    try {
      return memos.deleteDraft(projectPath, memoId)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ai-operation-memo:list-timeline', async (event, projectPath = '') => {
    try {
      return memos.listTimeline(projectPath)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ai-operation-memo:read', async (event, projectPath = '', memoId = '') => {
    try {
      return memos.readMemo(projectPath, memoId)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  registerIPC
}
