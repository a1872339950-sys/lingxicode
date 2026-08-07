/**
 * 调用链追踪工具
 * 基于 rg 文本搜索 + AST outline 定位，实现轻量级调用链追踪。
 * 支持 callers（谁调了这个函数）和 callees（这个函数调用了谁）双向追踪。
 */

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { getRgPath } = require('../rg-path')
const { isInsideProject } = require('../path-utils')
const { isLikelyTextBuffer } = require('../text-edit-utils')
const { buildOutline } = require('./code-navigation')

const execFileAsync = promisify(execFile)
const TRACE_TIMEOUT_MS = 30000
const MAX_FILE_BYTES = 512 * 1024
const MAX_DEPTH = 5
const MAX_NODES = 200
const MAX_CALLERS_PER_NODE = 15
const MAX_CALLEES_PER_NODE = 10

// JS/TS 关键字和内置函数，提取 callees 时排除
const KEYWORD_SET = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'typeof',
  'instanceof', 'delete', 'void', 'do', 'else', 'try', 'finally',
  'throw', 'break', 'continue', 'function', 'class', 'extends',
  'super', 'this', 'yield', 'await', 'async', 'import', 'export',
  'default', 'from', 'as', 'in', 'of', 'let', 'const', 'var',
  'require', 'console', 'Promise', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'process', 'module', 'exports',
  'global', 'globalThis', 'window', 'document', 'JSON', 'Math',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Symbol', 'BigInt',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURI',
  'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'Buffer', 'Stream', 'EventEmitter', 'console',
  // Array methods
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat',
  'join', 'reverse', 'sort', 'fill', 'find', 'findIndex', 'filter',
  'map', 'reduce', 'reduceRight', 'forEach', 'some', 'every',
  'includes', 'indexOf', 'lastIndexOf', 'flat', 'flatMap',
  'keys', 'values', 'entries', 'from', 'isArray', 'of',
  // String methods
  'split', 'match', 'replace', 'replaceAll', 'search', 'substring',
  'substr', 'toLowerCase', 'toUpperCase', 'trim', 'trimStart',
  'trimEnd', 'charAt', 'charCodeAt', 'padStart', 'padEnd',
  'startsWith', 'endsWith', 'repeat', 'normalize', 'localeCompare',
  // Object methods
  'assign', 'freeze', 'create', 'defineProperty', 'defineProperties',
  'getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyNames',
  'getOwnPropertyDescriptor', 'hasOwnProperty', 'isPrototypeOf',
  'propertyIsEnumerable', 'is', 'entries', 'fromEntries',
  // RegExp methods
  'test', 'exec',
  // Common utility
  'log', 'error', 'warn', 'info', 'debug', 'dir', 'assert',
  'time', 'timeEnd', 'group', 'groupEnd', 'trace',
  'max', 'min', 'abs', 'ceil', 'floor', 'round', 'pow', 'sqrt',
  'random', 'sign', 'trunc', 'cbrt', 'exp', 'log2', 'log10',
  'call', 'apply', 'bind', 'toString', 'valueOf', 'toJSON',
  'then', 'catch', 'finally', 'resolve', 'reject', 'all',
  'race', 'allSettled', 'any',
  // Node.js common
  'pipe', 'on', 'once', 'emit', 'removeListener', 'removeAllListeners',
  'addListener', 'prependListener', 'write', 'end', 'read', 'destroy'
])

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toRelativePath(projectPath, filePath) {
  const rel = path.relative(projectPath, filePath).replace(/\\/g, '/')
  return rel || filePath
}

function normalizePathSep(p) {
  return String(p || '').replace(/\\/g, '/')
}

