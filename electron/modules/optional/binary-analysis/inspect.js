/**
 * 静态二进制检视（无第三方反编译引擎依赖）
 * PE 优先；ELF 基础；未知格式仍可提字符串/熵
 */

const fs = require('fs')
const path = require('path')

const MAX_READ_BYTES = 48 * 1024 * 1024
const MAX_STRINGS = 200
const MIN_STRING_LEN = 4

const PE_MACHINE = {
  0x14c: 'i386',
  0x8664: 'x86_64',
  0x1c0: 'ARM',
  0xaa64: 'ARM64',
  0x200: 'IA64'
}

const PE_SUBSYSTEM = {
  1: 'native',
  2: 'Windows GUI',
  3: 'Windows CUI',
  7: 'POSIX CUI',
  9: 'Windows CE',
  10: 'EFI application'
}

function readU16(buf, off) {
  if (off + 2 > buf.length) return 0
  return buf.readUInt16LE(off)
}

function readU32(buf, off) {
  if (off + 4 > buf.length) return 0
  return buf.readUInt32LE(off)
}

function readAscii(buf, off, max = 256) {
  if (off < 0 || off >= buf.length) return ''
  const end = Math.min(buf.length, off + max)
  const slice = buf.subarray(off, end)
  const z = slice.indexOf(0)
  return slice.subarray(0, z < 0 ? slice.length : z).toString('utf8').replace(/[^\x20-\x7E]/g, '')
}

function shannonEntropy(buf) {
  if (!buf || !buf.length) return 0
  const freq = new Array(256).fill(0)
  for (let i = 0; i < buf.length; i++) freq[buf[i]]++
  let h = 0
  const n = buf.length
  for (let i = 0; i < 256; i++) {
    if (!freq[i]) continue
    const p = freq[i] / n
    h -= p * Math.log2(p)
  }
  return Math.round(h * 1000) / 1000
}

function extractStrings(buf, { minLen = MIN_STRING_LEN, limit = MAX_STRINGS } = {}) {
  const out = []
  let cur = ''
  const push = () => {
    if (cur.length >= minLen && out.length < limit) out.push(cur)
    cur = ''
  }
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if (c >= 0x20 && c <= 0x7e) cur += String.fromCharCode(c)
    else push()
  }
  push()
  // UTF-16LE 粗提
  cur = ''
  for (let i = 0; i + 1 < buf.length && out.length < limit; i += 2) {
    const c = buf[i]
    const hi = buf[i + 1]
    if (hi === 0 && c >= 0x20 && c <= 0x7e) cur += String.fromCharCode(c)
    else {
      if (cur.length >= minLen) out.push(cur)
      cur = ''
    }
  }
  if (cur.length >= minLen && out.length < limit) out.push(cur)
  return [...new Set(out)].slice(0, limit)
}

function detectFormat(buf) {
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return 'PE'
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'ELF'
  if (buf.length >= 4 && buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) return 'Mach-O'
  if (buf.length >= 4 && buf[0] === 0xce && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) return 'Mach-O'
  if (buf.length >= 4 && buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe) return 'Mach-O-Fat'
  return 'unknown'
}

function rvaToOffset(rva, sections) {
  for (const s of sections) {
    const va = s.virtual_address
    const size = Math.max(s.virtual_size || 0, s.raw_size || 0)
    if (rva >= va && rva < va + size) {
      return (s.raw_ptr || 0) + (rva - va)
    }
  }
  return null
}

