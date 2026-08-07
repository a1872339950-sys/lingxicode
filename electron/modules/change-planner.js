/**
 * 修改工作流编排模块
 * 提供影响面分析、改动排序建议、改后验证报告
 */

const fs = require('fs')
const path = require('path')
const { searchLiteralTerms } = require('./literal-code-search')
const { checkIpcConsistency } = require('./ipc-consistency-checker')
const syntaxChecker = require('./syntax-checker')
const changeSessions = require('./change-sessions')

const MAX_SYMBOLS = 10
const MAX_GREP_RESULTS = 30
const MAX_AFFECTED_FILES = 40
const MAX_RUNTIME_SOURCE_FILES = 600

// ===== 影响面分析 =====

function normalizePath(filePath = '', projectPath = '') {
  let value = String(filePath || '').replace(/\\/g, '/')
  const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-z]:\//i.test(value) && root) {
    try {
      const relative = path.relative(root, value).replace(/\\/g, '/')
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) value = relative
    } catch { /* 路径计算失败 */ }
  }
  return value.replace(/^\.\/+/, '')
}

function isDefinitionLine(line, symbol) {
  const text = String(line || '')
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`(?:function|class|async\\s+function)\\s+${escaped}\\b`),
    new RegExp(`(?:const|let|var)\\s+${escaped}\\s*[:=]`),
    new RegExp(`${escaped}\\s*[:=]\\s*(?:async\\s*)?(?:function|\\([^)]*\\)\\s*=>|class\\b)`),
    new RegExp(`(?:ipcMain|ipcRenderer)\\.(?:handle|on)\\s*\\(\\s*['"\`]${escaped}['"\`]`),
    new RegExp(`module\\.exports\\s*=\\s*${escaped}\\b`),
    new RegExp(`exports\\.${escaped}\\b`)
  ]
  return patterns.some(pattern => pattern.test(text))
}

function isIpcChannel(symbol) {
  return /^[\w]+:[\w-]+$/.test(symbol) || /^(ai-chat|collaboration|config|project|terminal|settings|worker|model)/.test(symbol)
}

async function grepForSymbol(projectPath, symbol, limit = MAX_GREP_RESULTS) {
  try {
    const results = await searchLiteralTerms(projectPath, [symbol], limit)
    return Array.isArray(results) ? results : []
  } catch {
    return []
  }
}

function classifyRisk(referenceCount, hasIpc, fileCount) {
  if (hasIpc || fileCount >= 5) return 'high'
  if (fileCount >= 2) return 'medium'
  return 'low'
}

async function analyzeImpact(input = {}) {
  const { projectPath, symbols = [], limit = 20 } = input
  if (!projectPath || !symbols.length) {
    return { success: false, error: 'Missing projectPath or symbols' }
  }

  const safeSymbols = symbols.slice(0, MAX_SYMBOLS).map(s => String(s || '').trim()).filter(Boolean)
  if (!safeSymbols.length) {
    return { success: false, error: 'No valid symbols provided' }
  }

  const symbolResults = []
  const allAffectedFiles = new Map()

  for (const symbol of safeSymbols) {
    const grepResults = await grepForSymbol(projectPath, symbol, limit)
    const definitionFiles = []
    const referenceFiles = []
    const referenceLines = []
    const ipcChannels = []

    for (const hit of grepResults) {
      const normalizedPath = normalizePath(hit.path, projectPath)
      const fullPath = path.isAbsolute(hit.path) ? hit.path : path.join(projectPath, hit.path)
      const isDef = hit.preview ? isDefinitionLine(hit.preview, symbol) : false

      if (isDef) {
        if (!definitionFiles.includes(normalizedPath)) definitionFiles.push(normalizedPath)
      } else {
        if (!referenceFiles.includes(normalizedPath)) referenceFiles.push(normalizedPath)
      }

      referenceLines.push({
        path: normalizedPath,
        line: hit.line,
        preview: String(hit.preview || '').slice(0, 220),
        isDefinition: isDef
      })

      const affected = allAffectedFiles.get(normalizedPath) || {
        path: normalizedPath,
        affectedBy: [],
        referenceLines: [],
        fullPath
      }
      if (!affected.affectedBy.includes(symbol)) affected.affectedBy.push(symbol)
      affected.referenceLines.push({
        line: hit.line,
        preview: String(hit.preview || '').slice(0, 180),
        symbol,
        isDefinition: isDef
      })
      allAffectedFiles.set(normalizedPath, affected)
    }

    if (isIpcChannel(symbol)) {
      ipcChannels.push(symbol)
    }

    const uniqueFiles = new Set([...definitionFiles, ...referenceFiles])
    const riskLevel = classifyRisk(referenceFiles.length, ipcChannels.length > 0, uniqueFiles.size)

    symbolResults.push({
      symbol,
      definitionFiles,
      referenceFiles,
      referenceCount: referenceFiles.length,
      ipcChannels,
      riskLevel
    })
  }

  const affectedFiles = [...allAffectedFiles.values()]
    .map(item => {
      const refCount = item.referenceLines.filter(r => !r.isDefinition).length
      const hasIpc = item.affectedBy.some(s => isIpcChannel(s))
      return {
        path: item.path,
        affectedBy: item.affectedBy,
        referenceLines: item.referenceLines.slice(0, 10),
        riskLevel: classifyRisk(refCount, hasIpc, item.affectedBy.length)
      }
    })
    .sort((a, b) => {
      const riskOrder = { high: 3, medium: 2, low: 1 }
      return (riskOrder[b.riskLevel] || 0) - (riskOrder[a.riskLevel] || 0)
    })
    .slice(0, MAX_AFFECTED_FILES)

  return {
    success: true,
    symbols: symbolResults,
    affectedFiles,
    totalAffectedFiles: allAffectedFiles.size
  }
}