// 判断一行是否是函数/变量定义行（而非调用行）
function isDefinitionLine(line, symbol) {
  const trimmed = String(line || '').trim()
  const sym = escapeRegex(symbol)
  // 常见定义模式
  const defPatterns = [
    new RegExp(`^\\s*(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${sym}\\s*\\(`),
    new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+${sym}\\s*=`),
    new RegExp(`^\\s*(export\\s+)?${sym}\\s*:\\s*(async\\s*)?function`),
    new RegExp(`^\\s*(export\\s+)?${sym}\\s*:\\s*(async\\s*)?\\(`),
    new RegExp(`^\\s*(export\\s+)?${sym}\\s*=\\s*(async\\s*)?function`),
    new RegExp(`^\\s*(export\\s+)?${sym}\\s*=\\s*(async\\s*)?\\(`),
    new RegExp(`^\\s*(export\\s+)?${sym}\\s*=\\s*(async\\s*)?[^=].*=>`),
    new RegExp(`^\\s*class\\s+${sym}\\b`),
    new RegExp(`^\\s*(export\\s+)?default\\s+class\\s+${sym}\\b`),
    // Python def
    new RegExp(`^\\s*def\\s+${sym}\\s*\\(`),
    new RegExp(`^\\s*class\\s+${sym}\\b`),
    // Go func
    new RegExp(`^\\s*func\\s+${sym}\\s*\\(`),
    new RegExp(`^\\s*func\\s+\\([^)]*\\)\\s+${sym}\\s*\\(`),
  ]
  return defPatterns.some(re => re.test(trimmed))
}

// 读取文件内容并返回行数组
function readSourceFile(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
    const buffer = fs.readFileSync(filePath)
    if (!isLikelyTextBuffer(buffer)) return null
    const content = buffer.toString('utf8')
    return content.split(/\r\n|\r|\n/)
  } catch {
    return null
  }
}

// 用 rg 搜索项目中所有 symbol( 的出现位置
async function findSymbolOccurrences(symbol, projectPath, maxResults = 80) {
  let stdout = ''
  try {
    const result = await execFileAsync(getRgPath(), [
      '-n', '--no-heading', '--color', 'never', '-i', '-F',
      '-m', String(maxResults),
      '-g', '!node_modules', '-g', '!dist', '-g', '!build', '-g', '!release',
      '-g', '!.git', '-g', '!coverage', '-g', '!codemap', '-g', '!change-sessions',
      '-g', '!*.png', '-g', '!*.jpg', '-g', '!*.jpeg', '-g', '!*.gif', '-g', '!*.webp',
      '-g', '!*.mp4', '-g', '!*.mp3', '-g', '!*.woff', '-g', '!*.ttf',
      '-e', `${symbol}(`,
      '.'
    ], {
      cwd: projectPath,
      encoding: 'utf8',
      timeout: TRACE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    })
    stdout = result.stdout || ''
  } catch (error) {
    stdout = error?.stdout || ''
  }
  const hits = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const match = line.match(/^(.+?):(\d+):(.*)$/)
    if (!match) continue
    const filePath = path.resolve(projectPath, match[1])
    const lineNumber = parseInt(match[2], 10)
    const content = match[3]
    // 排除注释行
    const trimmed = content.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    hits.push({ path: filePath, line: lineNumber, content })
  }
  return hits
}

// 找到定义位置
async function findDefinition(symbol, projectPath) {
  const hits = await findSymbolOccurrences(symbol, projectPath, 50)
  for (const hit of hits) {
    if (isDefinitionLine(hit.content, symbol)) {
      return hit
    }
  }
  return null
}

// 找到调用点（排除定义行）
async function findCallSites(symbol, projectPath, maxResults = 60) {
  const hits = await findSymbolOccurrences(symbol, projectPath, maxResults)
  return hits.filter(hit => !isDefinitionLine(hit.content, symbol))
}

// 用 outline 找到包含某行的函数
function findContainingSymbol(lines, ext, targetLine) {
  const source = { lines, ext }
  let outline
  try {
    outline = buildOutline(source)
  } catch {
    return null
  }
  const symbols = outline.symbols || []
  // 找到包含目标行的最小范围函数
  let best = null
  for (const sym of symbols) {
    const start = sym.start_line || sym.startLine || 0
    const end = sym.end_line || sym.endLine || 0
    if (targetLine >= start && targetLine <= end) {
      if (!best || (end - start) < (best.end - best.start)) {
        best = { name: sym.name, kind: sym.kind, start, end }
      }
    }
  }
  return best
}

// 从函数体中提取所有被调用的函数名
function extractCalleesFromBody(lines, startLine, endLine) {
  const body = lines.slice(startLine - 1, endLine).join('\n')
  const callees = new Set()
  // 匹配 identifier( 模式
  const regex = /\b([A-Za-z_$][\w$]*)\s*\(/g
  let match
  while ((match = regex.exec(body)) !== null) {
    const name = match[1]
    if (!KEYWORD_SET.has(name) && name.length >= 4) {
      callees.add(name)
    }
  }
  // 也匹配 .method( 模式，但只取方法名
  const methodRegex = /\.([A-Za-z_$][\w$]*)\s*\(/g
  while ((match = methodRegex.exec(body)) !== null) {
    const name = match[1]
    if (!KEYWORD_SET.has(name) && name.length >= 5) {
      callees.add(name)
    }
  }
  return [...callees]
}

// 递归追踪调用者（谁调了这个函数）
async function traceCallersTree(symbol, projectPath, definition, currentDepth, visited, stats) {
  const nodeKey = `${symbol}@${definition?.path || ''}:${definition?.line || 0}`
  const node = {
    symbol,
    path: definition ? toRelativePath(projectPath, definition.path) : '',
    line: definition?.line || 0,
    type: currentDepth === 0 ? 'definition' : 'caller',
    depth: currentDepth,
    callers: [],
    cycle: false
  }

  if (currentDepth >= MAX_DEPTH || stats.nodeCount >= MAX_NODES) {
    stats.truncated = true
    return node
  }
  if (visited.has(nodeKey)) {
    node.cycle = true
    return node
  }
  visited.add(nodeKey)

  // 找到所有调用点
  const callSites = await findCallSites(symbol, projectPath, 50)
  const callerMap = new Map() // key: callerSymbol@callerPath -> { symbol, path, line }

  for (const site of callSites) {
    if (stats.nodeCount >= MAX_NODES) {
      stats.truncated = true
      break
    }
    const lines = readSourceFile(site.path)
    if (!lines) continue
    const ext = path.extname(site.path).toLowerCase()
    const containing = findContainingSymbol(lines, ext, site.line)
    if (!containing) continue
    const callerKey = `${containing.name}@${site.path}:${containing.start}`
    if (callerMap.has(callerKey)) continue
    callerMap.set(callerKey, {
      symbol: containing.name,
      path: site.path,
      line: containing.start,
      endLine: containing.end,
      kind: containing.kind
    })
  }

  // 递归追踪每个调用者
  let count = 0
  for (const [, caller] of callerMap) {
    if (count >= MAX_CALLERS_PER_NODE || stats.nodeCount >= MAX_NODES) {
      stats.truncated = true
      break
    }
    stats.nodeCount++
    count++
    const childNode = await traceCallersTree(
      caller.symbol, projectPath,
      { path: caller.path, line: caller.line },
      currentDepth + 1, visited, stats
    )
    node.callers.push(childNode)
  }

  return node
}

// 递归追踪被调用者（这个函数调用了谁）
async function traceCalleesTree(symbol, projectPath, definition, currentDepth, visited, stats) {
  const nodeKey = `${symbol}@${definition?.path || ''}:${definition?.line || 0}`
  const node = {
    symbol,
    path: definition ? toRelativePath(projectPath, definition.path) : '',
    line: definition?.line || 0,
    type: currentDepth === 0 ? 'definition' : 'callee',
    depth: currentDepth,
    callees: [],
    cycle: false
  }

  if (currentDepth >= MAX_DEPTH || stats.nodeCount >= MAX_NODES) {
    stats.truncated = true
    return node
  }
  if (visited.has(nodeKey)) {
    node.cycle = true
    return node
  }
  visited.add(nodeKey)

  // 读取函数体，提取 callees
  if (!definition?.path || !definition?.line) return node
  const lines = readSourceFile(definition.path)
  if (!lines) return node

  const ext = path.extname(definition.path).toLowerCase()
  const containing = findContainingSymbol(lines, ext, definition.line)
  if (!containing) return node

  const calleeNames = extractCalleesFromBody(lines, containing.start, containing.end)

  // 对每个 callee，找到定义位置并递归
  let count = 0
  for (const calleeName of calleeNames) {
    if (count >= MAX_CALLEES_PER_NODE || stats.nodeCount >= MAX_NODES) {
      stats.truncated = true
      break
    }
    // 找到 callee 的定义
    const calleeDef = await findDefinition(calleeName, projectPath)
    if (!calleeDef) continue
    stats.nodeCount++
    count++
    const calleeKey = `${calleeName}@${calleeDef.path}:${calleeDef.line}`
    const childNode = await traceCalleesTree(
      calleeName, projectPath,
      { path: calleeDef.path, line: calleeDef.line },
      currentDepth + 1, visited, stats
    )
    // 去重：同一 callee 只展开一次
    if (!node.callees.some(c => c.symbol === calleeName && c.path === childNode.path)) {
      node.callees.push(childNode)
    }
  }

  return node
}

// 将树展平为节点列表，方便消费
function flattenTree(tree, direction, list = []) {
  if (!tree) return list
  const childKey = direction === 'callers' ? 'callers' : 'callees'
  list.push({
    symbol: tree.symbol,
    path: tree.path,
    line: tree.line,
    type: tree.type,
    depth: tree.depth,
    cycle: tree.cycle
  })
  for (const child of tree[childKey] || []) {
    flattenTree(child, direction, list)
  }
  return list
}

// 主 handler
async function traceCallChain(args = {}, ctx = {}) {
  const symbol = String(args.symbol || '').trim()
  const direction = String(args.direction || 'callers').trim()
  const depth = Math.min(Math.max(parseInt(args.depth) || 3, 1), MAX_DEPTH)
  const { projectPath } = ctx

  if (!symbol) {
    return { error: 'symbol is required' }
  }
  if (!projectPath) {
    return { error: 'projectPath is required' }
  }

  // 找到 symbol 的定义位置
  const definition = await findDefinition(symbol, projectPath)
  if (!definition) {
    // 没找到定义，仍然可以搜索调用点
    if (direction === 'callees') {
      return { error: `Cannot find definition of "${symbol}", cannot trace callees`, symbol }
    }
  }

  const callerStats = { nodeCount: 1, truncated: false }
  const calleeStats = { nodeCount: 0, truncated: false }
  const startTime = Date.now()
  const result = {
    symbol,
    direction,
    depth,
    definition: definition ? {
      path: toRelativePath(projectPath, definition.path),
      line: definition.line,
      content: definition.content?.trim() || ''
    } : null
  }

  if (direction === 'callers' || direction === 'both') {
    const visited = new Set()
    const tree = await traceCallersTree(
      symbol, projectPath,
      definition ? { path: definition.path, line: definition.line } : null,
      0, visited, callerStats
    )
    result.callersTree = tree
    result.callersFlat = flattenTree(tree, 'callers')
  }

  if (direction === 'callees' || direction === 'both') {
    const visited = new Set()
    if (definition) {
      const tree = await traceCalleesTree(
        symbol, projectPath,
        { path: definition.path, line: definition.line },
        0, visited, calleeStats
      )
      result.calleesTree = tree
      result.calleesFlat = flattenTree(tree, 'callees')
    }
  }

  result.stats = {
    totalNodes: callerStats.nodeCount + calleeStats.nodeCount,
    callerNodes: callerStats.nodeCount,
    calleeNodes: calleeStats.nodeCount,
    elapsedMs: Date.now() - startTime,
    truncated: callerStats.truncated || calleeStats.truncated,
    maxDepth: depth
  }

  return result
}

const handlers = {
  trace_call_chain: traceCallChain
}

module.exports = { handlers }
