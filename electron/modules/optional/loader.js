/**
 * 可选能力软加载器。
 * 删除 optional/<id>/ 目录后，本加载器自动跳过，主程序不崩溃。
 */

const fs = require('fs')
const path = require('path')

const OPTIONAL_ROOT = __dirname

function listOptionalModuleDirs() {
  try {
    return fs
      .readdirSync(OPTIONAL_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map(d => d.name)
  } catch {
    return []
  }
}

function loadOptionalModules() {
  const modules = []
  const errors = []
  for (const name of listOptionalModuleDirs()) {
    const indexPath = path.join(OPTIONAL_ROOT, name, 'index.js')
    if (!fs.existsSync(indexPath)) continue
    try {
      // 删除目录后 require 缓存可能仍在；以路径存在为准
      delete require.cache[require.resolve(indexPath)]
      const mod = require(indexPath)
      if (!mod || !mod.id) {
        errors.push({ module: name, error: 'missing exports.id' })
        continue
      }
      modules.push({
        id: String(mod.id),
        dir: name,
        feature: mod.feature || null,
        toolsSchema: Array.isArray(mod.toolsSchema) ? mod.toolsSchema : [],
        handlers: mod.handlers && typeof mod.handlers === 'object' ? mod.handlers : {},
        display: mod.display && typeof mod.display === 'object' ? mod.display : {},
        skillPath: mod.skillPath || null
      })
    } catch (error) {
      errors.push({ module: name, error: error.message || String(error) })
      console.warn(`[OptionalModules] skip ${name}:`, error.message || error)
    }
  }
  return { modules, errors }
}

let cached = null

function getOptionalModules({ force = false } = {}) {
  if (!force && cached) return cached
  cached = loadOptionalModules()
  return cached
}

function getOptionalFeatures() {
  return getOptionalModules().modules.map(m => m.feature).filter(Boolean)
}

function getOptionalToolsSchema() {
  return getOptionalModules().modules.flatMap(m => m.toolsSchema || [])
}

function getOptionalHandlers() {
  const map = {}
  for (const m of getOptionalModules().modules) {
    Object.assign(map, m.handlers || {})
  }
  return map
}

function getOptionalToolNames() {
  return Object.keys(getOptionalHandlers())
}

function getOptionalDisplayMap() {
  const map = {}
  for (const m of getOptionalModules().modules) {
    Object.assign(map, m.display || {})
  }
  return map
}

module.exports = {
  OPTIONAL_ROOT,
  getOptionalModules,
  getOptionalFeatures,
  getOptionalToolsSchema,
  getOptionalHandlers,
  getOptionalToolNames,
  getOptionalDisplayMap,
  listOptionalModuleDirs
}
