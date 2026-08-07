const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const storageConfig = require('./storage-config')
const assetLibrary = require('./asset-library')

const LONG_TEXT_THRESHOLD = 2000
const ARTIFACTS_DIR = 'artifacts'

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function sanitizeProjectKey(instance) {
  const raw = instance?.projectId || instance?.id || instance?.projectPath || instance?.storagePath || 'default'
  const safe = String(raw)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return safe || 'default'
}

function getArtifactsDir(instance) {
  const dir = path.join(storageConfig.getArtifactsDir(), sanitizeProjectKey(instance))
  ensureDir(dir)
  return dir
}

function getLegacyArtifactsDir(instance) {
  if (!instance?.storagePath) return null
  return path.join(instance.storagePath, ARTIFACTS_DIR)
}

function getArtifactPath(instance, artifactId) {
  if (!artifactId || !/^[a-zA-Z0-9_-]+$/.test(String(artifactId))) {
    throw new Error('无效的 artifactId')
  }
  return path.join(getArtifactsDir(instance), `${artifactId}.json`)
}

function resolveArtifactPath(instance, artifactId) {
  const currentPath = getArtifactPath(instance, artifactId)
  if (fs.existsSync(currentPath)) return currentPath

  const legacyDir = getLegacyArtifactsDir(instance)
  if (legacyDir) {
    const legacyPath = path.join(legacyDir, `${artifactId}.json`)
    if (fs.existsSync(legacyPath)) return legacyPath
  }

  return currentPath
}

function generateArtifactId(type = 'detail') {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const suffix = crypto.randomBytes(4).toString('hex')
  return `${type}_${stamp}_${suffix}`
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|~\[\]()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSummary(content, maxChars = 1200) {
  const text = String(content || '').trim()
  if (text.length <= maxChars) return text

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const important = []
  for (const line of lines) {
    if (
      important.length === 0 ||
      /^(#{1,4}\s+|[-*]\s+|\d+[.、]\s+|高危|中危|低危|中等问题|其他问题|检查结果|建议|修复|验证|风险)/.test(line) ||
      /(ImportError|无法运行|敏感|git|\.gitignore|测试|架构|模块|重复|依赖|运行验证|高危|中危|低危|风险)/i.test(line)
    ) {
      important.push(line)
    }
    if (important.join('\n').length >= maxChars * 0.75) break
  }

  let summary = important.join('\n').trim()
  if (!summary) {
    const plain = stripMarkdown(text)
    summary = plain.slice(0, maxChars)
  }
  if (summary.length > maxChars) summary = summary.slice(0, maxChars - 20).trim() + '...'
  return summary
}

function inferArtifactType(content) {
  const text = String(content || '')
  if (/审查|review|高危|中危|漏洞|风险|修复优先/i.test(text)) return 'code_review_detail'
  if (/方案|计划|架构|设计|workflow|工作流/i.test(text)) return 'plan_detail'
  return 'long_text_detail'
}

function shouldCreateArtifact(text, options = {}) {
  const threshold = Number(options.threshold || LONG_TEXT_THRESHOLD)
  const taskMeta = options.taskMeta || {}
  const toolCalls = Array.isArray(taskMeta.toolCallsRecord) ? taskMeta.toolCallsRecord : []
  const reviewSummary = String(taskMeta.reviewResult?.summary || '').trim()
  const userMessage = String(taskMeta.userMessage || '')
  const reviewLikeTask = /(审查|代码审查|安全审查|项目审查|review|scan|架构|模块化|测试覆盖)/i.test(userMessage)
  const workflowTask = /(blender|文生图|图片生成|接力|agent|工作流|relay)/i.test(userMessage)
  const summaryInspectionTask = /(摘要|压缩摘要|summary)/i.test(userMessage) && !/(审查|代码|安全|项目|架构|开发|修复|实现)/i.test(userMessage)
  const hasChanges = !!taskMeta.hasChangeSession
  const hasArtifacts = toolCalls.some(call => ['generate_image', 'blender_run_script', 'blender_create_demo_model', 'blender_3d_relay'].includes(call?.name))
  const hasStructuredFindings = /(高危|中等|低风险|建议修复顺序|检查结果|发现|未完成)/.test(text) || !!reviewSummary
  if (summaryInspectionTask && !hasChanges && !hasArtifacts) return text.length > threshold
  if (reviewLikeTask || workflowTask || hasChanges || hasArtifacts || hasStructuredFindings) return true
  return text.length > threshold
}

function buildTitle(content, type) {
  const firstHeading = String(content || '').split(/\r?\n/).find(line => /^#{1,3}\s+/.test(line.trim()))
  if (firstHeading) return firstHeading.replace(/^#{1,3}\s+/, '').trim().slice(0, 60)
  if (type === 'code_review_detail') return '完整审查详情'
  if (type === 'plan_detail') return '完整方案详情'
  return '完整回复详情'
}

function createArtifact(instance, options = {}) {
  const content = String(options.content || '')
  const type = options.type || inferArtifactType(content)
  const id = options.id || generateArtifactId(type.replace(/[^a-zA-Z0-9_-]/g, '_'))
  const title = options.title || buildTitle(content, type)
  const summary = options.summary || buildSummary(content)
  const now = Date.now()

  const artifact = {
    id,
    type,
    title,
    summary,
    content,
    length: content.length,
    createdAt: now,
    updatedAt: now,
    projectPath: instance?.projectPath || ''
  }

  fs.writeFileSync(getArtifactPath(instance, id), JSON.stringify(artifact, null, 2), 'utf-8')
  try {
    assetLibrary.upsertAsset({
      path: getArtifactPath(instance, id),
      type: 'document',
      kind: type,
      title,
      sourceTool: 'final_reply_artifact',
      source: 'artifact',
      projectId: instance?.projectId || instance?.id || '',
      projectPath: instance?.projectPath || '',
      prompt: summary,
      metadata: {
        artifactId: id,
        length: content.length
      }
    })
  } catch (error) {
    // Artifact creation should not fail because the library index is unavailable.
  }

  return {
    id,
    type,
    title,
    preview: summary.slice(0, 220),
    length: content.length,
    createdAt: now
  }
}

function readArtifact(instance, artifactId) {
  const filePath = resolveArtifactPath(instance, artifactId)
  if (!fs.existsSync(filePath)) {
    return { success: false, error: '详情不存在或已被删除' }
  }
  try {
    const artifact = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return { success: true, artifact }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function maybeCreateLongTextArtifact(instance, content, options = {}) {
  return {
    content: String(content || '').trim(),
    artifacts: []
  }
}
function formatArtifactForContext(artifact) {
  if (!artifact) return ''
  return [
    `【引用详情 ${artifact.id}】`,
    `标题：${artifact.title || artifact.id}`,
    `类型：${artifact.type || 'detail'}`,
    `长度：${artifact.length || String(artifact.content || '').length} 字`,
    '',
    String(artifact.content || '')
  ].join('\n')
}

function resolveReferences(instance, references = []) {
  if (!Array.isArray(references) || references.length === 0) return []
  const seen = new Set()
  const resolved = []
  for (const ref of references) {
    const id = typeof ref === 'string' ? ref : ref?.artifactId || ref?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const result = readArtifact(instance, id)
    if (result.success) {
      resolved.push(result.artifact)
    }
  }
  return resolved
}

module.exports = {
  LONG_TEXT_THRESHOLD,
  getArtifactsDir,
  maybeCreateLongTextArtifact,
  createArtifact,
  readArtifact,
  resolveReferences,
  formatArtifactForContext
}