// ===== 改动排序建议 =====

function extractImportDependencies(filePath, projectPath, allFiles) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath)
  if (!fs.existsSync(fullPath)) return []
  let content = ''
  try {
    content = fs.readFileSync(fullPath, 'utf8')
  } catch {
    return []
  }

  const deps = []
  const requirePattern = /require\s*\(\s*['"]\.\/?(.+?)['"]\s*\)/g
  const importPattern = /import\s+.*?from\s+['"]\.\/?(.+?)['"]/g
  let match

  for (const pattern of [requirePattern, importPattern]) {
    while ((match = pattern.exec(content)) !== null) {
      const imported = match[1].replace(/\.(js|mjs|cjs|ts|tsx)$/, '')
      for (const candidate of allFiles) {
        const candidateBase = candidate.replace(/\.(js|mjs|cjs|ts|tsx)$/, '')
        if (candidateBase.endsWith(imported) || imported.endsWith(path.basename(candidateBase))) {
          if (candidate !== filePath && !deps.includes(candidate)) {
            deps.push(candidate)
          }
        }
      }
    }
  }
  return deps
}

function suggestChangeOrder(input = {}) {
  const { projectPath, files = [], impactAnalysis } = input
  if (!projectPath || !files.length) {
    return { success: false, error: 'Missing projectPath or files' }
  }

  const filePaths = files.map(f => {
    const p = typeof f === 'string' ? f : f.path
    return normalizePath(p, projectPath)
  })

  const dependencyGraph = new Map()
  for (const file of filePaths) {
    const deps = extractImportDependencies(file, projectPath, filePaths)
    dependencyGraph.set(file, { dependencies: deps, dependents: [] })
  }

  for (const [file, info] of dependencyGraph) {
    for (const dep of info.dependencies) {
      const depInfo = dependencyGraph.get(dep)
      if (depInfo && !depInfo.dependents.includes(file)) {
        depInfo.dependents.push(file)
      }
    }
  }

  const specialOrder = (file) => {
    if (/schema/i.test(file)) return -100
    if (/config/i.test(file) || /constants?/i.test(file)) return -80
    if (/(ipc|channel)/i.test(file)) return -60
    if (/types?\.d?\.ts$/i.test(file)) return -50
    return 0
  }

  const ordered = [...filePaths].sort((a, b) => {
    const aInfo = dependencyGraph.get(a) || { dependents: [] }
    const bInfo = dependencyGraph.get(b) || { dependents: [] }
    const aSpecial = specialOrder(a)
    const bSpecial = specialOrder(b)
    if (aSpecial !== bSpecial) return aSpecial - bSpecial
    const aScore = aInfo.dependents.length - (aInfo.dependencies || []).length
    const bScore = bInfo.dependents.length - (bInfo.dependencies || []).length
    return bScore - aScore
  })

  const orderedFiles = ordered.map((file, index) => {
    const info = dependencyGraph.get(file) || { dependencies: [], dependents: [] }
    const original = files.find(f => {
      const p = typeof f === 'string' ? f : f.path
      return normalizePath(p, projectPath) === file
    })
    const action = typeof original === 'string' ? 'modify' : (original?.action || 'modify')
    let reason = ''
    if (info.dependents.length > 0 && info.dependencies.length === 0) {
      reason = 'Base module: depended on by others, should be modified first'
    } else if (info.dependencies.length > 0) {
      reason = `Depends on: ${info.dependencies.slice(0, 3).join(', ')}`
    } else if (specialOrder(file) < 0) {
      reason = 'Schema/config file: should be modified before implementation'
    } else {
      reason = 'No direct dependencies among changed files'
    }

    return {
      path: file,
      action,
      order: index + 1,
      reason,
      dependencies: info.dependencies || [],
      dependents: info.dependents || []
    }
  })

  return {
    success: true,
    orderedFiles,
    dependencyGraph: Object.fromEntries(
      [...dependencyGraph].map(([file, info]) => [file, info])
    )
  }
}

// ===== 验证报告 =====

function extractRemovedSymbols(changeSession, changedFiles) {
  const removed = []
  if (!changeSession?.files) return removed

  for (const [filePath, entry] of Object.entries(changeSession.files)) {
    const normalizedPath = normalizePath(filePath, '')
    if (changedFiles.length && !changedFiles.some(f => {
      const nf = normalizePath(f, '')
      return nf === normalizedPath || f === filePath
    })) continue

    if (entry.beforeContent && entry.afterContent) {
      const beforeSymbols = extractSymbolsFromText(entry.beforeContent)
      const afterSymbols = extractSymbolsFromText(entry.afterContent)
      const afterSet = new Set(afterSymbols)
      for (const sym of beforeSymbols) {
        if (!afterSet.has(sym) && sym.length >= 3) {
          removed.push({ symbol: sym, fromFile: normalizedPath || filePath })
        }
      }
    }
  }
  return removed.slice(0, 20)
}

function extractSymbolsFromText(text) {
  const symbols = new Set()
  if (!text || typeof text !== 'string') return [...symbols]
  const patterns = [
    /\b(?:function|class|async\s+function)\s+([A-Za-z_$][\w$]{2,})/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]{2,})\s*[:=]/g,
    /\b([A-Za-z_$][\w$]{2,})\s*[:=]\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/g
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const sym = match[1]
      if (sym && !/^(undefined|null|true|false|this|self|window|document|console|process|require|module|exports|return|import|export|default|from|new|typeof|instanceof|void|delete|in|of|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|async|await|yield)$/.test(sym)) {
        symbols.add(sym)
      }
    }
  }
  return [...symbols]
}

