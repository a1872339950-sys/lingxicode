/**
 * 格式化工具函数集
 * 提供字节、日期、时间等通用格式化函数
 */
window.FormatUtils = {
  /**
   * 格式化字节数
   * @param {number} bytes - 字节数
   * @returns {string}
   */
  formatBytes(bytes = 0) {
    const size = Number(bytes || 0)
    if (!Number.isFinite(size) || size <= 0) return ''
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let next = size
    let unit = 0
    while (next >= 1024 && unit < units.length - 1) {
      next /= 1024
      unit += 1
    }
    return `${next.toFixed(unit >= 2 ? 1 : 0)} ${units[unit]}`
  },

  /**
   * 格式化日期时间（zh-CN locale）
   * @param {*} value - 日期值（Date对象或可解析字符串）
   * @returns {string}
   */
  formatDate(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString('zh-CN', { hour12: false })
  },

  /**
   * 格式化短日期时间（月/日 时:分）
   * @param {*} value - 日期值
   * @returns {string}
   */
  formatDateTime(value = '') {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  },

  /**
   * 格式化经过时间（入参为秒）
   * @param {number} totalSeconds - 经过的秒数
   * @returns {string}
   */
  formatElapsedSeconds(totalSeconds) {
    const total = Math.max(0, Math.floor(Number(totalSeconds) || 0))
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    if (minutes < 60) {
      return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
    }
    const hours = Math.floor(minutes / 60)
    const restMinutes = minutes % 60
    return `${hours}小时${restMinutes ? `${restMinutes}分` : ''}`
  },

  /**
   * 格式化经过时间（入参为毫秒）
   * @param {number} ms - 经过的毫秒数
   * @returns {string}
   */
  formatElapsedMs(ms) {
    if (ms < 0) ms = 0
    if (ms < 1000) return `${ms}ms`
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(1)}秒`
    const seconds = Math.floor(s)
    const minutes = Math.floor(seconds / 60)
    const restSeconds = seconds % 60
    if (minutes < 60) return restSeconds ? `${minutes}分${restSeconds}秒` : `${minutes}分`
    const hours = Math.floor(minutes / 60)
    const restMinutes = minutes % 60
    return `${hours}小时${restMinutes ? `${restMinutes}分` : ''}`
  }
}
