/**
 * Browser file helpers shared by upload and preview features.
 */
(function() {
  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => resolve(event.target.result)
      reader.onerror = () => reject(new Error(((window.i18n?.t?.('auto.js_file_utils_9_1') ?? '读取失败'))))
      reader.readAsText(file)
    })
  }

  function readFileAsBase64(file, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      const timer = setTimeout(() => {
        try { reader.abort() } catch (e) {}
        reject(new Error(`读取超时（${Math.round(timeoutMs / 1000)}秒）`))
      }, timeoutMs)
      reader.onload = (event) => {
        clearTimeout(timer)
        const base64 = event.target.result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = () => {
        clearTimeout(timer)
        reject(new Error(((window.i18n?.t?.('auto.js_file_utils_28_2') ?? '读取失败'))))
      }
      reader.onabort = () => {
        clearTimeout(timer)
        reject(new Error(((window.i18n?.t?.('auto.js_file_utils_32_3') ?? '读取已中止'))))
      }
      reader.readAsDataURL(file)
    })
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  window.FileUtils = {
    readTextFile,
    readFileAsBase64,
    formatFileSize
  }
})()