function shouldSkipSourceDir(name) {
  return /^(node_modules|\.git|dist|build|out|coverage|\.next|\.nuxt|vendor|tmp|temp)$/i.test(name)
}

function isRuntimeSourceFile(filePath) {
  return /\.(?:js|mjs|cjs|jsx|ts|tsx)$/i.test(filePath || '') && !/\.d\.ts$/i.test(filePath || '')
}

function listRuntimeSourceFiles(projectPath, limit = MAX_RUNTIME_SOURCE_FILES) {
  const files = []
  function walk(dir) {
    if (files.length >= limit) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= limit) return
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipSourceDir(entry.name)) walk(fullPath)
      } else if (entry.isFile() && isRuntimeSourceFile(fullPath)) {
        files.push(fullPath)
      }
    }
  }
  walk(projectPath)
  return files
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function getLineNumberAt(content, index) {
  if (!content || index <= 0) return 1
  let line = 1
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++
  }
  return line
}

function getLinePreview(content, index) {
  const start = content.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  const end = content.indexOf('\n', index)
  return content.slice(start, end === -1 ? content.length : end).trim().slice(0, 180)
}

function findBalancedBlock(content, openIndex, openChar = '{', closeChar = '}') {
  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i]
    const next = content[i + 1]
    if (lineComment) {
      if (ch === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        i++
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '/' && next === '/') {
      lineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) return { start: openIndex, end: i, text: content.slice(openIndex, i + 1) }
    }
  }
  return null
}

function splitTopLevelObjectEntries(objectText) {
  const body = String(objectText || '').replace(/^\s*\{/, '').replace(/\}\s*$/, '')
  const entries = []
  let start = 0
  let depth = 0
  let quote = null
  let escaped = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) {
      const entry = body.slice(start, i).trim()
      if (entry) entries.push(entry)
      start = i + 1
    }
  }
  const tail = body.slice(start).trim()
  if (tail) entries.push(tail)
  return entries
}

