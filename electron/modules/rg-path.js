const path = require('path')
const fs = require('fs')

let cachedRgPath = null

function toUnpackedPath(filePath) {
  return String(filePath || '').replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')
}

function findExistingPath(candidates = []) {
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null
}

function getElectronAppPath() {
  try {
    const electron = require('electron')
    return electron?.app?.getAppPath?.() || null
  } catch {
    return null
  }
}

function buildRgExecutableCandidates() {
  const executableName = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const moduleRelative = path.join('@vscode', process.platform === 'win32' ? 'ripgrep-win32-x64' : 'ripgrep', 'bin', executableName)
  const genericRelative = path.join('@vscode', 'ripgrep', 'bin', executableName)
  const roots = [
    process.cwd(),
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
    getElectronAppPath(),
    process.resourcesPath,
    process.resourcesPath ? path.join(process.resourcesPath, 'app') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked') : null
  ].filter(Boolean)

  const candidates = []
  for (const root of roots) {
    candidates.push(path.join(root, 'node_modules', moduleRelative))
    candidates.push(path.join(root, 'node_modules', genericRelative))
    candidates.push(toUnpackedPath(path.join(root, 'node_modules', moduleRelative)))
    candidates.push(toUnpackedPath(path.join(root, 'node_modules', genericRelative)))
  }
  return [...new Set(candidates)]
}

function resolveBundledRgPath() {
  try {
    const ripgrep = require('@vscode/ripgrep')
    const exportedPath = ripgrep?.rgPath || ripgrep?.path
    const unpackedExportedPath = toUnpackedPath(exportedPath)
    const exportedCandidate = findExistingPath([unpackedExportedPath, exportedPath])
    if (exportedCandidate) return exportedCandidate

    const ripgrepModulePath = require.resolve('@vscode/ripgrep')
    const ripgrepRoot = path.dirname(ripgrepModulePath)
    const executableName = process.platform === 'win32' ? 'rg.exe' : 'rg'
    const candidates = [
      path.join(toUnpackedPath(ripgrepRoot), 'bin', executableName),
      path.join(ripgrepRoot, 'bin', executableName)
    ]
    return findExistingPath(candidates) || null
  } catch {
    return findExistingPath(buildRgExecutableCandidates())
  }
}

function getRgPath() {
  if (cachedRgPath) return cachedRgPath
  cachedRgPath = findExistingPath([resolveBundledRgPath(), ...buildRgExecutableCandidates()]) || 'rg'
  return cachedRgPath
}

module.exports = {
  getRgPath
}
