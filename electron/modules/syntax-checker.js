/**
 * 单文件语法验证模块
 * 支持 JS/HTML/CSS/JSON/Python，供 check_syntax 工具和 edit_file 增强使用
 */

const fs = require('fs')
const path = require('path')
const { execFile, spawnSync } = require('child_process')
const esbuild = require('esbuild')

const MAX_FILE_BYTES = 2 * 1024 * 1024
const CHECK_TIMEOUT_MS = 3000

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const CSS_EXTENSIONS = new Set(['.css', '.scss', '.less'])
const PYTHON_EXTENSIONS = new Set(['.py'])

function stripProcessControlCharacters(text = '') {
  return String(text ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

function getNodeCheckExecOptions(options = {}) {
  return {
    ...options,
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      ...(options.env || {}),
      ELECTRON_RUN_AS_NODE: '1'
    }
  }
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (JS_EXTENSIONS.has(ext)) return 'javascript'
  if (HTML_EXTENSIONS.has(ext)) return 'html'
  if (CSS_EXTENSIONS.has(ext)) return 'css'
  if (ext === '.json') return 'json'
  if (PYTHON_EXTENSIONS.has(ext)) return 'python'
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  return 'unknown'
}

function getJavaScriptLoader(filePath = '') {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.ts') return 'ts'
  if (ext === '.tsx') return 'tsx'
  if (ext === '.jsx') return 'jsx'
  return 'js'
}

function canUseNodeCheck(filePath = '') {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.js' || ext === '.mjs' || ext === '.cjs'
}

function isProbablyCheckerInfrastructureError(errorOrResult) {
  const text = [
    errorOrResult?.message,
    errorOrResult?.error?.message,
    errorOrResult?.error?.code,
    errorOrResult?.error?.signal,
    errorOrResult?.stderr,
    ...(Array.isArray(errorOrResult?.errors) ? errorOrResult.errors.map(item => item?.message || item?.text) : [])
  ].filter(Boolean).join('\n')
  return /EPIPE|ETIMEDOUT|timeout|timed out|SIGTERM|service is no longer running|write EPIPE|closed pipe|broken pipe|esbuild service|The service was stopped|Cannot start service/i.test(text)
}

function parseEsbuildErrors(error) {
  const rawErrors = Array.isArray(error?.errors) && error.errors.length ? error.errors : [error]
  return rawErrors.map(item => {
    const location = item?.location || {}
    return {
      line: Number.isFinite(location.line) ? location.line : null,
      column: Number.isFinite(location.column) ? location.column + 1 : null,
      message: stripProcessControlCharacters(item?.text || item?.message || 'JavaScript parse failed').trim(),
      lineText: location.lineText ? stripProcessControlCharacters(location.lineText).trim() : undefined
    }
  })
}

function parseJavaScriptContent(content = '', filePath = '') {
  try {
    esbuild.transformSync(String(content || ''), {
      loader: getJavaScriptLoader(filePath),
      sourcefile: filePath,
      logLevel: 'silent',
      target: 'esnext',
      format: 'esm',
      sourcemap: false
    })
    return { valid: true, errors: [], warnings: [] }
  } catch (error) {
    return { valid: false, errors: parseEsbuildErrors(error), warnings: [] }
  }
}

async function parseJavaScriptContentAsync(content = '', filePath = '') {
  try {
    await esbuild.transform(String(content || ''), {
      loader: getJavaScriptLoader(filePath),
      sourcefile: filePath,
      logLevel: 'silent',
      target: 'esnext',
      format: 'esm',
      sourcemap: false
    })
    return { valid: true, errors: [], warnings: [] }
  } catch (error) {
    return { valid: false, errors: parseEsbuildErrors(error), warnings: [] }
  }
}

function checkJavaScript(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const esbuildResult = parseJavaScriptContent(content, filePath)
    if (esbuildResult.valid || !canUseNodeCheck(filePath)) return esbuildResult

    const nodeResult = checkJavaScriptWithNode(filePath)
    if (nodeResult.valid) {
      const warnings = isProbablyCheckerInfrastructureError(esbuildResult)
        ? ['esbuild syntax checker failed internally, but node --check passed. Treating this as a diagnostic warning, not a syntax error.']
        : ['esbuild reported a parse issue, but node --check passed. Treating syntax as valid and keeping esbuild output as a warning.']
      return {
        valid: true,
        errors: [],
        warnings,
        secondary_check: 'node --check',
        suppressed_errors: esbuildResult.errors || []
      }
    }
    if (nodeResult.valid === null && isProbablyCheckerInfrastructureError(nodeResult)) {
      return {
        valid: null,
        errors: [],
        warnings: [
          'JavaScript syntax checker could not finish because its internal process failed. Re-run check_syntax or node --check before treating this as a code syntax error.'
        ],
        secondary_check: 'node --check',
        suppressed_errors: esbuildResult.errors || [],
        checker_error: nodeResult.errors?.[0]?.message || 'node --check unavailable'
      }
    }
    return {
      ...nodeResult,
      secondary_check: 'node --check',
      primary_errors: esbuildResult.errors || []
    }
  } catch (error) {
    return { valid: false, errors: [{ message: error.message }], warnings: [] }
  }
}

