(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.MarkdownTableParser = api
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict'

  function hasUnescapedPipe(line = '') {
    const value = String(line)
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== '|') continue
      let slashes = 0
      for (let j = i - 1; j >= 0 && value[j] === '\\'; j--) slashes++
      if (slashes % 2 === 0) return true
    }
    return false
  }

  function trimOuterPipes(line = '') {
    let value = String(line).trim()
    if (value.startsWith('|')) value = value.slice(1)
    if (value.endsWith('|')) {
      let slashes = 0
      for (let i = value.length - 2; i >= 0 && value[i] === '\\'; i--) slashes++
      if (slashes % 2 === 0) value = value.slice(0, -1)
    }
    return value
  }

  function splitRow(line = '') {
    const value = trimOuterPipes(line)
    const cells = []
    let cell = ''
    for (let i = 0; i < value.length; i++) {
      const ch = value[i]
      if (ch === '\\' && value[i + 1] === '|') {
        cell += '|'
        i++
        continue
      }
      if (ch === '|') {
        cells.push(cell.trim())
        cell = ''
        continue
      }
      cell += ch
    }
    cells.push(cell.trim())
    return cells
  }

  function isSeparatorRow(line = '') {
    if (!hasUnescapedPipe(line)) return false
    const cells = splitRow(line)
    return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
  }

  function alignmentFor(cell = '') {
    const value = String(cell).replace(/\s+/g, '')
    if (value.startsWith(':') && value.endsWith(':')) return 'center'
    if (value.endsWith(':')) return 'right'
    return value.startsWith(':') ? 'left' : ''
  }

  function normalizeRow(cells, columnCount) {
    const row = Array.isArray(cells) ? cells.slice(0, columnCount) : []
    while (row.length < columnCount) row.push('')
    return row
  }

  function extractTables(markdown = '') {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
    const output = []
    const tables = []

    for (let index = 0; index < lines.length; index++) {
      const headerLine = lines[index]
      const separatorLine = lines[index + 1]
      if (!hasUnescapedPipe(headerLine) || !isSeparatorRow(separatorLine)) {
        output.push(headerLine)
        continue
      }

      const header = splitRow(headerLine)
      const separator = splitRow(separatorLine)
      if (header.length < 2 || separator.length !== header.length) {
        output.push(headerLine)
        continue
      }

      const rows = []
      let cursor = index + 2
      while (cursor < lines.length) {
        const line = lines[cursor]
        if (!line.trim() || !hasUnescapedPipe(line) || isSeparatorRow(line)) break
        const cells = splitRow(line)
        if (cells.length < 2) break
        rows.push(normalizeRow(cells, header.length))
        cursor++
      }

      const tableIndex = tables.length
      tables.push({
        header,
        alignments: normalizeRow(separator.map(alignmentFor), header.length),
        rows,
        source: lines.slice(index, cursor).join('\n')
      })
      output.push('', `\u0000MTB${tableIndex}\u0000`, '')
      index = cursor - 1
    }

    return {
      content: output.join('\n').replace(/\n{3,}/g, '\n\n'),
      tables
    }
  }

  function parseNumericCell(value = '') {
    const raw = String(value || '').trim()
    if (!raw || /[<>]/.test(raw)) return null
    const normalized = raw
      .replace(/[￥¥$€£]/g, '')
      .replace(/,/g, '')
      .replace(/\s*(?:%|％)$/, '')
      .trim()
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null
    const number = Number(normalized)
    return Number.isFinite(number) ? number : null
  }

  function getChartModel(table = {}) {
    const header = Array.isArray(table.header) ? table.header : []
    const rows = Array.isArray(table.rows) ? table.rows : []
    if (header.length < 2 || rows.length < 2 || rows.length > 20) return null

    const series = []
    for (let column = 1; column < header.length && series.length < 3; column++) {
      const values = rows.map(row => parseNumericCell(row[column]))
      const valid = values.filter(value => value !== null)
      if (valid.length < 2 || valid.length / rows.length < 0.75 || valid.some(value => value < 0)) continue
      series.push({ column, label: header[column] || `第 ${column + 1} 列`, values })
    }
    if (!series.length) return null

    const max = Math.max(0, ...series.flatMap(item => item.values.filter(value => value !== null)))
    if (!(max > 0)) return null
    return {
      labels: rows.map((row, index) => String(row[0] || `第 ${index + 1} 行`)),
      rows,
      series,
      max
    }
  }

  return {
    extractTables,
    splitRow,
    isSeparatorRow,
    parseNumericCell,
    getChartModel
  }
})
