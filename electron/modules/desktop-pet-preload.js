/**
 * 桌宠悬浮窗 preload：自定义拖拽与主进程通信
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lingxiPet', {
  drag: (payload) => {
    try {
      ipcRenderer.send('desktop-pet:drag', payload || {})
    } catch (_) { /* ignore */ }
  },
  onExternalAction: (handler) => {
    if (typeof handler !== 'function') return () => {}
    const listener = (_event, data) => {
      try { handler(data) } catch (_) { /* ignore */ }
    }
    ipcRenderer.on('desktop-pet:external-action', listener)
    return () => {
      try { ipcRenderer.removeListener('desktop-pet:external-action', listener) } catch (_) { /* ignore */ }
    }
  }
})