function execFileChecked(command, args = [], options = {}) {
  return new Promise(resolve => {
    execFile(command, args, {
      encoding: 'utf8',
      timeout: CHECK_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
      maxBuffer: 512 * 1024,
      ...options
    }, (error, stdout = '', stderr = '') => {
      const status = error
        ? (typeof error.code === 'number' ? error.code : 1)
        : 0
      const infrastructureError = error && (
        typeof error.code !== 'number' ||
        error.killed ||
        error.signal
      )
      resolve({
        status,
        error: infrastructureError ? error : null,
        command_error: error || null,
        stdout: stripProcessControlCharacters(stdout),
        stderr: stripProcessControlCharacters(stderr)
      })
    })
  })
}

async function checkJavaScriptAsync(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8')
    const esbuildResult = await parseJavaScriptContentAsync(content, filePath)
    if (esbuildResult.valid || !canUseNodeCheck(filePath)) return esbuildResult

    const nodeResult = await checkJavaScriptWithNodeAsync(filePath)
    if (nodeResult.valid) {
      const warnings = isProbablyCheckerInfrastructureError(esbuildResult)
        ? ['esbuild syntax checker failed internally, but node --check passed. Treating this as a diagnostic warning, not a syntax error.']
        : ['esbuild reported a parse issue, but node --check passed. Treating syntax as valid and keeping esbuild output as a warning.']
      return {
        valid: true,
        errors: [],
        warnings,
        secondary_check: 'node --check',
        suppressed_errors: esbuildResult.errors || []
      }
    }
    if (nodeResult.valid === null && isProbablyCheckerInfrastructureError(nodeResult)) {
      return {
        valid: null,
        errors: [],
        warnings: [
          'JavaScript syntax checker could not finish because its internal process failed. Re-run check_syntax or node --check before treating this as a code syntax error.'
        ],
        secondary_check: 'node --check',
        suppressed_errors: esbuildResult.errors || [],
        checker_error: nodeResult.errors?.[0]?.message || 'node --check unavailable'
      }
    }
    return {
      ...nodeResult,
      secondary_check: 'node --check',
      primary_errors: esbuildResult.errors || []
    }
  } catch (error) {
    return { valid: false, errors: [{ message: stripProcessControlCharacters(error.message) }], warnings: [] }
  }
}