function extractObjectLiteralKeys(objectText) {
  const keys = new Set()
  for (const entry of splitTopLevelObjectEntries(objectText)) {
    const text = entry.trim()
    const quoted = text.match(/^['"`]([^'"`]+)['"`]\s*:/)
    const named = text.match(/^([A-Za-z_$][\w$]*)\s*:/)
    const shorthand = text.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/)
    const method = text.match(/^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/)
    const key = quoted?.[1] || named?.[1] || method?.[1] || shorthand?.[1]
    if (key && !/^(if|for|while|switch|return|function|class|const|let|var)$/.test(key)) {
      keys.add(key)
    }
  }
  return [...keys]
}

function ensureRuntimeExport(exportsByName, moduleName) {
  if (!exportsByName.has(moduleName)) {
    exportsByName.set(moduleName, { module: moduleName, methods: new Set(), files: new Set(), definitions: [] })
  }
  return exportsByName.get(moduleName)
}

function collectWindowApiExports(projectPath, sourceFiles) {
  const exportsByName = new Map()
  for (const filePath of sourceFiles) {
    const content = readTextSafe(filePath)
    if (!content) continue
    const relativePath = normalizePath(filePath, projectPath)
    let match

    const objectPattern = /window\.([A-Za-z_$][\w$]*)\s*=\s*\{/g
    while ((match = objectPattern.exec(content)) !== null) {
      const openIndex = content.indexOf('{', match.index)
      const block = findBalancedBlock(content, openIndex)
      if (!block) continue
      const entry = ensureRuntimeExport(exportsByName, match[1])
      entry.files.add(relativePath)
      for (const key of extractObjectLiteralKeys(block.text)) entry.methods.add(key)
      entry.definitions.push({ path: relativePath, line: getLineNumberAt(content, match.index), kind: 'window-object' })
      objectPattern.lastIndex = block.end + 1
    }

    const assignPattern = /Object\.assign\s*\(\s*window\.([A-Za-z_$][\w$]*)\s*,\s*\{/g
    while ((match = assignPattern.exec(content)) !== null) {
      const openIndex = content.indexOf('{', match.index)
      const block = findBalancedBlock(content, openIndex)
      if (!block) continue
      const entry = ensureRuntimeExport(exportsByName, match[1])
      entry.files.add(relativePath)
      for (const key of extractObjectLiteralKeys(block.text)) entry.methods.add(key)
      entry.definitions.push({ path: relativePath, line: getLineNumberAt(content, match.index), kind: 'object-assign' })
      assignPattern.lastIndex = block.end + 1
    }

    const methodPattern = /window\.([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"`]([^'"`]+)['"`]\s*\])\s*=/g
    while ((match = methodPattern.exec(content)) !== null) {
      const moduleName = match[1]
      const methodName = match[2] || match[3]
      if (!methodName) continue
      const entry = ensureRuntimeExport(exportsByName, moduleName)
      entry.files.add(relativePath)
      entry.methods.add(methodName)
      entry.definitions.push({ path: relativePath, line: getLineNumberAt(content, match.index), kind: 'window-property' })
    }
  }
  return exportsByName
}

function collectWindowAliases(content) {
  const aliases = new Map()
  const aliasPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*window\.([A-Za-z_$][\w$]*)\b/g
  let match
  while ((match = aliasPattern.exec(content)) !== null) {
    aliases.set(match[1], match[2])
  }
  return aliases
}

function isGuardedRuntimeCall(preview, objectName, methodName) {
  const escapedObject = objectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedMethod = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escapedObject}\\s*(?:\\?\\.|\\.)\\s*${escapedMethod}\\s*\\?\\.`).test(preview) ||
    new RegExp(`typeof\\s+${escapedObject}\\s*\\.\\s*${escapedMethod}\\s*={0,2}\\s*['"]function['"]`).test(preview) ||
    new RegExp(`${escapedObject}\\s*\\.\\s*${escapedMethod}\\s*&&`).test(preview)
}

function checkRuntimeContracts(projectPath, changedFiles, options = {}) {
  const deep = options.deep === true
  const allSourceFiles = listRuntimeSourceFiles(projectPath)
  const exportsByName = collectWindowApiExports(projectPath, allSourceFiles)
  const changedSet = new Set(changedFiles.map(file => normalizePath(file, projectPath)))
  const changedModules = new Set()
  for (const [moduleName, api] of exportsByName) {
    if ([...api.files].some(file => changedSet.has(file))) changedModules.add(moduleName)
  }

  const callerFiles = allSourceFiles.filter(filePath => {
    const normalized = normalizePath(filePath, projectPath)
    return deep || changedSet.has(normalized) || changedModules.size > 0
  })
  const issues = []
  const checkedCalls = []

  for (const filePath of callerFiles) {
    const content = readTextSafe(filePath)
    if (!content) continue
    const normalizedPath = normalizePath(filePath, projectPath)
    const aliases = collectWindowAliases(content)

    let directMatch
    const directPattern = /window\.([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g
    while ((directMatch = directPattern.exec(content)) !== null) {
      const moduleName = directMatch[1]
      const methodName = directMatch[2]
      const api = exportsByName.get(moduleName)
      if (!api) continue
      const line = getLineNumberAt(content, directMatch.index)
      const preview = getLinePreview(content, directMatch.index)
      if (isGuardedRuntimeCall(preview, `window.${moduleName}`, methodName)) continue
      checkedCalls.push({ module: moduleName, method: methodName, path: normalizedPath, line })
      if (!api.methods.has(methodName)) {
        issues.push({
          type: 'missing-window-api-method',
          severity: 'error',
          module: moduleName,
          method: methodName,
          caller: normalizedPath,
          line,
          preview,
          providerFiles: [...api.files],
          availableMethods: [...api.methods].sort().slice(0, 40),
          message: `window.${moduleName}.${methodName} is called but no exported method was found`
        })
      }
    }

    for (const [alias, moduleName] of aliases) {
      const api = exportsByName.get(moduleName)
      if (!api) continue
      const aliasPattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g')
      let match
      while ((match = aliasPattern.exec(content)) !== null) {
        const methodName = match[1]
        if (methodName === 'constructor') continue
        const line = getLineNumberAt(content, match.index)
        const preview = getLinePreview(content, match.index)
        if (isGuardedRuntimeCall(preview, alias, methodName)) continue
        checkedCalls.push({ module: moduleName, alias, method: methodName, path: normalizedPath, line })
        if (!api.methods.has(methodName)) {
          issues.push({
            type: 'missing-window-api-method',
            severity: 'error',
            module: moduleName,
            alias,
            method: methodName,
            caller: normalizedPath,
            line,
            preview,
            providerFiles: [...api.files],
            availableMethods: [...api.methods].sort().slice(0, 40),
            message: `${alias}.${methodName} is called as window.${moduleName}, but no exported method was found`
          })
        }
      }
    }
  }

  return {
    skippedDeepScan: !deep,
    checkedCalls: checkedCalls.length,
    issues,
    modules: [...exportsByName.values()].map(api => ({
      module: api.module,
      files: [...api.files],
      methods: [...api.methods].sort()
    }))
  }
}

function resolveRelativeImport(projectPath, fromFile, request) {
  if (!request || !request.startsWith('.')) return null
  const baseDir = path.dirname(fromFile)
  const raw = path.resolve(baseDir, request)
  const candidates = [
    raw,
    `${raw}.js`,
    `${raw}.mjs`,
    `${raw}.cjs`,
    `${raw}.jsx`,
    `${raw}.ts`,
    `${raw}.tsx`,
    path.join(raw, 'index.js'),
    path.join(raw, 'index.ts'),
    path.join(raw, 'index.tsx')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { found: true, path: candidate }
  }
  return { found: false, expected: path.relative(projectPath, raw).replace(/\\/g, '/') }
}

function extractNamedExports(content) {
  const names = new Set()
  if (!content) return names
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bexports\.([A-Za-z_$][\w$]*)\s*=/g
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) names.add(match[1])
    }
  }

  let match
  const namedExportPattern = /\bexport\s*\{([^}]+)\}/g
  while ((match = namedExportPattern.exec(content)) !== null) {
    for (const rawPart of match[1].split(',')) {
      const part = rawPart.trim()
      if (!part) continue
      const alias = part.match(/^(?:[A-Za-z_$][\w$]*\s+as\s+)?([A-Za-z_$][\w$]*)$/)
      if (alias?.[1]) names.add(alias[1])
    }
  }

  const commonObjectPattern = /\bmodule\.exports\s*=\s*\{/g
  while ((match = commonObjectPattern.exec(content)) !== null) {
    const openIndex = content.indexOf('{', match.index)
    const block = findBalancedBlock(content, openIndex)
    if (!block) continue
    for (const key of extractObjectLiteralKeys(block.text)) names.add(key)
    commonObjectPattern.lastIndex = block.end + 1
  }
  return names
}

function parseNamedImportSpecifiers(specifierText) {
  const names = []
  for (const rawPart of String(specifierText || '').split(',')) {
    const part = rawPart.trim()
    if (!part || part.startsWith('type ')) continue
    const normalized = part.replace(/^type\s+/, '')
    const match = normalized.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+[A-Za-z_$][\w$]*)?$/)
    if (match?.[1]) names.push(match[1])
  }
  return names
}

