const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('./config')
const storageConfig = require('./storage-config')
const MANAGED_SKILLS_FILE = '.lingxi-managed-skills.json'

function isInside(parentPath, childPath) {
  if (!parentPath || !childPath) return false
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function ensureProjectPath(projectPath = '') {
  const resolved = path.resolve(String(projectPath || ''))
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Project path is missing or not a directory.')
  }
  return resolved
}

function safeSkillName(value = '') {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return base || `skill-${Date.now().toString(36)}`
}

function projectLingxiDir(projectPath) {
  return path.join(ensureProjectPath(projectPath), '.lingxi')
}

function normalizeScope(value = '') {
  return String(value || '').trim().toLowerCase() === 'project' ? 'project' : 'global'
}

function globalSkillsDir() {
  const root = config.getSkillsDir?.() || storageConfig.getSkillsDir?.()
  if (!root) throw new Error('Global skills directory is not configured.')
  return path.resolve(root)
}

function globalDraftsDir() {
  const base = config.getLinguaBasePath?.() || storageConfig.getBasePath?.() || path.dirname(globalSkillsDir())
  return path.join(path.resolve(base), 'skills-drafts')
}

function draftsDir(projectPath, scope = 'project') {
  if (normalizeScope(scope) === 'global') return globalDraftsDir()
  return path.join(projectLingxiDir(projectPath), 'skills-drafts')
}

function installedDir(projectPath, scope = 'project') {
  if (normalizeScope(scope) === 'global') return globalSkillsDir()
  return path.join(projectLingxiDir(projectPath), 'skills')
}

function skillFrontmatter({ name, title, description, tags = [], scope = 'global' }) {
  const safeTags = Array.isArray(tags) ? tags.map(item => String(item || '').trim()).filter(Boolean).slice(0, 12) : []
  return [
    '---',
    `name: ${name}`,
    `title: ${String(title || name).replace(/\r?\n/g, ' ').trim()}`,
    `description: ${String(description || '').replace(/\r?\n/g, ' ').trim()}`,
    `scope: ${normalizeScope(scope)}`,
    safeTags.length ? `tags: ${safeTags.join(', ')}` : '',
    '---',
    ''
  ].filter(line => line !== '').join('\n')
}

function normalizeSkillMarkdown(input = {}, scope = 'global') {
  const title = String(input.title || input.name || 'Project Experience Skill').trim()
  const name = safeSkillName(input.name || title)
  const description = String(input.description || '').trim()
  const content = String(input.content || input.markdown || '').trim()
  if (!content) throw new Error('Skill draft content is required.')
  if (/^---\n[\s\S]*?\n---/.test(content)) return { name, markdown: content }
  const sections = [
    skillFrontmatter({ name, title, description, tags: input.tags, scope }),
    content
  ]
  return { name, markdown: sections.join('\n').trim() + '\n' }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function saveEnabledSkills() {
  const basePath = config.getLinguaBasePath?.() || storageConfig.getBasePath?.()
  if (!basePath) return
  fs.mkdirSync(basePath, { recursive: true })
  fs.writeFileSync(path.join(basePath, 'enabled-skills.json'), JSON.stringify(config.getEnabledSkills?.() || [], null, 2), 'utf8')
}

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

function readManagedSkills(root = '') {
  return readJson(path.join(root, MANAGED_SKILLS_FILE), { skills: {} }) || { skills: {} }
}

function writeManagedSkills(root = '', manifest = {}) {
  fs.mkdirSync(root, { recursive: true })
  writeJson(path.join(root, MANAGED_SKILLS_FILE), {
    ...manifest,
    skills: manifest.skills || {}
  })
}

function assertCanWriteSkill(targetRoot, name, targetSkillPath, nextContent, input = {}) {
  if (!fs.existsSync(targetSkillPath)) return
  const manifest = readManagedSkills(targetRoot)
  const entry = manifest.skills?.[name]
  const currentContent = fs.readFileSync(targetSkillPath, 'utf8')
  const currentHash = sha256(currentContent)
  if (input.overwrite === true) return
  if (!entry || entry.installedHash !== currentHash) {
    throw new Error(`Skill "${name}" already exists and may contain user edits. Refuse to overwrite it automatically.`)
  }
  if (sha256(nextContent) === currentHash) return
}

function rememberManagedSkill(targetRoot, name, scope, sourceContent, installedContent) {
  const manifest = readManagedSkills(targetRoot)
  manifest.skills = manifest.skills || {}
  manifest.skills[name] = {
    name,
    scope,
    sourceHash: sha256(sourceContent),
    installedHash: sha256(installedContent),
    updatedAt: new Date().toISOString()
  }
  writeManagedSkills(targetRoot, manifest)
}

function normalizeProjectRelativeFiles(projectPath, files = []) {
  if (!Array.isArray(files)) return []
  const root = ensureProjectPath(projectPath)
  const seen = new Set()
  const result = []
  for (const item of files) {
    const raw = String(item || '').trim()
    if (!raw) continue
    const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw)
    if (!isInside(root, absolute)) continue
    const relative = path.relative(root, absolute).replace(/\\/g, '/')
    if (!relative || seen.has(relative)) continue
    seen.add(relative)
    result.push(relative)
    if (result.length >= 30) break
  }
  return result
}