function parseNodeCheckErrors(stderr) {
  const errors = []
  const safeStderr = stripProcessControlCharacters(stderr)
  const lines = safeStderr.split(/\r?\n/).filter(Boolean)
  let pendingLocation = null
  for (const line of lines) {
    const fileLocationMatch = line.match(/^(?:[A-Za-z]:)?[^:]+:(\d+)(?::(\d+))?$/)
    if (fileLocationMatch) {
      pendingLocation = {
        line: Number(fileLocationMatch[1]),
        column: fileLocationMatch[2] ? Number(fileLocationMatch[2]) : null
      }
      continue
    }
    const syntaxMatch = line.match(/SyntaxError:\s*(.+)/i)
    if (syntaxMatch) {
      const locationMatch = line.match(/:(\d+)(?::(\d+))?/)
      errors.push({
        line: locationMatch ? Number(locationMatch[1]) : pendingLocation?.line || null,
        column: locationMatch && locationMatch[2] ? Number(locationMatch[2]) : pendingLocation?.column || null,
        message: stripProcessControlCharacters(syntaxMatch[1]).trim()
      })
      continue
    }
    const referenceMatch = line.match(/ReferenceError:\s*(.+)/i)
    if (referenceMatch) {
      errors.push({ message: referenceMatch[1].trim() })
      continue
    }
    const genericMatch = line.match(/^(?:Error|SyntaxError|TypeError|RangeError):\s*(.+)/i)
    if (genericMatch) {
      errors.push({ message: genericMatch[1].trim() })
    }
  }
  if (!errors.length && safeStderr.trim()) {
    errors.push({ message: safeStderr.trim().split(/\r?\n/).slice(0, 3).join(' ') })
  }
  return errors
}

function checkJavaScriptWithNode(filePath) {
  try {
    const result = spawnSync(process.execPath, ['--check', filePath], {
      ...getNodeCheckExecOptions(),
      encoding: 'utf8',
      timeout: CHECK_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 512 * 1024
    })
    const stderr = stripProcessControlCharacters(result.stderr || result.error?.message || '')
    if (result.error) {
      return {
        valid: null,
        errors: [{ message: stderr || stripProcessControlCharacters(result.error.message) }],
        warnings: ['node --check did not complete; treating this as checker infrastructure uncertainty, not a syntax failure.'],
        error: {
          message: stripProcessControlCharacters(result.error.message),
          code: result.error.code,
          signal: result.signal
        },
        stderr
      }
    }
    if (result.status === 0) return { valid: true, errors: [], warnings: [] }
    return {
      valid: false,
      errors: parseNodeCheckErrors(stderr),
      warnings: []
    }
  } catch (error) {
    return {
      valid: null,
      errors: [{ message: stripProcessControlCharacters(error.message) }],
      warnings: ['node --check was unavailable for secondary JavaScript syntax verification']
    }
  }
}

async function checkJavaScriptWithNodeAsync(filePath) {
  const result = await execFileChecked(process.execPath, ['--check', filePath], getNodeCheckExecOptions())
  const stderr = stripProcessControlCharacters(result.stderr || result.error?.message || '')
  if (result.error) {
    return {
      valid: null,
      errors: [{ message: stderr || stripProcessControlCharacters(result.error.message) }],
      warnings: ['node --check did not complete; treating this as checker infrastructure uncertainty, not a syntax failure.'],
      error: {
        message: stripProcessControlCharacters(result.error.message),
        code: result.error.code,
        signal: result.error.signal
      },
      stderr
    }
  }
  if (result.status === 0) return { valid: true, errors: [], warnings: [] }
  return {
    valid: false,
    errors: parseNodeCheckErrors(stderr),
    warnings: []
  }
}

function addEmbeddedScriptEndWarnings(rawContent = '', warnings = []) {
  const lines = String(rawContent || '').split(/\r\n|\r|\n/)
  let insideInlineScript = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!insideInlineScript && /<script\b/i.test(line) && !/\bsrc\s*=/i.test(line)) {
      insideInlineScript = !/<\/script>/i.test(line)
      continue
    }
    if (!insideInlineScript) continue
    if (/<\/script>/i.test(line)) {
      if (!/^\s*<\/script>\s*;?\s*$/.test(line)) {
        warnings.push({
          line: index + 1,
          message: 'Possible literal </script> inside an inline script string/template. Escape it as <\\/script> or split the string.'
        })
      }
      insideInlineScript = false
    }
  }
}