function parsePe(buf) {
  const e_lfanew = readU32(buf, 0x3c)
  if (e_lfanew <= 0 || e_lfanew + 0x18 > buf.length) {
    return { ok: false, error: 'invalid PE header offset' }
  }
  if (readU32(buf, e_lfanew) !== 0x4550) {
    return { ok: false, error: 'PE signature missing' }
  }
  const coff = e_lfanew + 4
  const machine = readU16(buf, coff)
  const numberOfSections = readU16(buf, coff + 2)
  const sizeOfOptionalHeader = readU16(buf, coff + 16)
  const characteristics = readU16(buf, coff + 18)
  const opt = coff + 20
  const magic = readU16(buf, opt)
  const isPE32Plus = magic === 0x20b
  const entryRva = readU32(buf, opt + 16)
  const imageBase = isPE32Plus
    ? Number(buf.readBigUInt64LE(opt + 24))
    : readU32(buf, opt + 28)
  const subsystem = readU16(buf, opt + (isPE32Plus ? 68 : 68))
  const ddOffset = isPE32Plus ? opt + 112 : opt + 96
  const importRva = readU32(buf, ddOffset + 8)
  const exportRva = readU32(buf, ddOffset + 0)
  const sectionTable = opt + sizeOfOptionalHeader
  const sections = []
  for (let i = 0; i < numberOfSections; i++) {
    const off = sectionTable + i * 40
    if (off + 40 > buf.length) break
    const name = buf.subarray(off, off + 8).toString('utf8').replace(/\0+$/g, '')
    const virtualSize = readU32(buf, off + 8)
    const virtualAddress = readU32(buf, off + 12)
    const rawSize = readU32(buf, off + 16)
    const rawPtr = readU32(buf, off + 20)
    const chars = readU32(buf, off + 36)
    const slice = rawPtr > 0 && rawSize > 0
      ? buf.subarray(rawPtr, Math.min(buf.length, rawPtr + Math.min(rawSize, 2 * 1024 * 1024)))
      : Buffer.alloc(0)
    sections.push({
      name,
      virtual_size: virtualSize,
      virtual_address: virtualAddress,
      raw_size: rawSize,
      raw_ptr: rawPtr,
      characteristics: '0x' + chars.toString(16),
      entropy: shannonEntropy(slice),
      executable: !!(chars & 0x20000000)
    })
  }

  const imports = []
  if (importRva) {
    let descOff = rvaToOffset(importRva, sections)
    let guard = 0
    while (descOff != null && descOff + 20 <= buf.length && guard++ < 256) {
      const nameRva = readU32(buf, descOff + 12)
      const oft = readU32(buf, descOff)
      const ft = readU32(buf, descOff + 16)
      if (!nameRva && !oft && !ft) break
      const nameOff = rvaToOffset(nameRva, sections)
      const dll = nameOff != null ? readAscii(buf, nameOff, 128) : ''
      if (dll) imports.push(dll)
      descOff += 20
    }
  }

  let exportCount = 0
  let exportName = ''
  if (exportRva) {
    const expOff = rvaToOffset(exportRva, sections)
    if (expOff != null && expOff + 40 <= buf.length) {
      exportCount = readU32(buf, expOff + 20)
      const nameRva = readU32(buf, expOff + 12)
      const nameOff = rvaToOffset(nameRva, sections)
      if (nameOff != null) exportName = readAscii(buf, nameOff, 128)
    }
  }

  const entryFileOff = rvaToOffset(entryRva, sections)
  let entryHex = ''
  if (entryFileOff != null && entryFileOff < buf.length) {
    const n = Math.min(64, buf.length - entryFileOff)
    entryHex = buf.subarray(entryFileOff, entryFileOff + n).toString('hex').replace(/(..)/g, '$1 ').trim()
  }

  return {
    ok: true,
    format: 'PE',
    pe: {
      machine: PE_MACHINE[machine] || `0x${machine.toString(16)}`,
      machine_raw: machine,
      pe32_plus: isPE32Plus,
      sections_count: numberOfSections,
      characteristics: '0x' + characteristics.toString(16),
      entry_rva: '0x' + entryRva.toString(16),
      entry_file_offset: entryFileOff,
      image_base: '0x' + Number(imageBase).toString(16),
      subsystem: PE_SUBSYSTEM[subsystem] || String(subsystem),
      export_dll_name: exportName || null,
      export_count: exportCount,
      imports,
      sections,
      entry_hex: entryHex
    }
  }
}