function parseSkillFile(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf8')
  const frontmatter = {}
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const index = line.indexOf(':')
      if (index <= 0) continue
      const key = line.slice(0, index).trim()
      const value = line.slice(index + 1).trim()
      if (key) frontmatter[key] = value
    }
  }
  const folderName = path.basename(path.dirname(filePath))
  return {
    path: filePath,
    name: frontmatter.name || folderName,
    title: frontmatter.title || frontmatter.name || folderName,
    description: frontmatter.description || '',
    scope: frontmatter.scope || options.scope || 'global',
    content: match ? match[2].trim() : content.trim(),
    builtin: false,
    projectSkill: !!options.projectSkill
  }
}

function listProjectSkills(projectPath = '') {
  const root = installedDir(projectPath)
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name, 'SKILL.md'))
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => {
      try {
        return parseSkillFile(filePath, { scope: 'project', projectSkill: true })
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function listSkillDrafts(projectPath = '', scope = 'project') {
  const resolvedScope = normalizeScope(scope)
  const root = draftsDir(projectPath, resolvedScope)
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = path.join(root, entry.name)
      const skillPath = path.join(dir, 'SKILL.md')
      const metaPath = path.join(dir, 'draft.json')
      if (!fs.existsSync(skillPath)) return null
      const metadata = readJson(metaPath, {})
      return {
        id: entry.name,
        name: metadata.name || entry.name,
        title: metadata.title || metadata.name || entry.name,
        description: metadata.description || '',
        status: metadata.status || 'draft',
        scope: metadata.scope || resolvedScope,
        createdAt: metadata.createdAt || null,
        updatedAt: metadata.updatedAt || null,
        path: skillPath,
        folder: dir
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
}

function createSkillDraft(input = {}, ctx = {}) {
  const scope = normalizeScope(input.scope || input.targetScope || input.target_scope || 'global')
  const rawProjectPath = ctx.projectPath || input.projectPath || ''
  const projectPath = rawProjectPath ? ensureProjectPath(rawProjectPath) : ''
  if (scope === 'project' && !projectPath) throw new Error('Project path is required for project skill drafts.')
  const { name, markdown } = normalizeSkillMarkdown(input, scope)
  const now = new Date().toISOString()
  const draftId = `${name}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const root = draftsDir(projectPath, scope)
  const folder = path.join(root, draftId)
  if (!isInside(root, folder)) throw new Error('Refuse to create draft outside skills draft directory.')
  fs.mkdirSync(folder, { recursive: true })
  const skillPath = path.join(folder, 'SKILL.md')
  fs.writeFileSync(skillPath, markdown, 'utf8')
  const metadata = {
    id: draftId,
    name,
    title: String(input.title || name).trim(),
    description: String(input.description || '').trim(),
    status: 'draft',
    scope,
    source: input.source || 'ai',
    sourceSummary: input.source_summary || input.sourceSummary || '',
    sourceProjectPath: projectPath || '',
    relatedFiles: projectPath ? normalizeProjectRelativeFiles(projectPath, input.related_files || input.relatedFiles) : [],
    createdAt: now,
    updatedAt: now,
    skillPath
  }
  writeJson(path.join(folder, 'draft.json'), metadata)
  return {
    success: true,
    draft: metadata,
    path: skillPath,
    scope,
    message: scope === 'project'
      ? 'Skill draft saved in project .lingxi/skills-drafts.'
      : 'Skill draft saved in the global skills draft library.'
  }
}

function resolveDraft(projectPath, input = {}, scope = 'project') {
  const resolvedScope = normalizeScope(scope)
  const root = draftsDir(projectPath, resolvedScope)
  const raw = String(input.draft_id || input.draftId || input.id || input.path || '').trim()
  if (!raw) throw new Error('draft_id or path is required.')
  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw)
  const skillPath = path.extname(candidate).toLowerCase() === '.md' ? candidate : path.join(candidate, 'SKILL.md')
  const resolved = path.resolve(skillPath)
  if (!isInside(root, resolved) || !fs.existsSync(resolved)) {
    throw new Error(resolvedScope === 'project' ? 'Skill draft not found in this project.' : 'Skill draft not found in the global draft library.')
  }
  return {
    folder: path.dirname(resolved),
    skillPath: resolved,
    metadata: readJson(path.join(path.dirname(resolved), 'draft.json'), {})
  }
}

function installSkillDraft(input = {}, ctx = {}) {
  const targetScope = normalizeScope(input.scope || input.targetScope || input.target_scope || 'global')
  const draftScope = normalizeScope(input.draft_scope || input.draftScope || input.sourceScope || input.source_scope || targetScope)
  const rawProjectPath = ctx.projectPath || input.projectPath || ''
  const projectPath = rawProjectPath ? ensureProjectPath(rawProjectPath) : ''
  if ((targetScope === 'project' || draftScope === 'project') && !projectPath) {
    throw new Error('Project path is required for project skill drafts.')
  }
  const draft = resolveDraft(projectPath, input, draftScope)
  const parsed = parseSkillFile(draft.skillPath)
  const name = safeSkillName(input.name || parsed.name)
  const targetRoot = installedDir(projectPath, targetScope)
  const targetFolder = path.join(targetRoot, name)
  if (!isInside(targetRoot, targetFolder)) throw new Error('Refuse to install skill outside skills directory.')
  const draftContent = fs.readFileSync(draft.skillPath, 'utf8')
  fs.mkdirSync(targetFolder, { recursive: true })
  const targetSkillPath = path.join(targetFolder, 'SKILL.md')
  assertCanWriteSkill(targetRoot, name, targetSkillPath, draftContent, input)
  fs.copyFileSync(draft.skillPath, targetSkillPath)
  const installedContent = fs.readFileSync(targetSkillPath, 'utf8')
  rememberManagedSkill(targetRoot, name, targetScope, draftContent, installedContent)
  const now = new Date().toISOString()
  const metadata = {
    ...draft.metadata,
    id: draft.metadata.id || path.basename(draft.folder),
    name,
    status: 'installed',
    scope: draftScope,
    installedScope: targetScope,
    installedAt: now,
    installedPath: targetSkillPath,
    updatedAt: now
  }
  writeJson(path.join(draft.folder, 'draft.json'), metadata)
  if (targetScope === 'global') {
    config.addEnabledSkill?.(name)
    saveEnabledSkills()
  }
  return {
    success: true,
    skill: parseSkillFile(targetSkillPath, { scope: targetScope, projectSkill: targetScope === 'project' }),
    path: targetSkillPath,
    draft: metadata,
    scope: targetScope,
    message: targetScope === 'project' ? 'Project skill installed.' : 'Global skill installed.'
  }
}

function deleteSkillDraft(input = {}, ctx = {}) {
  const scope = normalizeScope(input.scope || input.draft_scope || input.draftScope || input.sourceScope || input.source_scope || 'global')
  const rawProjectPath = ctx.projectPath || input.projectPath || ''
  const projectPath = rawProjectPath ? ensureProjectPath(rawProjectPath) : ''
  if (scope === 'project' && !projectPath) throw new Error('Project path is required for project skill drafts.')
  const draft = resolveDraft(projectPath, input, scope)
  if (!isInside(draftsDir(projectPath, scope), draft.folder)) throw new Error('Refuse to delete non-draft path.')
  fs.rmSync(draft.folder, { recursive: true, force: true })
  return {
    success: true,
    id: draft.metadata.id || path.basename(draft.folder),
    deletedPath: draft.folder,
    message: 'Project skill draft deleted.'
  }
}

function registerIPC(ipcMain) {
  ipcMain.handle('project-skill-draft:list', async (event, projectPath = '') => {
    try {
      return {
        success: true,
        drafts: listSkillDrafts(projectPath, 'global'),
        globalDrafts: listSkillDrafts(projectPath, 'global'),
        projectDrafts: projectPath ? listSkillDrafts(projectPath, 'project') : [],
        skills: listProjectSkills(projectPath)
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('project-skill-draft:install', async (event, projectPath = '', draftId = '', options = {}) => {
    try {
      return installSkillDraft({ ...options, draft_id: draftId }, { projectPath })
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('project-skill-draft:delete', async (event, projectPath = '', draftId = '', options = {}) => {
    try {
      return deleteSkillDraft({ ...options, draft_id: draftId }, { projectPath })
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  createSkillDraft,
  installSkillDraft,
  deleteSkillDraft,
  listSkillDrafts,
  listProjectSkills,
  draftsDir,
  installedDir,
  globalDraftsDir,
  globalSkillsDir,
  parseSkillFile,
  registerIPC
}
