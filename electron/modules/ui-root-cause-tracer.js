const fs = require('fs')
const path = require('path')
const { toProjectRelative } = require('./path-utils')

const UI_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.scss', '.less'])
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.less'])
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.html', '.htm'])
const DEFAULT_STYLE_ROOTS = ['frontend/styles']
const DEFAULT_SCRIPT_ROOTS = ['frontend/scripts']
const DEFAULT_HTML_ROOTS = ['frontend']
const DEFAULT_HTML_FILES = ['frontend/index.html']
const MAX_STYLE_FILES = 80
const MAX_SCRIPT_FILES = 260
const MAX_HTML_FILES = 80
const MAX_FILE_BYTES = 768 * 1024

function normalizeRel(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function isInsideProject(projectPath = '', targetPath = '') {
  const root = path.resolve(projectPath || '')
  const target = path.resolve(targetPath || '')
  return target === root || target.startsWith(root + path.sep)
}

function resolveProjectFile(projectPath = '', filePath = '') {
  if (!projectPath || !filePath) return ''
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(projectPath, filePath)
  if (!isInsideProject(projectPath, resolved)) return ''
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return ''
  if (!UI_EXTENSIONS.has(path.extname(resolved).toLowerCase())) return ''
  return resolved
}

function safeRead(filePath = '') {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_FILE_BYTES) return ''
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function lineNumber(content = '', index = 0) {
  return String(content || '').slice(0, Math.max(0, index)).split(/\r\n|\r|\n/).length
}

function collectStyleFiles(projectPath = '') {
  const files = []
  for (const root of DEFAULT_STYLE_ROOTS) {
    const dir = path.resolve(projectPath, root)
    if (!fs.existsSync(dir)) continue
    const stack = [dir]
    while (stack.length && files.length < MAX_STYLE_FILES) {
      const current = stack.pop()
      let entries = []
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile() && STYLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full)
      }
    }
  }
  return files
}

function collectFilesByExtension(projectPath = '', roots = [], extensions = new Set(), maxFiles = 100) {
  const files = []
  for (const root of roots) {
    const dir = path.resolve(projectPath, root)
    if (!fs.existsSync(dir)) continue
    const stack = [dir]
    while (stack.length && files.length < maxFiles) {
      const current = stack.pop()
      let entries = []
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(full)
        if (files.length >= maxFiles) break
      }
    }
  }
  return files
}

function collectAnalysisFiles(projectPath = '', files = []) {
  const out = []
  const seen = new Set()
  const add = value => {
    const resolved = resolveProjectFile(projectPath, value)
    if (!resolved || seen.has(resolved)) return
    seen.add(resolved)
    out.push(resolved)
  }

  for (const file of files) add(file)
  for (const file of DEFAULT_HTML_FILES) add(file)
  for (const file of collectFilesByExtension(projectPath, DEFAULT_HTML_ROOTS, new Set(['.html', '.htm']), MAX_HTML_FILES)) add(file)
  for (const file of collectFilesByExtension(projectPath, DEFAULT_SCRIPT_ROOTS, new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']), MAX_SCRIPT_FILES)) add(file)
  for (const file of collectStyleFiles(projectPath)) add(file)
  return out
}

function addUnique(list, value) {
  if (!value) return
  if (!list.includes(value)) list.push(value)
}

function selectorTokenForDom(dom = {}) {
  if (dom.id) return `#${dom.id}`
  if (dom.selector) return dom.selector
  if (dom.classes?.[0]) return `.${dom.classes[0]}`
  return ''
}

function normalizeSelector(selector = '') {
  return String(selector || '').replace(/\s+/g, ' ').trim()
}

function splitSelectors(selectorText = '') {
  const selectors = []
  let current = ''
  let depth = 0
  for (const char of String(selectorText || '')) {
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      if (current.trim()) selectors.push(normalizeSelector(current))
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) selectors.push(normalizeSelector(current))
  return selectors
}

function parseHtmlDom(content = '', file = '', projectPath = '') {
  const domById = new Map()
  const classIndex = new Map()
  for (const match of content.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const attrs = match[2] || ''
    const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/)?.[1] || ''
    const classText = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/)?.[1] || ''
    const classes = classText.split(/\s+/).filter(Boolean)
    const dom = {
      tag: match[1],
      id,
      classes,
      path: toProjectRelative(projectPath, file),
      line: lineNumber(content, match.index),
      evidence: match[0].slice(0, 240)
    }
    if (id && !domById.has(id)) domById.set(id, dom)
    for (const className of classes) {
      if (!classIndex.has(className)) classIndex.set(className, [])
      classIndex.get(className).push(dom)
    }
  }
  return { domById, classIndex }
}

