(function () {
  'use strict'

  const MAX_RENDER_CHARS = 2 * 1024 * 1024
  const MAX_RENDER_LINES = 10000
  const MAX_LCS_CELLS = 1200000
  const MAX_CHANGED_LINES_PER_SIDE = 800

  function inspect(beforeText = '', afterText = '') {
    const before = String(beforeText || '')
    const after = String(afterText || '')
    if (before.length + after.length > MAX_RENDER_CHARS) {
      return { renderable: false, reason: '文件内容过大，仅显示变更统计' }
    }
    const oldLines = before.split('\n')
    const newLines = after.split('\n')
    if (oldLines.length > MAX_RENDER_LINES || newLines.length > MAX_RENDER_LINES) {
      return { renderable: false, reason: '文件行数过多，仅显示变更统计' }
    }
    return { renderable: true, oldLines, newLines }
  }

  function clipChangedLines(lines, type, startLine) {
    if (lines.length <= MAX_CHANGED_LINES_PER_SIDE) {
      return lines.map((text, index) => ({ type, text, [type === 'remove' ? 'oldLine' : 'newLine']: startLine + index }))
    }
    const side = Math.floor(MAX_CHANGED_LINES_PER_SIDE / 2)
    const head = lines.slice(0, side).map((text, index) => ({ type, text, [type === 'remove' ? 'oldLine' : 'newLine']: startLine + index }))
    const tailStart = lines.length - side
    const tail = lines.slice(tailStart).map((text, index) => ({
      type,
      text,
      [type === 'remove' ? 'oldLine' : 'newLine']: startLine + tailStart + index
    }))
    return [...head, { type, text: `... 省略 ${lines.length - side * 2} 行 ...` }, ...tail]
  }

  function computeLinear(oldLines, newLines, contextLines) {
    let prefix = 0
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++
    let suffix = 0
    while (
      suffix < oldLines.length - prefix &&
      suffix < newLines.length - prefix &&
      oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) suffix++
    if (prefix === oldLines.length && prefix === newLines.length) return { hunks: [], totalOld: oldLines.length, totalNew: newLines.length, mode: 'linear' }
    const leadStart = Math.max(0, prefix - contextLines)
    const leadContext = oldLines.slice(leadStart, prefix).map((text, index) => ({
      type: 'equal', oldLine: leadStart + index + 1, newLine: leadStart + index + 1, text
    }))
    const oldEnd = oldLines.length - suffix
    const newEnd = newLines.length - suffix
    const changes = [
      ...clipChangedLines(oldLines.slice(prefix, oldEnd), 'remove', prefix + 1),
      ...clipChangedLines(newLines.slice(prefix, newEnd), 'add', prefix + 1)
    ]
    const trailContext = oldLines.slice(oldEnd, Math.min(oldLines.length, oldEnd + contextLines)).map((text, index) => ({
      type: 'equal', oldLine: oldEnd + index + 1, newLine: newEnd + index + 1, text
    }))
    return { hunks: [{ leadContext, changes, trailContext }], totalOld: oldLines.length, totalNew: newLines.length, mode: 'linear' }
  }

  function compute(beforeText = '', afterText = '', contextLines = 3) {
    const check = inspect(beforeText, afterText)
    if (!check.renderable) return { ...check, hunks: [], totalOld: 0, totalNew: 0, mode: 'summary' }
    const { oldLines, newLines } = check
    if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
      return { renderable: true, ...computeLinear(oldLines, newLines, contextLines) }
    }
    return { renderable: true, oldLines, newLines, mode: 'exact' }
  }

  window.ChangeDiffPolicy = { inspect, compute, computeLinear }
})()