function parseElf(buf) {
  const eiClass = buf[4]
  const eiData = buf[5]
  const le = eiData === 1
  const read16 = off => (le ? buf.readUInt16LE(off) : buf.readUInt16BE(off))
  const read32 = off => (le ? buf.readUInt32LE(off) : buf.readUInt32BE(off))
  const is64 = eiClass === 2
  const e_type = read16(16)
  const e_machine = read16(18)
  const machines = { 3: 'x86', 62: 'x86_64', 40: 'ARM', 183: 'AArch64' }
  return {
    ok: true,
    format: 'ELF',
    elf: {
      class: is64 ? 'ELF64' : 'ELF32',
      endian: le ? 'little' : 'big',
      type: e_type,
      machine: machines[e_machine] || `0x${e_machine.toString(16)}`,
      entry: is64
        ? '0x' + (le ? buf.readBigUInt64LE(24) : buf.readBigUInt64BE(24)).toString(16)
        : '0x' + read32(24).toString(16)
    }
  }
}

function inspectBuffer(buf, meta = {}) {
  const format = detectFormat(buf)
  const base = {
    success: true,
    path: meta.path || '',
    file_name: meta.fileName || '',
    size_bytes: meta.sizeBytes != null ? meta.sizeBytes : buf.length,
    read_bytes: buf.length,
    truncated: !!meta.truncated,
    format,
    overall_entropy: shannonEntropy(buf.subarray(0, Math.min(buf.length, 1024 * 1024))),
    strings_sample: extractStrings(buf, { limit: meta.stringLimit || MAX_STRINGS }),
    notes: [
      '静态检视结果，非完整反编译。',
      '仅用于授权样本 / 自有产物 / 隔离环境研判。',
      '完整伪代码需本机安装 Ghidra/r2 等引擎（本模块不捆绑）。'
    ]
  }

  if (format === 'PE') {
    const pe = parsePe(buf)
    if (!pe.ok) return { ...base, success: false, error: pe.error }
    return { ...base, ...pe, summary: buildPeSummary(pe.pe, base) }
  }
  if (format === 'ELF') {
    const elf = parseElf(buf)
    return { ...base, ...elf, summary: `ELF ${elf.elf.machine} entry=${elf.elf.entry}` }
  }
  return {
    ...base,
    summary: `未知/未完整解析格式，已提取 ${base.strings_sample.length} 条可打印字符串，整体熵 ${base.overall_entropy}`
  }
}

function buildPeSummary(pe, base) {
  const highEntropy = (pe.sections || []).filter(s => s.entropy >= 7.0).map(s => s.name)
  const bits = [
    `PE ${pe.machine} ${pe.subsystem}`,
    `entry ${pe.entry_rva}`,
    `imports ${pe.imports.length}`,
    `exports ${pe.export_count}`,
    highEntropy.length ? `高熵节: ${highEntropy.join(',')}` : null
  ].filter(Boolean)
  return bits.join(' · ')
}

async function inspectFile(filePath, options = {}) {
  const abs = path.resolve(filePath)
  const st = await fs.promises.stat(abs)
  if (!st.isFile()) {
    return { success: false, error: 'path is not a file', path: abs }
  }
  const size = st.size
  const maxRead = Math.min(size, Number(options.max_bytes) || MAX_READ_BYTES)
  const fh = await fs.promises.open(abs, 'r')
  try {
    const buf = Buffer.alloc(maxRead)
    const { bytesRead } = await fh.read(buf, 0, maxRead, 0)
    const slice = buf.subarray(0, bytesRead)
    return inspectBuffer(slice, {
      path: abs,
      fileName: path.basename(abs),
      sizeBytes: size,
      truncated: size > maxRead,
      stringLimit: options.string_limit || MAX_STRINGS
    })
  } finally {
    await fh.close()
  }
}

module.exports = {
  MAX_READ_BYTES,
  inspectFile,
  inspectBuffer,
  detectFormat,
  extractStrings,
  shannonEntropy
}