function checkHtml(filePath) {
  const rawContent = fs.readFileSync(filePath, 'utf8')
  const content = rawContent
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const errors = []
  const warnings = []
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ])
  const stack = []
  const tagPattern = /<\/?([a-zA-Z][\w-]*)[^>]*?(\/?)\s*>/g
  let match

  while ((match = tagPattern.exec(content)) !== null) {
    const fullMatch = match[0]
    const tagName = match[1].toLowerCase()
    const selfClosing = match[2] === '/'
    if (voidElements.has(tagName) || selfClosing) continue
    if (fullMatch.startsWith('<!')) continue
    if (fullMatch.startsWith('</')) {
      const expected = stack.pop()
      if (!expected) {
        errors.push({ message: `Unexpected closing tag </${tagName}> without matching opening tag` })
      } else if (expected !== tagName) {
        errors.push({ message: `Mismatched tag: expected </${expected}> but found </${tagName}>` })
        stack.push(expected)
      }
    } else {
      stack.push(tagName)
    }
  }

  for (const unclosed of stack) {
    errors.push({ message: `Unclosed tag: <${unclosed}>` })
  }

  const openScripts = (rawContent.match(/<script\b[^>]*>/gi) || []).length
  const closeScripts = (rawContent.match(/<\/script>/gi) || []).length
  if (openScripts !== closeScripts) {
    warnings.push('Possible unclosed <script> block detected')
  }
  addEmbeddedScriptEndWarnings(rawContent, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

function checkHtmlContent(rawContent = '') {
  const content = rawContent
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const errors = []
  const warnings = []
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ])
  const stack = []
  const tagPattern = /<\/?([a-zA-Z][\w-]*)[^>]*?(\/?)\s*>/g
  let match

  while ((match = tagPattern.exec(content)) !== null) {
    const fullMatch = match[0]
    const tagName = match[1].toLowerCase()
    const selfClosing = match[2] === '/'
    if (voidElements.has(tagName) || selfClosing) continue
    if (fullMatch.startsWith('<!')) continue
    if (fullMatch.startsWith('</')) {
      const expected = stack.pop()
      if (!expected) {
        errors.push({ message: `Unexpected closing tag </${tagName}> without matching opening tag` })
      } else if (expected !== tagName) {
        errors.push({ message: `Mismatched tag: expected </${expected}> but found </${tagName}>` })
        stack.push(expected)
      }
    } else {
      stack.push(tagName)
    }
  }

  for (const unclosed of stack) {
    errors.push({ message: `Unclosed tag: <${unclosed}>` })
  }

  const openScripts = (rawContent.match(/<script\b[^>]*>/gi) || []).length
  const closeScripts = (rawContent.match(/<\/script>/gi) || []).length
  if (openScripts !== closeScripts) {
    warnings.push('Possible unclosed <script> block detected')
  }
  addEmbeddedScriptEndWarnings(rawContent, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

function checkCss(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const errors = []
  const warnings = []
  let braceDepth = 0
  let parenDepth = 0
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
    for (const char of stripped) {
      if (char === '{') braceDepth++
      else if (char === '}') {
        braceDepth--
        if (braceDepth < 0) {
          errors.push({ line: i + 1, message: 'Unexpected closing brace }' })
          braceDepth = 0
        }
      } else if (char === '(') parenDepth++
      else if (char === ')') {
        parenDepth--
        if (parenDepth < 0) parenDepth = 0
      }
    }
  }

  if (braceDepth > 0) {
    errors.push({ message: `Unbalanced braces: ${braceDepth} unclosed opening brace(s)` })
  }
  if (parenDepth > 0) {
    warnings.push(`${parenDepth} unclosed parenthesis(es)`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

function checkCssContent(content = '') {
  const errors = []
  const warnings = []
  let braceDepth = 0
  let parenDepth = 0
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
    for (const char of stripped) {
      if (char === '{') braceDepth++
      else if (char === '}') {
        braceDepth--
        if (braceDepth < 0) {
          errors.push({ line: i + 1, message: 'Unexpected closing brace }' })
          braceDepth = 0
        }
      } else if (char === '(') parenDepth++
      else if (char === ')') {
        parenDepth--
        if (parenDepth < 0) parenDepth = 0
      }
    }
  }

  if (braceDepth > 0) {
    errors.push({ message: `Unbalanced braces: ${braceDepth} unclosed opening brace(s)` })
  }
  if (parenDepth > 0) {
    warnings.push(`${parenDepth} unclosed parenthesis(es)`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

function checkJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  try {
    JSON.parse(content)
    return { valid: true, errors: [], warnings: [] }
  } catch (error) {
    const lineMatch = error.message.match(/position\s+(\d+)/i)
    let line = null
    if (lineMatch) {
      const position = Number(lineMatch[1])
      const before = content.slice(0, position)
      line = (before.match(/\n/g) || []).length + 1
    }
    return {
      valid: false,
      errors: [{ line, message: error.message.replace(/^JSON\s*:\s*/, '') }],
      warnings: []
    }
  }
}

function checkJsonContent(content = '') {
  try {
    JSON.parse(content)
    return { valid: true, errors: [], warnings: [] }
  } catch (error) {
    const lineMatch = error.message.match(/position\s+(\d+)/i)
    let line = null
    if (lineMatch) {
      const position = Number(lineMatch[1])
      const before = content.slice(0, position)
      line = (before.match(/\n/g) || []).length + 1
    }
    return {
      valid: false,
      errors: [{ line, message: error.message.replace(/^JSON\s*:\s*/, '') }],
      warnings: []
    }
  }
}

function checkPython(filePath) {
  try {
    const result = spawnSync('python', ['-c', `import ast; ast.parse(open(${JSON.stringify(filePath)}, encoding="utf-8").read())`], {
      encoding: 'utf8',
      timeout: CHECK_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    if (result.status === 0) {
      return { valid: true, errors: [], warnings: [] }
    }
    const stderr = stripProcessControlCharacters(result.stderr || '')
    const errors = []
    const syntaxMatch = stderr.match(/SyntaxError:\s*(.+)/i)
    if (syntaxMatch) {
      const lineMatch = stderr.match(/line\s+(\d+)/i)
      errors.push({
        line: lineMatch ? Number(lineMatch[1]) : null,
        message: syntaxMatch[1].trim()
      })
    } else if (stderr.trim()) {
      errors.push({ message: stderr.trim().split(/\r?\n/).slice(0, 2).join(' ') })
    }
    return { valid: errors.length === 0, errors, warnings: [] }
  } catch {
    return { valid: true, errors: [], warnings: ['Python not available for syntax check'] }
  }
}

async function checkPythonAsync(filePath) {
  try {
    const result = await execFileChecked('python', ['-c', `import ast; ast.parse(open(${JSON.stringify(filePath)}, encoding="utf-8").read())`])
    if (result.status === 0) {
      return { valid: true, errors: [], warnings: [] }
    }
    const stderr = stripProcessControlCharacters(result.stderr || result.error?.message || '')
    const errors = []
    const syntaxMatch = stderr.match(/SyntaxError:\s*(.+)/i)
    if (syntaxMatch) {
      const lineMatch = stderr.match(/line\s+(\d+)/i)
      errors.push({
        line: lineMatch ? Number(lineMatch[1]) : null,
        message: stripProcessControlCharacters(syntaxMatch[1]).trim()
      })
    } else if (stderr.trim()) {
      errors.push({ message: stderr.trim().split(/\r?\n/).slice(0, 2).join(' ') })
    }
    return { valid: errors.length === 0, errors, warnings: [] }
  } catch {
    return { valid: true, errors: [], warnings: ['Python not available for syntax check'] }
  }
}

function buildSyntaxResult(resolvedPath, language, startedAt, result) {
  return {
    valid: result.valid,
    language,
    filePath: resolvedPath,
    errors: result.errors || [],
    warnings: result.warnings || [],
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt
  }
}

function checkFileSyntax(filePath) {
  const startedAt = Date.now()
  const resolvedPath = path.resolve(filePath)

  if (!fs.existsSync(resolvedPath)) {
    return {
      valid: false,
      language: 'unknown',
      filePath: resolvedPath,
      errors: [{ message: `File not found: ${resolvedPath}` }],
      warnings: [],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }
  }

  let stat
  try {
    stat = fs.statSync(resolvedPath)
  } catch (error) {
    return {
      valid: false,
      language: 'unknown',
      filePath: resolvedPath,
      errors: [{ message: `Cannot stat file: ${error.message}` }],
      warnings: [],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }
  }

  if (stat.size > MAX_FILE_BYTES) {
    return {
      valid: true,
      language: 'unknown',
      filePath: resolvedPath,
      errors: [],
      warnings: ['File too large for syntax check (>2MB)'],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }
  }

  if (!stat.isFile()) {
    return {
      valid: true,
      language: 'unknown',
      filePath: resolvedPath,
      errors: [],
      warnings: ['Not a regular file'],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }
  }

  const language = detectLanguage(resolvedPath)
  let result

  switch (language) {
    case 'javascript':
      result = checkJavaScript(resolvedPath)
      break
    case 'html':
      result = checkHtml(resolvedPath)
      break
    case 'css':
      result = checkCss(resolvedPath)
      break
    case 'json':
      result = checkJson(resolvedPath)
      break
    case 'python':
      result = checkPython(resolvedPath)
      break
    default:
      result = { valid: true, errors: [], warnings: [`Unsupported file type: ${path.extname(resolvedPath)}`] }
  }

  return {
    ...buildSyntaxResult(resolvedPath, language, startedAt, result)
  }
}

async function checkFileSyntaxAsync(filePath) {
  const startedAt = Date.now()
  const resolvedPath = path.resolve(filePath)

  let stat
  try {
    stat = await fs.promises.stat(resolvedPath)
  } catch (error) {
    return {
      valid: false,
      language: 'unknown',
      filePath: resolvedPath,
      errors: [{ message: error.code === 'ENOENT' ? `File not found: ${resolvedPath}` : `Cannot stat file: ${error.message}` }],
      warnings: [],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }
  }

  if (stat.size > MAX_FILE_BYTES) {
    return {
      valid: true,
      language: 'unknown',
      filePath: resolvedPath,
      errors: [],
      warnings: ['File too large for syntax check (>2MB)'],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }
  }

  if (!stat.isFile()) {
    return {
      valid: true,
      language: 'unknown',
      filePath: resolvedPath,
      errors: [],
      warnings: ['Not a regular file'],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }
  }

  const language = detectLanguage(resolvedPath)
  let result

  switch (language) {
    case 'javascript':
      result = await checkJavaScriptAsync(resolvedPath)
      break
    case 'html':
      result = checkHtmlContent(await fs.promises.readFile(resolvedPath, 'utf8'))
      break
    case 'css':
      result = checkCssContent(await fs.promises.readFile(resolvedPath, 'utf8'))
      break
    case 'json':
      result = checkJsonContent(await fs.promises.readFile(resolvedPath, 'utf8'))
      break
    case 'python':
      result = await checkPythonAsync(resolvedPath)
      break
    default:
      result = { valid: true, errors: [], warnings: [`Unsupported file type: ${path.extname(resolvedPath)}`] }
  }

  return buildSyntaxResult(resolvedPath, language, startedAt, result)
}

module.exports = {
  checkFileSyntax,
  checkFileSyntaxAsync,
  detectLanguage,
  stripProcessControlCharacters,
  getNodeCheckExecOptions
}
