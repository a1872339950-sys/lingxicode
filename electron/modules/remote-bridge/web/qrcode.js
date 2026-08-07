/**
 * LingxiQR — 极简纯 JS QR 码生成器
 * 支持 Version 1-10, 纠错等级 M, Byte 模式
 * 适用于局域网 URL 等短文本编码
 */
;(function (root) {
  'use strict'

  // ── 常量表 ──
  // GF(256) 指数表与对数表
  const EXP = new Uint8Array(512)
  const LOG = new Uint8Array(256)
  ;(function initGF() {
    let x = 1
    for (let i = 0; i < 255; i++) {
      EXP[i] = x
      LOG[x] = i
      x = (x << 1) ^ (x & 128 ? 0x11d : 0)
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
  })()

  function gfMul(a, b) {
    return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]
  }

  // Reed-Solomon 生成器多项式
  function rsGenPoly(n) {
    let poly = [1]
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0)
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j]
        next[j + 1] ^= gfMul(poly[j], EXP[i])
      }
      poly = next
    }
    return poly
  }

  // Reed-Solomon 编码
  function rsEncode(data, ecLen) {
    const poly = rsGenPoly(ecLen)
    const msg = new Uint8Array(data.length + ecLen)
    msg.set(data)
    for (let i = 0; i < data.length; i++) {
      const coef = msg[i]
      if (coef !== 0) {
        for (let j = 0; j < poly.length; j++) {
          msg[i + j] ^= gfMul(poly[j], coef)
        }
      }
    }
    return msg.slice(data.length)
  }

  // ── QR 版本参数表 (Version 1-10, EC Level M) ──
  // [totalCodewords, ecCodewordsPerBlock, numBlocks_group1, dataCodewords_group1, numBlocks_group2, dataCodewords_group2]
  const VERSION_PARAMS = {
    1:  [26,  10, 1, 16, 0,  0],
    2:  [44,  16, 1, 28, 0,  0],
    3:  [70,  26, 1, 44, 0,  0],
    4:  [100, 18, 2, 32, 0,  0],
    5:  [134, 24, 2, 43, 0,  0],
    6:  [172, 16, 4, 27, 0,  0],
    7:  [196, 18, 4, 31, 0,  0],
    8:  [242, 22, 2, 38, 2, 39],
    9:  [292, 22, 3, 36, 2, 37],
    10: [346, 26, 4, 43, 1, 44],
  }

  // 每个版本的数据容量（字节模式, EC Level M）
  const BYTE_CAPACITY = {
    1: 14, 2: 26, 3: 42, 4: 62, 5: 84,
    6: 106, 7: 122, 8: 152, 9: 180, 10: 213,
  }

  function selectVersion(dataLen) {
    for (let v = 1; v <= 10; v++) {
      if (dataLen <= BYTE_CAPACITY[v]) return v
    }
    return 10 // 超出范围用最大版本
  }

  // ── 数据编码 (Byte mode) ──
  function encodeData(text, version) {
    const bytes = []
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c < 0x80) bytes.push(c)
      else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
      else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
    }

    const totalDataCW = VERSION_PARAMS[version][0] - getTotalEC(version)
    const bits = []

    // Mode indicator: 0100 (byte mode)
    pushBits(bits, 0b0100, 4)
    // Character count (8 bits for v1-9, 16 bits for v10+)
    const ccBits = version <= 9 ? 8 : 16
    pushBits(bits, bytes.length, ccBits)
    // Data bytes
    for (const b of bytes) pushBits(bits, b, 8)
    // Terminator
    pushBits(bits, 0, Math.min(4, totalDataCW * 8 - bits.length))
    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0)
    // Pad codewords
    const padBytes = [0xEC, 0x11]
    let pi = 0
    while (bits.length < totalDataCW * 8) {
      pushBits(bits, padBytes[pi++ % 2], 8)
    }

    // Convert to bytes
    const codewords = new Uint8Array(totalDataCW)
    for (let i = 0; i < totalDataCW; i++) {
      let val = 0
      for (let b = 0; b < 8; b++) val = (val << 1) | (bits[i * 8 + b] || 0)
      codewords[i] = val
    }
    return codewords
  }

  function getTotalEC(version) {
    const p = VERSION_PARAMS[version]
    return p[2] * p[1] + p[4] * p[1]
  }

  function pushBits(arr, value, numBits) {
    for (let i = numBits - 1; i >= 0; i--) {
      arr.push((value >> i) & 1)
    }
  }

  // ── 纠错编码 + 交织 ──
  function buildBlocks(dataCW, version) {
    const p = VERSION_PARAMS[version]
    const ecPerBlock = p[1]
    const g1Blocks = p[2], g1Data = p[3]
    const g2Blocks = p[4], g2Data = p[5]

    const blocks = []
    const ecBlocks = []
    let offset = 0

    for (let i = 0; i < g1Blocks; i++) {
      const block = dataCW.slice(offset, offset + g1Data)
      blocks.push(block)
      ecBlocks.push(rsEncode(block, ecPerBlock))
      offset += g1Data
    }
    for (let i = 0; i < g2Blocks; i++) {
      const block = dataCW.slice(offset, offset + g2Data)
      blocks.push(block)
      ecBlocks.push(rsEncode(block, ecPerBlock))
      offset += g2Data
    }

    // Interleave data codewords
    const result = []
    const maxDataLen = Math.max(g1Data, g2Data || 0)
    for (let i = 0; i < maxDataLen; i++) {
      for (const block of blocks) {
        if (i < block.length) result.push(block[i])
      }
    }
    // Interleave EC codewords
    for (let i = 0; i < ecPerBlock; i++) {
      for (const block of ecBlocks) {
        if (i < block.length) result.push(block[i])
      }
    }
    return new Uint8Array(result)
  }

  // ── 矩阵构建 ──
  const SIZE = (v) => v * 4 + 17

  function createMatrix(version) {
    const size = SIZE(version)
    const matrix = Array.from({ length: size }, () => new Int8Array(size)) // 0=unset, 1=black, -1=white
    const reserved = Array.from({ length: size }, () => new Uint8Array(size)) // 1=reserved
    return { matrix, reserved, size }
  }

  function placeFinderPattern(mat, res, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c
        if (rr < 0 || rr >= mat.length || cc < 0 || cc >= mat.length) continue
        const isBlack = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        mat[rr][cc] = isBlack ? 1 : -1
        res[rr][cc] = 1
      }
    }
  }

  function placeAlignmentPattern(mat, res, row, col) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const rr = row + r, cc = col + c
        const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)
        mat[rr][cc] = isBlack ? 1 : -1
        res[rr][cc] = 1
      }
    }
  }

  function getAlignmentPositions(version) {
    if (version <= 1) return []
    const size = SIZE(version)
    const intervals = Math.floor(version / 7) + 1
    const step = Math.ceil((size - 13) / (2 * intervals)) * 2
    const positions = [6]
    let pos = size - 7
    while (positions.length < intervals + 1) {
      positions.unshift(pos)
      pos -= step
    }
    positions.sort((a, b) => a - b)
    // Remove duplicates
    return [...new Set(positions)]
  }

  function placeFunctionPatterns(mat, res, version) {
    const size = SIZE(version)

    // Finder patterns + separators
    placeFinderPattern(mat, res, 0, 0)
    placeFinderPattern(mat, res, 0, size - 7)
    placeFinderPattern(mat, res, size - 7, 0)

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      mat[6][i] = (i % 2 === 0) ? 1 : -1
      res[6][i] = 1
      mat[i][6] = (i % 2 === 0) ? 1 : -1
      res[i][6] = 1
    }

    // Alignment patterns
    const alignPos = getAlignmentPositions(version)
    for (const r of alignPos) {
      for (const c of alignPos) {
        // Skip if overlapping with finder patterns
        if (r <= 8 && c <= 8) continue
        if (r <= 8 && c >= size - 8) continue
        if (r >= size - 8 && c <= 8) continue
        placeAlignmentPattern(mat, res, r, c)
      }
    }

    // Dark module
    mat[size - 8][8] = 1
    res[size - 8][8] = 1

    // Reserve format info areas
    for (let i = 0; i < 9; i++) {
      if (!res[8][i]) { res[8][i] = 1; mat[8][i] = 0 }
      if (!res[i][8]) { res[i][8] = 1; mat[i][8] = 0 }
    }
    for (let i = 0; i < 8; i++) {
      res[8][size - 1 - i] = 1; mat[8][size - 1 - i] = 0
      res[size - 1 - i][8] = 1; mat[size - 1 - i][8] = 0
    }
  }

  // ── 放置数据 ──
  function placeData(mat, res, data, size) {
    const bits = []
    for (const byte of data) {
      for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
    }

    let bitIdx = 0
    let upward = true
    for (let col = size - 1; col >= 0; col -= 2) {
      if (col === 6) col = 5 // skip timing column
      const rows = upward ? range(size - 1, -1, -1) : range(0, size, 1)
      for (const row of rows) {
        for (let dc = 0; dc <= 1; dc++) {
          const c = col - dc
          if (c < 0 || res[row][c]) continue
          mat[row][c] = (bitIdx < bits.length && bits[bitIdx]) ? 1 : -1
          bitIdx++
        }
      }
      upward = !upward
    }
  }

  function range(start, end, step) {
    const result = []
    if (step > 0) { for (let i = start; i < end; i += step) result.push(i) }
    else { for (let i = start; i > end; i += step) result.push(i) }
    return result
  }

  // ── 掩码 ──
  const MASK_FNS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ]

  function applyMask(mat, res, maskIdx, size) {
    const fn = MASK_FNS[maskIdx]
    const masked = mat.map(row => new Int8Array(row))
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (res[r][c]) continue
        if (fn(r, c)) masked[r][c] = masked[r][c] === 1 ? -1 : 1
      }
    }
    return masked
  }

  function penaltyScore(mat, size) {
    let score = 0
    // Rule 1: consecutive same-color modules in row/col
    for (let r = 0; r < size; r++) {
      let count = 1
      for (let c = 1; c < size; c++) {
        if (mat[r][c] === mat[r][c - 1]) { count++; }
        else { if (count >= 5) score += count - 2; count = 1; }
      }
      if (count >= 5) score += count - 2
    }
    for (let c = 0; c < size; c++) {
      let count = 1
      for (let r = 1; r < size; r++) {
        if (mat[r][c] === mat[r - 1][c]) { count++; }
        else { if (count >= 5) score += count - 2; count = 1; }
      }
      if (count >= 5) score += count - 2
    }
    // Rule 2: 2x2 blocks of same color
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = mat[r][c]
        if (v === mat[r][c + 1] && v === mat[r + 1][c] && v === mat[r + 1][c + 1]) {
          score += 3
        }
      }
    }
    return score
  }

  // ── 格式信息 ──
  // EC Level M = 00, masks 0-7
  const FORMAT_INFO = [
    0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0,
  ]

  function placeFormatInfo(mat, maskIdx, size) {
    const info = FORMAT_INFO[maskIdx]
    for (let i = 0; i < 15; i++) {
      const bit = (info >> i) & 1 ? 1 : -1
      // Horizontal
      if (i < 6) mat[8][i] = bit
      else if (i === 6) mat[8][7] = bit
      else if (i === 7) mat[8][8] = bit
      else if (i === 8) mat[7][8] = bit
      else mat[14 - i][8] = bit
      // Vertical
      if (i < 8) mat[size - 1 - i][8] = bit
      else mat[8][size - 15 + i] = bit
    }
  }

  // ── 主生成函数 ──
  function generate(text) {
    const version = selectVersion(byteLength(text))
    const size = SIZE(version)

    // Encode data
    const dataCW = encodeData(text, version)
    const allCW = buildBlocks(dataCW, version)

    // Build matrix
    const { matrix, reserved } = createMatrix(version)
    placeFunctionPatterns(matrix, reserved, version)
    placeData(matrix, reserved, allCW, size)

    // Try all masks, pick best
    let bestMask = 0, bestScore = Infinity
    for (let m = 0; m < 8; m++) {
      const masked = applyMask(matrix, reserved, m, size)
      placeFormatInfo(masked, m, size)
      const score = penaltyScore(masked, size)
      if (score < bestScore) { bestScore = score; bestMask = m }
    }

    const final = applyMask(matrix, reserved, bestMask, size)
    placeFormatInfo(final, bestMask, size)

    // Convert to 2D boolean array
    const result = []
    for (let r = 0; r < size; r++) {
      const row = []
      for (let c = 0; c < size; c++) {
        row.push(final[r][c] === 1)
      }
      result.push(row)
    }

    return { modules: result, size, version }
  }

  function byteLength(text) {
    let len = 0
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c < 0x80) len += 1
      else if (c < 0x800) len += 2
      else len += 3
    }
    return len
  }

  // ── Canvas 渲染 ──
  function renderToCanvas(canvas, text, options) {
    const opts = Object.assign({
      size: 200,
      margin: 2,
      fgColor: '#000000',
      bgColor: '#ffffff',
    }, options || {})

    const qr = generate(text)
    const moduleCount = qr.size
    const totalModules = moduleCount + opts.margin * 2
    const cellSize = Math.floor(opts.size / totalModules)
    const actualSize = cellSize * totalModules

    canvas.width = actualSize
    canvas.height = actualSize
    const ctx = canvas.getContext('2d')

    // Background
    ctx.fillStyle = opts.bgColor
    ctx.fillRect(0, 0, actualSize, actualSize)

    // Modules
    ctx.fillStyle = opts.fgColor
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.modules[r][c]) {
          ctx.fillRect(
            (c + opts.margin) * cellSize,
            (r + opts.margin) * cellSize,
            cellSize, cellSize
          )
        }
      }
    }
  }

  // ── 导出 ──
  const LingxiQR = { generate, renderToCanvas }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LingxiQR
  } else {
    root.LingxiQR = LingxiQR
  }
})(typeof window !== 'undefined' ? window : global)
