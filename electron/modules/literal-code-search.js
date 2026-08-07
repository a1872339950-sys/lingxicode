const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { getRgPath } = require('./rg-path')

const execFileAsync = promisify(execFile)

const IGNORE_GLOBS = [
  '.git/**', 'node_modules/**', 'dist/**', 'build/**', 'out/**', 'release/**',
  'releases/**', 'coverage/**', 'tmp/**', 'temp/**', 'logs/**', 'codemap/**',
  'change-sessions/**', 'recovery-points/**', '.tmp-real-scenarios/**',
  '.lingxi-temp-artifacts/**', '.next/**', '.cache/**', '__pycache__/**'
]

function normalizeTerms(terms = [], limit = 16) {
  const normalized = []
  for (const value of Array.isArray(terms) ? terms : []) {
    const term = String(value || '').trim()
    if (!term || term.length > 160) continue
    if (normalized.some(item => item.toLowerCase() === term.toLowerCase())) continue
    normalized.push(term)
    if (normalized.length >= limit) break
  }
  return normalized
}

function parseRipgrepOutput(output = '', projectPath = '', limit = 30) {
  const matches = []
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^(.+?):(\d+):(.*)$/)
    if (!match) continue
    const absoluteOrRelative = match[1]
    const relativePath = path.isAbsolute(absoluteOrRelative)
      ? path.relative(projectPath, absoluteOrRelative)
      : absoluteOrRelative
    matches.push({
      path: relativePath.replace(/\\/g, '/'),
      line: Number(match[2]),
      preview: match[3].trim().slice(0, 240)
    })
    if (matches.length >= limit) break
  }
  return matches
}

async function searchLiteralTerms(projectPath = '', terms = [], limit = 30) {
  const selected = normalizeTerms(terms)
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30))
  if (!projectPath || !selected.length) return []

  const args = [
    '-n', '--no-heading', '--color', 'never', '-S', '-i', '-F', '-m', '20',
    ...IGNORE_GLOBS.flatMap(pattern => ['--glob', `!${pattern}`]),
    ...selected.flatMap(term => ['-e', term]),
    projectPath
  ]

  try {
    const { stdout } = await execFileAsync(getRgPath(), args, {
      cwd: projectPath,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 12000
    })
    return parseRipgrepOutput(stdout, projectPath, safeLimit)
  } catch (error) {
    // ripgrep exits with code 1 when no match is found; stdout can still contain
    // useful matches when the process is interrupted after producing output.
    return parseRipgrepOutput(error?.stdout || '', projectPath, safeLimit)
  }
}

module.exports = { normalizeTerms, parseRipgrepOutput, searchLiteralTerms }