function checkImportLinks(projectPath, changedFiles, options = {}) {
  const issues = []
  const deep = options.deep === true
  const sourceFiles = deep ? listRuntimeSourceFiles(projectPath) : []
  const changedSet = new Set(changedFiles.map(file => normalizePath(file, projectPath)))
  const filesToCheck = new Set(changedFiles)

  for (const filePath of sourceFiles) {
    if (changedSet.has(normalizePath(filePath, projectPath))) continue
    const content = readTextSafe(filePath)
    if (!content) continue
    const importPattern = /\bimport\s+(?:[^'"`]*?\s+from\s+)?['"`]([^'"`]+)['"`]|\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g
    let match
    while ((match = importPattern.exec(content)) !== null) {
      const request = match[1] || match[2]
      if (!request || !request.startsWith('.')) continue
      const resolved = resolveRelativeImport(projectPath, filePath, request)
      if (resolved?.found && changedSet.has(normalizePath(resolved.path, projectPath))) {
        filesToCheck.add(filePath)
        break
      }
    }
  }

  for (const filePath of filesToCheck) {
    if (!isRuntimeSourceFile(filePath)) continue
    const content = readTextSafe(filePath)
    if (!content) continue
    const normalizedPath = normalizePath(filePath, projectPath)
    const patterns = [
      /\bimport\s+(?:[^'"`]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g,
      /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g
    ]
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const request = match[1]
        if (!request || !request.startsWith('.')) continue
        const resolved = resolveRelativeImport(projectPath, filePath, request)
        if (resolved && !resolved.found) {
          issues.push({
            type: 'missing-relative-import',
            severity: 'error',
            path: normalizedPath,
            line: getLineNumberAt(content, match.index),
            request,
            expected: resolved.expected,
            preview: getLinePreview(content, match.index),
            message: `Relative import '${request}' does not resolve`
          })
        }
      }
    }

    const namedImportPattern = /\bimport\s*\{([^}]+)\}\s*from\s*['"`]([^'"`]+)['"`]/g
    let namedMatch
    while ((namedMatch = namedImportPattern.exec(content)) !== null) {
      const request = namedMatch[2]
      if (!request || !request.startsWith('.')) continue
      const resolved = resolveRelativeImport(projectPath, filePath, request)
      if (!resolved?.found || !isRuntimeSourceFile(resolved.path)) continue
      const exported = extractNamedExports(readTextSafe(resolved.path))
      for (const importedName of parseNamedImportSpecifiers(namedMatch[1])) {
        if (!exported.has(importedName)) {
          issues.push({
            type: 'missing-named-export',
            severity: 'error',
            path: normalizedPath,
            line: getLineNumberAt(content, namedMatch.index),
            request,
            importedName,
            provider: normalizePath(resolved.path, projectPath),
            availableExports: [...exported].sort().slice(0, 40),
            preview: getLinePreview(content, namedMatch.index),
            message: `Named import '${importedName}' is not exported by '${request}'`
          })
        }
      }
    }
  }
  return { issues, skippedDeepScan: !deep }
}

async function generateVerifyReport(input = {}) {
  const { projectPath, changedFiles = [], changeSession } = input
  const deep = input.deep === true || input.scope === 'deep' || input.full === true
  if (!projectPath) {
    return { success: false, error: 'Missing projectPath' }
  }

  const resolvedFiles = changedFiles.map(f => {
    const abs = path.isAbsolute(f) ? f : path.join(projectPath, f)
    return abs
  }).filter(f => fs.existsSync(f))

  const syntaxResults = []
  let syntaxPassed = 0
  let syntaxFailed = 0
  let syntaxUnknown = 0

  for (const filePath of resolvedFiles) {
    try {
      const result = syntaxChecker.checkFileSyntax(filePath)
      syntaxResults.push({
        path: normalizePath(filePath, projectPath),
        valid: result.valid,
        language: result.language,
        errors: result.errors || [],
        warnings: result.warnings || [],
        secondary_check: result.secondary_check,
        suppressed_errors: result.suppressed_errors || undefined,
        primary_errors: result.primary_errors || undefined
      })
      if (result.valid === true) syntaxPassed++
      else if (result.valid === false) syntaxFailed++
      else syntaxUnknown++
    } catch (error) {
      syntaxUnknown++
      syntaxResults.push({
        path: normalizePath(filePath, projectPath),
        valid: null,
        language: 'unknown',
        error_type: 'syntax_checker_internal_error',
        errors: [{ message: error.message }],
        warnings: ['Syntax checker failed internally; verify this file with check_syntax before treating it as a code syntax error.']
      })
    }
  }

  const activeSession = changeSession || (input.projectId ? changeSessions.getActiveSession(input.projectId) : null)
  const normalizedChanged = changedFiles.map(f => normalizePath(f, projectPath))
  const removedSymbols = extractRemovedSymbols(activeSession, normalizedChanged)
  const staleReferences = []

  for (const { symbol, fromFile } of removedSymbols) {
    const grepResults = await grepForSymbol(projectPath, symbol, 10)
    for (const hit of grepResults) {
      const hitPath = normalizePath(hit.path, projectPath)
      if (hitPath === fromFile) continue
      if (hit.preview && isDefinitionLine(hit.preview, symbol)) continue
      staleReferences.push({
        symbol,
        staleIn: hitPath,
        line: hit.line,
        preview: String(hit.preview || '').slice(0, 180),
        severity: 'warning'
      })
    }
  }

  const ipcConsistency = checkIpcConsistency({ projectPath, changedFiles: resolvedFiles, sourceFiles: listRuntimeSourceFiles(projectPath) })
  const runtimeContracts = checkRuntimeContracts(projectPath, resolvedFiles, { deep })
  const importLinks = checkImportLinks(projectPath, resolvedFiles, { deep })

  const hasErrors = syntaxFailed > 0
  const hasSyntaxUnknown = syntaxUnknown > 0
  const hasStaleRefs = staleReferences.length > 0
  const hasIpcIssues = ipcConsistency.issues > 0
  const hasRuntimeContractErrors = runtimeContracts.issues.some(issue => issue.severity === 'error')
  const hasImportErrors = importLinks.issues.some(issue => issue.severity === 'error')
  let overallStatus = 'clean'
  if (hasErrors || hasRuntimeContractErrors || hasImportErrors || staleReferences.some(r => r.severity === 'error')) overallStatus = 'errors'
  else if (hasSyntaxUnknown || hasStaleRefs || hasIpcIssues || syntaxResults.some(r => r.warnings?.length)) overallStatus = 'warnings'

  const summaryParts = []
  summaryParts.push(`Syntax: ${syntaxPassed} passed, ${syntaxFailed} failed${syntaxUnknown ? `, ${syntaxUnknown} unknown` : ''}`)
  if (hasStaleRefs) summaryParts.push(`${staleReferences.length} stale reference(s) detected`)
  if (hasIpcIssues) summaryParts.push(`${ipcConsistency.issues} IPC consistency issue(s)`)
  if (runtimeContracts.issues.length) summaryParts.push(`${runtimeContracts.issues.length} runtime contract issue(s)`)
  if (importLinks.issues.length) summaryParts.push(`${importLinks.issues.length} import link issue(s)`)
  if (overallStatus === 'clean') summaryParts.push('All checks passed')

  return {
    success: true,
    syntaxCheck: {
      passed: syntaxPassed,
      failed: syntaxFailed,
      unknown: syntaxUnknown,
      results: syntaxResults
    },
    staleReferences,
    ipcConsistency,
    runtimeContracts,
    importLinks,
    verificationDepth: deep ? 'deep' : 'fast',
    overallStatus,
    summary: summaryParts.join('; ')
  }
}

async function generateVerifyReportAsync(input = {}) {
  const { projectPath, changedFiles = [], changeSession } = input
  const deep = input.deep === true || input.scope === 'deep' || input.full === true
  if (!projectPath) {
    return { success: false, error: 'Missing projectPath' }
  }

  const resolvedFiles = changedFiles.map(f => {
    const abs = path.isAbsolute(f) ? f : path.join(projectPath, f)
    return abs
  }).filter(f => fs.existsSync(f))

  const syntaxResults = []
  let syntaxPassed = 0
  let syntaxFailed = 0
  let syntaxUnknown = 0

  for (const filePath of resolvedFiles) {
    try {
      const result = await syntaxChecker.checkFileSyntaxAsync(filePath)
      syntaxResults.push({
        path: normalizePath(filePath, projectPath),
        valid: result.valid,
        language: result.language,
        errors: result.errors || [],
        warnings: result.warnings || [],
        secondary_check: result.secondary_check,
        suppressed_errors: result.suppressed_errors || undefined,
        primary_errors: result.primary_errors || undefined
      })
      if (result.valid === true) syntaxPassed++
      else if (result.valid === false) syntaxFailed++
      else syntaxUnknown++
    } catch (error) {
      syntaxUnknown++
      syntaxResults.push({
        path: normalizePath(filePath, projectPath),
        valid: null,
        language: 'unknown',
        error_type: 'syntax_checker_internal_error',
        errors: [{ message: error.message }],
        warnings: ['Syntax checker failed internally; verify this file with check_syntax before treating it as a code syntax error.']
      })
    }
  }

  const activeSession = changeSession || (input.projectId ? changeSessions.getActiveSession(input.projectId) : null)
  const normalizedChanged = changedFiles.map(f => normalizePath(f, projectPath))
  const removedSymbols = extractRemovedSymbols(activeSession, normalizedChanged)
  const staleReferences = []

  for (const { symbol, fromFile } of removedSymbols) {
    const grepResults = await grepForSymbol(projectPath, symbol, 10)
    for (const hit of grepResults) {
      const hitPath = normalizePath(hit.path, projectPath)
      if (hitPath === fromFile) continue
      if (hit.preview && isDefinitionLine(hit.preview, symbol)) continue
      staleReferences.push({
        symbol,
        staleIn: hitPath,
        line: hit.line,
        preview: String(hit.preview || '').slice(0, 180),
        severity: 'warning'
      })
    }
  }

  const ipcConsistency = checkIpcConsistency({ projectPath, changedFiles: resolvedFiles, sourceFiles: listRuntimeSourceFiles(projectPath) })
  const runtimeContracts = checkRuntimeContracts(projectPath, resolvedFiles, { deep })
  const importLinks = checkImportLinks(projectPath, resolvedFiles, { deep })

  const hasErrors = syntaxFailed > 0
  const hasSyntaxUnknown = syntaxUnknown > 0
  const hasStaleRefs = staleReferences.length > 0
  const hasIpcIssues = ipcConsistency.issues > 0
  const hasRuntimeContractErrors = runtimeContracts.issues.some(issue => issue.severity === 'error')
  const hasImportErrors = importLinks.issues.some(issue => issue.severity === 'error')
  let overallStatus = 'clean'
  if (hasErrors || hasRuntimeContractErrors || hasImportErrors || staleReferences.some(r => r.severity === 'error')) overallStatus = 'errors'
  else if (hasSyntaxUnknown || hasStaleRefs || hasIpcIssues || syntaxResults.some(r => r.warnings?.length)) overallStatus = 'warnings'

  const summaryParts = []
  summaryParts.push(`Syntax: ${syntaxPassed} passed, ${syntaxFailed} failed${syntaxUnknown ? `, ${syntaxUnknown} unknown` : ''}`)
  if (hasStaleRefs) summaryParts.push(`${staleReferences.length} stale reference(s) detected`)
  if (hasIpcIssues) summaryParts.push(`${ipcConsistency.issues} IPC consistency issue(s)`)
  if (runtimeContracts.issues.length) summaryParts.push(`${runtimeContracts.issues.length} runtime contract issue(s)`)
  if (importLinks.issues.length) summaryParts.push(`${importLinks.issues.length} import link issue(s)`)
  if (overallStatus === 'clean') summaryParts.push('All checks passed')

  return {
    success: true,
    syntaxCheck: {
      passed: syntaxPassed,
      failed: syntaxFailed,
      unknown: syntaxUnknown,
      results: syntaxResults
    },
    staleReferences,
    ipcConsistency,
    runtimeContracts,
    importLinks,
    verificationDepth: deep ? 'deep' : 'fast',
    overallStatus,
    summary: summaryParts.join('; ')
  }
}

module.exports = {
  analyzeImpact,
  suggestChangeOrder,
  generateVerifyReport,
  generateVerifyReportAsync,
  normalizePath
}