function mergeDomIndex(target, source) {
  for (const [id, dom] of source.domById.entries()) {
    if (!target.domById.has(id)) target.domById.set(id, dom)
  }
  for (const [className, items] of source.classIndex.entries()) {
    if (!target.classIndex.has(className)) target.classIndex.set(className, [])
    target.classIndex.get(className).push(...items)
  }
}

function parseCssRules(content = '', file = '', projectPath = '') {
  const rules = []
  const source = String(content || '').replace(/\/\*[\s\S]*?\*\//g, match => '\n'.repeat((match.match(/\n/g) || []).length))
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorText = match[1] || ''
    const declarations = match[2] || ''
    for (const selector of splitSelectors(selectorText)) {
      if (!selector || selector.startsWith('@')) continue
      rules.push({
        selector,
        declarations: declarations.replace(/\s+/g, ' ').trim().slice(0, 260),
        declarationMap: parseDeclarationMap(declarations),
        path: toProjectRelative(projectPath, file),
        line: lineNumber(content, match.index)
      })
    }
  }
  return rules
}

function parseJsFacts(content = '', file = '', projectPath = '') {
  const variables = new Map()
  const mutations = []
  const eventBindings = []
  const selectors = []
  const relativePath = toProjectRelative(projectPath, file)

  function rememberVariable(name, dom) {
    if (!name || !dom) return
    variables.set(name, dom)
  }

  for (const match of content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
    rememberVariable(match[1], { id: match[2], selector: `#${match[2]}`, source: 'getElementById' })
    selectors.push({ selector: `#${match[2]}`, kind: 'id_lookup', path: relativePath, line: lineNumber(content, match.index), evidence: match[0] })
  }
  for (const match of content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.querySelector\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
    rememberVariable(match[1], { selector: match[2], source: 'querySelector' })
    selectors.push({ selector: match[2], kind: 'query_selector', path: relativePath, line: lineNumber(content, match.index), evidence: match[0] })
  }

  const mutationPattern = /\b([A-Za-z_$][\w$]*)\.classList\.(add|remove|toggle|contains)\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g
  for (const match of content.matchAll(mutationPattern)) {
    const dom = variables.get(match[1])
    if (!dom) continue
    mutations.push({
      variable: match[1],
      action: match[2],
      className: match[3],
      dom,
      path: relativePath,
      line: lineNumber(content, match.index),
      evidence: match[0]
    })
  }

  const directIdMutation = /document\.getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)\.classList\.(add|remove|toggle|contains)\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g
  for (const match of content.matchAll(directIdMutation)) {
    mutations.push({
      variable: '',
      action: match[2],
      className: match[3],
      dom: { id: match[1], selector: `#${match[1]}`, source: 'getElementById' },
      path: relativePath,
      line: lineNumber(content, match.index),
      evidence: match[0]
    })
  }

  const eventPatterns = [
    /\b([A-Za-z_$][\w$]*)\.addEventListener\(\s*['"`]([^'"`]+)['"`]/g,
    /\b([A-Za-z_$][\w$]*)\.on(click|change|input|mouseenter|mouseleave|dragstart|dragend|dragover|dragleave|drop)\s*=/g
  ]
  for (const pattern of eventPatterns) {
    for (const match of content.matchAll(pattern)) {
      const dom = variables.get(match[1])
      if (!dom) continue
      eventBindings.push({
        variable: match[1],
        event: match[2],
        dom,
        path: relativePath,
        line: lineNumber(content, match.index),
        evidence: match[0]
      })
    }
  }

  return { variables, mutations, eventBindings, selectors }
}

function targetMatchesSimpleSelector(dom = {}, selector = '', domIndex = {}, options = {}) {
  const text = normalizeSelector(selector)
  if (!text) return false
  if (dom.id && new RegExp(`#${escapeRegExp(dom.id)}(?=$|[.#:\\[])`).test(text)) return true
  const staticDom = dom.id ? domIndex.domById.get(dom.id) : null
  const classes = new Set([...(dom.classes || []), ...(staticDom?.classes || [])])
  const ignored = new Set(options.ignoreClasses || [])
  for (const className of classes) {
    if (ignored.has(className)) continue
    if (new RegExp(`\\.${escapeRegExp(className)}(?=$|[.#:\\[])`).test(text)) return true
  }
  if (dom.selector && text.includes(dom.selector)) return true
  return false
}

function selectorHasStateOnTarget(dom = {}, selector = '', className = '', domIndex = {}) {
  const parts = normalizeSelector(selector).split(/\s+|>|\+|~/).filter(Boolean)
  return parts.some(part =>
    part.includes(`.${className}`) && targetMatchesSimpleSelector(dom, part, domIndex, { ignoreClasses: [className] })
  )
}

function selectorHasAncestorStateForTarget(dom = {}, selector = '', className = '', domIndex = {}) {
  const normalized = normalizeSelector(selector)
  const parts = normalized.split(/(\s+|>|\+|~)/).filter(Boolean)
  const targetIndex = parts.findIndex(part => targetMatchesSimpleSelector(dom, part, domIndex, { ignoreClasses: [className] }))
  if (targetIndex <= 0) return false
  return parts.slice(0, targetIndex).some(part => part.includes(`.${className}`))
}

function selectorMentionsState(selector = '', className = '') {
  return new RegExp(`\\.${escapeRegExp(className)}(?=$|[.#:\\[])`).test(selector)
}

function selectorMentionsTarget(dom = {}, selector = '', domIndex = {}) {
  return normalizeSelector(selector)
    .split(/\s+|>|\+|~/)
    .some(part => targetMatchesSimpleSelector(dom, part, domIndex))
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseDeclarationMap(declarations = '') {
  const out = {}
  for (const part of String(declarations || '').split(';')) {
    const index = part.indexOf(':')
    if (index <= 0) continue
    const prop = part.slice(0, index).trim().toLowerCase()
    const value = part.slice(index + 1).trim().toLowerCase()
    if (prop) out[prop] = value
  }
  return out
}

function getHiddenEffects(rule = {}) {
  const map = rule.declarationMap || {}
  const effects = []
  if (/\bnone\b/.test(map.display || '')) effects.push('display')
  if (/\b(hidden|collapse)\b/.test(map.visibility || '')) effects.push('visibility')
  if (/^(0|0\.0+)(?:\s*!important)?$/.test(map.opacity || '')) effects.push('opacity')
  if (/\bnone\b/.test(map['pointer-events'] || '')) effects.push('pointer-events')
  return effects
}

function getVisibleEffects(rule = {}) {
  const map = rule.declarationMap || {}
  const effects = []
  if (map.display && !/\bnone\b/.test(map.display)) effects.push('display')
  if (map.visibility && !/\b(hidden|collapse)\b/.test(map.visibility)) effects.push('visibility')
  if (map.opacity && !/^(0|0\.0+)(?:\s*!important)?$/.test(map.opacity)) effects.push('opacity')
  if (map['pointer-events'] && !/\bnone\b/.test(map['pointer-events'])) effects.push('pointer-events')
  return effects
}

function selectorParts(selector = '') {
  return normalizeSelector(selector).split(/\s+|>|\+|~/).filter(Boolean)
}

function selectorRightmostPart(selector = '') {
  const parts = selectorParts(selector)
  return parts[parts.length - 1] || ''
}

function selectorPartKey(part = '', ignoredClass = '') {
  const id = String(part || '').match(/#([A-Za-z0-9_-]+)/)?.[1]
  if (id) return `#${id}`
  const classes = [...String(part || '').matchAll(/\.([A-Za-z0-9_-]+)/g)]
    .map(match => match[1])
    .filter(Boolean)
    .filter(className => className !== ignoredClass)
  if (classes.length) return `.${classes[classes.length - 1]}`
  return normalizeSelector(part).replace(/:{1,2}[A-Za-z0-9_-]+(?:\([^)]*\))?/g, '')
}

function selectorAffectedKey(selector = '', className = '') {
  return selectorPartKey(selectorRightmostPart(selector), className)
}

function ruleAffectsSameVisibleTarget(rule = {}, affectedKey = '', className = '') {
  if (!affectedKey) return false
  const key = selectorAffectedKey(rule.selector, className)
  if (key === affectedKey) return true
  return normalizeSelector(rule.selector).includes(affectedKey)
}

function classifyCssForMutation(mutation = {}, cssRules = [], domIndex = {}) {
  const direct = []
  const ancestorGated = []
  const stateOnly = []
  const targetOnly = []
  const stateTargetRules = []

  for (const rule of cssRules) {
    if (selectorHasStateOnTarget(mutation.dom, rule.selector, mutation.className, domIndex)) {
      direct.push(rule)
      stateTargetRules.push(rule)
    } else if (selectorHasAncestorStateForTarget(mutation.dom, rule.selector, mutation.className, domIndex)) {
      ancestorGated.push(rule)
      stateTargetRules.push(rule)
    } else {
      if (selectorMentionsState(rule.selector, mutation.className)) stateOnly.push(rule)
      if (selectorMentionsTarget(mutation.dom, rule.selector, domIndex)) targetOnly.push(rule)
    }
  }

  const hiddenVisibility = buildVisibilityRestorationFindings(mutation, cssRules, stateTargetRules)

  return {
    direct: direct.slice(0, 8),
    ancestorGated: ancestorGated.slice(0, 8),
    stateOnly: stateOnly.slice(0, 8),
    targetOnly: targetOnly.slice(0, 8),
    hiddenVisibility
  }
}

function buildVisibilityRestorationFindings(mutation = {}, cssRules = [], stateTargetRules = []) {
  const findings = []
  for (const openRule of stateTargetRules) {
    const affectedKey = selectorAffectedKey(openRule.selector, mutation.className)
    if (!affectedKey) continue
    const hiddenRules = cssRules
      .filter(rule => ruleAffectsSameVisibleTarget(rule, affectedKey, mutation.className))
      .filter(rule => !/::(?:before|after)\b/.test(rule.selector))
      .map(rule => ({ rule, hiddenEffects: getHiddenEffects(rule) }))
      .filter(item => item.hiddenEffects.length)
    if (!hiddenRules.length) continue

    const restored = new Set()
    for (const rule of stateTargetRules) {
      if (!ruleAffectsSameVisibleTarget(rule, affectedKey, mutation.className)) continue
      for (const effect of getVisibleEffects(rule)) restored.add(effect)
    }
    const hidden = [...new Set(hiddenRules.flatMap(item => item.hiddenEffects))]
    const missing = hidden.filter(effect => !restored.has(effect))
    if (!missing.length) continue

    findings.push({
      affected: affectedKey,
      missing,
      openRule: {
        selector: openRule.selector,
        declarations: openRule.declarations,
        path: openRule.path,
        line: openRule.line
      },
      hiddenRules: hiddenRules.slice(0, 4).map(item => ({
        selector: item.rule.selector,
        declarations: item.rule.declarations,
        hiddenEffects: item.hiddenEffects,
        path: item.rule.path,
        line: item.rule.line
      })),
      message: `打开态 CSS 虽然命中了 ${affectedKey}，但没有恢复基础 CSS 隐藏掉的 ${missing.join(', ')}。`
    })
  }
  return findings.slice(0, 6)
}

function domExists(dom = {}, domIndex = {}) {
  if (dom.id) return domIndex.domById.has(dom.id)
  if (dom.selector?.startsWith('.')) return domIndex.classIndex.has(dom.selector.slice(1))
  return null
}

function buildMutationChain(mutation = {}, cssRules = [], domIndex = {}) {
  const css = classifyCssForMutation(mutation, cssRules, domIndex)
  const exists = domExists(mutation.dom, domIndex)
  const issues = []

  if (exists === false) {
    issues.push({
      severity: 'error',
      type: 'dom-target-missing',
      message: `JS 正在修改 ${selectorTokenForDom(mutation.dom)}，但已索引 HTML 中没有找到这个 DOM。`
    })
  }
  if (!css.direct.length && css.ancestorGated.length) {
    issues.push({
      severity: 'error',
      type: 'ui-state-owner-mismatch',
      message: `JS 把 .${mutation.className} 加在 ${selectorTokenForDom(mutation.dom)} 上，但 CSS 需要祖先元素拥有 .${mutation.className} 才能让它显示。`
    })
  } else if (!css.direct.length && !css.ancestorGated.length && css.stateOnly.length) {
    issues.push({
      severity: 'warning',
      type: 'state-class-target-not-covered',
      message: `CSS 里存在 .${mutation.className} 规则，但没有明确作用到 ${selectorTokenForDom(mutation.dom)}。`
    })
  } else if (!css.direct.length && !css.stateOnly.length) {
    issues.push({
      severity: 'warning',
      type: 'state-class-has-no-css-effect',
      message: `JS 修改了 .${mutation.className}，但没有找到匹配的 CSS 状态选择器。`
    })
  }
  for (const finding of css.hiddenVisibility) {
    issues.push({
      severity: 'error',
      type: 'hidden-property-not-restored',
      message: finding.message,
      affected: finding.affected,
      missing: finding.missing,
      hiddenRules: finding.hiddenRules,
      openRule: finding.openRule
    })
  }

  return {
    kind: 'class_state_chain',
    status: issues.some(item => item.severity === 'error') ? 'broken'
      : issues.length ? 'suspicious'
        : 'aligned',
    js: {
      path: mutation.path,
      line: mutation.line,
      action: mutation.action,
      target: selectorTokenForDom(mutation.dom),
      className: mutation.className,
      evidence: mutation.evidence
    },
    dom: {
      exists,
      target: selectorTokenForDom(mutation.dom),
      staticDefinition: mutation.dom.id ? domIndex.domById.get(mutation.dom.id) || null : null
    },
    css: {
      direct: css.direct,
      ancestorGated: css.ancestorGated,
      targetOnly: css.targetOnly.slice(0, 5),
      stateOnly: css.stateOnly.slice(0, 5),
      hiddenVisibility: css.hiddenVisibility
    },
    issues,
    recommendation: issues.find(item => item.type === 'ui-state-owner-mismatch')
      ? `把 .${mutation.className} 加到 CSS 真正要求的状态归属元素上，或补充能直接作用于 ${selectorTokenForDom(mutation.dom)}.${mutation.className} 的选择器。`
      : issues.find(item => item.type === 'hidden-property-not-restored')
        ? '打开态选择器已经匹配，但没有解除全部隐藏属性。需要在真正可见的菜单元素上恢复缺失的 display/visibility/opacity/pointer-events。'
      : issues.length
        ? '编辑前先核对返回的 JS/DOM/CSS 证据；当前可见状态可能没有接到这次 class 修改上。'
        : 'JS 状态修改、DOM 和 CSS 证据已对齐。'
  }
}

function buildLifecycleFindings(mutations = []) {
  const groups = new Map()
  for (const mutation of mutations) {
    const key = mutation.className
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(mutation)
  }
  const findings = []
  for (const [className, items] of groups.entries()) {
    const owners = [...new Set(items.map(item => selectorTokenForDom(item.dom)).filter(Boolean))]
    const actions = [...new Set(items.map(item => item.action))]
    if (owners.length > 6 && /^(show|active|open|selected|visible|hidden|expanded|collapsed)$/i.test(className)) continue
    if (owners.length > 1 && actions.some(action => ['toggle', 'add'].includes(action)) && actions.includes('remove')) {
      findings.push({
        severity: 'warning',
        type: 'state-lifecycle-owner-split',
        className,
        owners,
        message: `.${className} 的打开/关闭分散在多个 DOM 所有者上。需要确认打开、保持、关闭、重复打开是否都使用同一个状态归属。`,
        examples: items.slice(0, 8).map(item => ({
          path: item.path,
          line: item.line,
          action: item.action,
          target: selectorTokenForDom(item.dom),
          evidence: item.evidence
        }))
      })
    }
  }
  return findings
}

function traceUiRootCause(projectPath = '', input = {}) {
  const query = String(input.query || '')
  const files = Array.isArray(input.files) ? input.files : []
  const analysisFiles = collectAnalysisFiles(projectPath, files)
  const domIndex = { domById: new Map(), classIndex: new Map() }
  const cssRules = []
  const mutations = []
  const eventBindings = []
  const selectorLookups = []
  const analyzed = []

  for (const file of analysisFiles) {
    const content = safeRead(file)
    if (!content) continue
    const ext = path.extname(file).toLowerCase()
    analyzed.push(toProjectRelative(projectPath, file))

    if (['.html', '.htm'].includes(ext)) mergeDomIndex(domIndex, parseHtmlDom(content, file, projectPath))
    if (STYLE_EXTENSIONS.has(ext) || ['.html', '.htm'].includes(ext)) cssRules.push(...parseCssRules(content, file, projectPath))
    if (SCRIPT_EXTENSIONS.has(ext)) {
      const facts = parseJsFacts(content, file, projectPath)
      mutations.push(...facts.mutations)
      eventBindings.push(...facts.eventBindings)
      selectorLookups.push(...facts.selectors)
    }
  }

  const queryTerms = (query.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_-]{3,}/g) || [])
  const relevantMutations = mutations
    .map(item => {
      const haystack = `${item.path} ${item.variable} ${item.className} ${selectorTokenForDom(item.dom)} ${item.evidence}`.toLowerCase()
      const score = queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0)
      return { item, score }
    })
    .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path) || a.item.line - b.item.line)
    .map(entry => entry.item)

  const chains = relevantMutations.slice(0, 24).map(item => buildMutationChain(item, cssRules, domIndex))
  const broken = chains.filter(item => item.status === 'broken')
  const suspicious = chains.filter(item => item.status === 'suspicious')
  const lifecycleFindings = buildLifecycleFindings(relevantMutations)
  const clickBindings = eventBindings.filter(item => /click|mouseenter|change|input/.test(item.event)).slice(0, 24)

  return {
    success: true,
    tool: 'ui_root_cause_trace',
    query,
    analyzedFiles: analyzed,
    counts: {
      domIds: domIndex.domById.size,
      domClasses: domIndex.classIndex.size,
      cssRules: cssRules.length,
      classMutations: mutations.length,
      eventBindings: eventBindings.length,
      selectorLookups: selectorLookups.length
    },
    quality: {
      level: broken.length ? 'root-cause-candidate' : suspicious.length ? 'suspicious' : chains.length ? 'aligned' : 'no-ui-state-chain',
      brokenChains: broken.length,
      suspiciousChains: suspicious.length,
      checkedChains: chains.length
    },
    chains: chains.slice(0, 12),
    lifecycleFindings,
    eventBindings: clickBindings,
    selectorLookups: selectorLookups.slice(0, 24),
    next_action: broken.length
      ? '先把 broken class_state_chain 当作主根因候选；编辑前必须按 JS -> DOM -> CSS 隐藏/显示属性链路确认。'
      : suspicious.length
        ? '先审查 suspicious UI 状态链，对比 JS 修改目标和 CSS 选择器后再编辑。'
        : chains.length
          ? 'UI 状态链看起来对齐；下一步查运行时错误、初始化中断、层级遮挡、pointer-events 或目标进程错误。'
          : '没有找到 classList 驱动的 UI 状态链；下一步查运行日志或直接做 DOM/事件检查。'
  }
}

module.exports = {
  traceUiRootCause
}
