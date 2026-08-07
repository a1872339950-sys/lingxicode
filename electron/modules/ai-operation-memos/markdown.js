function localTime(value = null) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

function tableEscape(value = '') {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function clip(value = '', max = 900) {
  const text = String(value || '').trim()
  return text.length > max ? `${text.slice(0, max).trim()}...` : text
}

function statusLabel(status = '') {
  if (status === 'created') return '新增'
  if (status === 'deleted') return '删除'
  return '修改'
}

function durationSeconds(facts = {}) {
  const explicit = Number(facts.durationMs || 0)
  if (explicit > 0) return Math.max(1, Math.round(explicit / 1000))
  const started = Date.parse(facts.startedAt || '')
  const completed = Date.parse(facts.completedAt || '')
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return 0
  return Math.max(1, Math.round((completed - started) / 1000))
}

function commandLabel(command = {}) {
  const state = command.success ? '成功' : '失败'
  const kind = command.mutatesFiles ? '可能改动文件' : '只读'
  return `- ${state} / ${kind} / \`${command.command}\``
}

function listOrDash(items = []) {
  const list = (Array.isArray(items) ? items : []).map(item => String(item || '').trim()).filter(Boolean)
  return list.length ? list.join('<br>') : '-'
}

function buildModelChangeTable(changes = []) {
  const lines = []
  lines.push('| 文件 | 模块 | 功能/函数 | 行号范围 | 调用链 | 影响面 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  changes.forEach(change => {
    lines.push([
      tableEscape(change.path),
      tableEscape(change.module || '-'),
      tableEscape([change.purpose, ...(change.functions || [])].filter(Boolean).join('<br>') || '-'),
      tableEscape(listOrDash(change.lineRanges)),
      tableEscape(listOrDash(change.callChain)),
      tableEscape(listOrDash(change.impact))
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  })
  return lines
}

function buildMemoMarkdown(facts = {}) {
  const lines = []
  const stats = facts.stats || {}
  const files = Array.isArray(facts.files) ? facts.files : []
  const commands = Array.isArray(facts.commands) ? facts.commands : []
  const modelMemo = facts.modelMemo || {}
  const modelChanges = Array.isArray(modelMemo.changes) ? modelMemo.changes : []

  lines.push(`# ${facts.title || 'AI 操作备忘录'}`)
  lines.push('')
  lines.push('> 给后续 AI 使用的结构化备忘录。它是上一轮模型的主动记录加系统采集事实，不是硬证据；后续修改前仍需读取真实源码、调用链和运行结果确认。')
  lines.push('')
  lines.push('## 任务')
  lines.push('')
  lines.push(`- 用户要求：${facts.userMessage ? clip(facts.userMessage, 500) : '未记录'}`)
  if (modelMemo.intent) lines.push(`- 模型理解：${clip(modelMemo.intent, 500)}`)
  lines.push('')
  lines.push('## 一句话结论')
  lines.push('')
  lines.push(modelMemo.summary ? clip(modelMemo.summary, 900) : (facts.finalSummary ? clip(facts.finalSummary, 900) : '- 未记录'))
  lines.push('')
  lines.push('## 代码定位')
  lines.push('')
  if (modelChanges.length) {
    lines.push(...buildModelChangeTable(modelChanges))
  } else {
    lines.push('- 本轮模型未填写模块/函数/行号级定位。')
  }
  lines.push('')
  const cautions = modelChanges.map(change => change.caution).filter(Boolean)
  if (cautions.length || modelMemo.uncertainty?.length) {
    lines.push('## 不确定点')
    lines.push('')
    cautions.forEach(item => lines.push(`- ${clip(item, 240)}`))
    ;(modelMemo.uncertainty || []).forEach(item => lines.push(`- ${clip(item, 240)}`))
    lines.push('')
  }
  lines.push('## 文件改动事实')
  lines.push('')
  lines.push(`修改 ${stats.modified || 0} 个，新建 ${stats.created || 0} 个，删除 ${stats.deleted || 0} 个，合计 +${stats.additions || 0} / -${stats.deletions || 0}。`)
  lines.push('')
  if (files.length) {
    lines.push('| 状态 | 文件 | + | - |')
    lines.push('| --- | --- | ---: | ---: |')
    files.forEach(file => {
      lines.push(`| ${statusLabel(file.status)} | ${tableEscape(file.path)} | ${Number(file.additions || 0)} | ${Number(file.deletions || 0)} |`)
    })
  } else if (commands.length) {
    lines.push('- 未采集到逐文件快照，但本轮记录到项目内修改命令；删除、移动或批量脚本类改动需结合命令和当前文件状态确认。')
  } else {
    lines.push('- 系统未采集到项目内业务文件改动，或本轮只记录了模型主动定位信息。')
  }
  lines.push('')
  lines.push('## 验证')
  lines.push('')
  if (modelMemo.verification?.length) {
    modelMemo.verification.forEach(item => lines.push(`- ${clip(item, 260)}`))
  } else if (commands.length) {
    commands.slice(0, 12).forEach(command => lines.push(commandLabel(command)))
    if (commands.length > 12) lines.push(`- 还有 ${commands.length - 12} 条命令未展开。`)
  } else {
    lines.push('- 未记录验证步骤。')
  }
  lines.push('')
  if (modelMemo.followUps?.length) {
    lines.push('## 后续注意')
    lines.push('')
    modelMemo.followUps.forEach(item => lines.push(`- ${clip(item, 260)}`))
    lines.push('')
  }
  lines.push('## 元数据')
  lines.push('')
  lines.push(`- 项目路径：${facts.projectPath || ''}`)
  lines.push(`- 项目 ID：${facts.projectId || ''}`)
  lines.push(`- 请求 ID：${facts.requestId || ''}`)
  lines.push(`- 改动会话：${facts.changeSessionId || ''}`)
  lines.push(`- 模型：${facts.modelName || ''}`)
  lines.push(`- 开始时间：${localTime(facts.startedAt)}`)
  lines.push(`- 完成时间：${localTime(facts.completedAt)}`)
  lines.push(`- 耗时：${durationSeconds(facts)} 秒`)
  if (stats.outsideProjectOps > 0) lines.push(`- 项目外操作：检测到 ${stats.outsideProjectOps} 个，未纳入本项目备忘录。`)
  if (facts.snapshot?.after?.commit || facts.snapshot?.after?.hash) {
    lines.push(`- 安全快照：${facts.snapshot.after.commit || facts.snapshot.after.hash}`)
  }

  return lines.join('\n')
}

module.exports = {
  buildMemoMarkdown
}
