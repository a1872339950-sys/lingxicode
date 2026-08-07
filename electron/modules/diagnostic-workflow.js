const FAILURE_INTENT_PATTERN = /(bug|error|exception|failed|failure|crash|hang|freeze|not\s+working|no\s+response|broken|regression|syntax|compile|typeerror|referenceerror|undefined|cannot|报错|错误|异常|失败|崩溃|卡死|卡顿|未响应|无反应|没反应|不生效|打不开|启动失败|语法错误|类型错误|又坏了|依旧|还是|没有修复)/i
const BROAD_FAILURE_INTENT_PATTERN = /(全面|全量|整体|整个|全项目|此项目|这个项目|项目里|项目内|有一些问题|多个问题|各种问题|一堆问题|全面排查|全面检查|全面修复|排查并修复|找出.*问题|看看.*问题)/i
const REAL_ENTRY_EVIDENCE_PATTERN = /(stack|trace|line\s*\d+|:\d+:\d+|referenceerror|typeerror|syntaxerror|cannot|undefined|not defined|exit\s*code|stderr|stdout|日志|堆栈|行号|复现|启动|运行|点击|接口|入口|事件|ipc|api|handler|route|command|命令输出)/i
const CONTRACT_EVIDENCE_PATTERN = /(contract|boundary|export|import|require|global|window\.|ipcmain|ipcrenderer|invoke|handle\(|schema|route|handler|event|listener|call|reference|调用|引用|导出|导入|入口|契约|边界|事件|监听|全局|兼容|接线|注册)/i
const VERIFICATION_EVIDENCE_PATTERN = /(node --check|tsc|eslint|lint|npm|pnpm|yarn|test|build|pytest|go test|cargo test|scenario|real-scenario|verify|验证|检查|测试|构建|语法|类型|真实场景)/i

const BROAD_DIAGNOSTIC_TRACKS = [
  ['runtime-contract', '运行时契约/API/IPC/全局导出', /(typeerror|referenceerror|undefined|not defined|cannot read|window\.|global|export|import|require|ipcmain|ipcrenderer|invoke|handle\(|contextbridge|handler|schema|executor|调用|引用|导出|导入|契约|接线|注册|全局)/i],
  ['ui-interaction', 'UI 入口/点击/事件绑定', /(click|onclick|addeventlistener|queryselector|getelementbyid|classlist|panel|modal|button|menu|tab|render|dom|点击|按钮|入口|菜单|面板|弹窗|事件|绑定|渲染|无反应|没反应)/i],
  ['business-calculation', '业务计算/费用/排序/规则结果', /(cost|price|amount|budget|estimate|token|cache|cached|miss|rate|score|sort|rank|priority|calculate|计算|费用|金额|预算|缓存|命中率|排序|评分|优先级|规则|结果不对)/i],
  ['search-location', '搜索定位/召回/排序质量', /(search|grep|rg|codemap|code-map|discover_code|query_code_map|candidate|readhints|locate|find|搜索|查找|定位|召回|候选|代码地图|文件位置)/i],
  ['state-isolation', '状态隔离/项目隔离/缓存串用', /(projectid|activeproject|projectpath|session|cache|state|store|runtime|default|global|isolation|context|项目隔离|项目切换|串项目|状态|缓存|会话|上下文|全局共享)/i],
  ['storage-path', '持久化/路径/配置来源', /(storage|persist|path\.join|path\.resolve|fs\.|readfile|writefile|mkdir|config|fallback|history|保存|加载|持久化|路径|目录|配置|落盘|恢复点)/i],
  ['verification', '语法/构建/真实路径验证', VERIFICATION_EVIDENCE_PATTERN]
]

function isFailureLikeRequest(text = '') {
  return FAILURE_INTENT_PATTERN.test(String(text || ''))
}

function isBroadFailureLikeRequest(text = '') {
  const value = String(text || '')
  return BROAD_FAILURE_INTENT_PATTERN.test(value) && /(问题|排查|检查|修复|异常|错误|bug|不对|不生效|没反应|无反应|failed|failure|wrong|broken|fix|diagnose)/i.test(value)
}

function hasRealEntryEvidence(activity = {}) {
  const text = String(activity.text || '')
  return REAL_ENTRY_EVIDENCE_PATTERN.test(text) || Number(activity.commandCount || 0) > 0 || Number(activity.failedVerifyCount || 0) > 0
}

function hasContractEvidence(activity = {}) {
  return CONTRACT_EVIDENCE_PATTERN.test(String(activity.text || ''))
}

function hasVerificationEvidence(activity = {}) {
  const text = String(activity.text || '')
  return VERIFICATION_EVIDENCE_PATTERN.test(text) || Number(activity.verifyCount || 0) > 0 || Number(activity.postWriteVerifyCount || 0) > 0
}

function getBroadDiagnosticCoverage(activity = {}) {
  const text = `${activity.text || ''}\n${activity.commandText || ''}`
  const covered = BROAD_DIAGNOSTIC_TRACKS
    .filter(([, , pattern]) => pattern.test(text))
    .map(([key, label]) => ({ key, label }))
  const missing = BROAD_DIAGNOSTIC_TRACKS
    .filter(([key]) => !covered.some(item => item.key === key))
    .map(([key, label]) => ({ key, label }))
  return {
    covered,
    missing,
    coveredCount: covered.length,
    requiredCount: 4,
    isEnough: covered.length >= 4 && covered.some(item => item.key === 'verification')
  }
}

function getDiagnosticStage({ userMessage = '', activity = {} } = {}) {
  if (!isFailureLikeRequest(userMessage) && !isBroadFailureLikeRequest(userMessage) && !activity.hasFailureEvidence && Number(activity.failedVerifyCount || 0) === 0) {
    return null
  }

  if (!hasRealEntryEvidence(activity)) return 'reproduce-entry'
  if (isBroadFailureLikeRequest(userMessage) && !getBroadDiagnosticCoverage(activity).isEnough) return 'broad-coverage'
  if (!hasContractEvidence(activity)) return 'contract-boundary'
  if (Number(activity.writeCount || 0) > 0 && !hasVerificationEvidence(activity)) return 'verify-fix'
  return null
}

function buildGenericDiagnosticProtocolPrompt() {
  return `
===== Generic Failure Diagnostic Protocol =====
- This protocol is universal. It applies to frontend, backend, Electron main/preload, tools, IPC/API, CLI commands, storage, search, editing, model calls, and integrations.
- When the user reports failure, no response, wrong behavior, regression, syntax error, startup failure, tool failure, or "still not fixed", do not guess from file names alone.
- First reproduce or trace the real entry path: user action, command, API/IPC call, route, event listener, startup chain, persisted state, or log/stack output.
- Capture the first blocking error or first broken contract. Prefer the earliest thrown exception, failed command output, missing export/import, missing global bridge, wrong handler name, bad schema, stale reference, or state source mismatch.
- Then check the boundary contract around it: provider/consumer, export/import, event binding, IPC/API request and response, tool schema and executor, storage key, config source, lifecycle order, and compatibility entry.
- If the user gives a broad report such as "the project has some issues" or "fully diagnose and fix", do not stop after one convenient finding. Cover several likely failure classes before editing or before final delivery: runtime contracts, UI/event entry, business calculation or ranking, search/location quality, state/project isolation, storage/config, and verification. Use evidence to rule areas in or out.
- Treat this as a soft diagnostic rhythm, not a hard gate. If a real blocking error is already proven, fix it directly and verify it; do not loop just to satisfy a checklist.
- Prefer dev_workflow mode=health for broad project issues, unknown failures, test-field scans, runtime/UI reports, and "fully diagnose" requests. mode=triage is still acceptable, but it must include the same project_health_scan result instead of stopping at syntax + logic_review.
- Fix the smallest real cause. Do not add parallel implementations, broad rewrites, or hardcoded task-specific shortcuts unless the root cause proves that is the correct design.
- After the fix, run the narrowest reliable verification that exercises the real path. If no ready-made test exists, add a small real scenario that reproduces the broken contract and would fail before the fix.
- Final reply should say: root cause, changed contract or file, verification. Do not expose internal protocol names to the user.
`
}

function buildDiagnosticCheckpoint(stage, taskType = 'bugfix') {
  if (stage === 'reproduce-entry') {
    return {
      key: `${taskType}:generic-diagnostic-reproduce`,
      status: '先复现真实入口，抓第一个断点。',
      content: '执行要求：这是通用故障诊断，不要先猜文件或直接改。下一步必须调用工具复现或追踪真实入口：用户动作、启动链、命令、API/IPC、事件监听、工具调用、日志或堆栈。目标是找到第一个阻塞错误或第一处断开的契约，再决定修改位置。'
    }
  }

  if (stage === 'contract-boundary') {
    return {
      key: `${taskType}:generic-diagnostic-contract`,
      status: '入口已找到，继续核对边界契约。',
      content: '执行要求：已经有现象或错误线索，但还缺少边界契约证据。下一步必须检查提供方和消费方是否接上：导入/导出、事件绑定、全局兼容入口、IPC/API handler、工具 schema/executor、配置/状态来源、调用顺序或持久化键。不要只修表面现象。'
    }
  }

  if (stage === 'broad-coverage') {
    return {
      key: `${taskType}:generic-diagnostic-broad-coverage`,
      status: '这是宽泛故障，继续覆盖不同故障面。',
      content: '执行要求：用户没有精确指出文件或模块，不能只修一个自己搜到的风险点就结束。下一步必须继续用工具覆盖多类故障证据：运行时契约/API/IPC/全局导出、UI 入口/点击/事件绑定、业务计算/费用/排序结果、搜索定位质量、状态/项目隔离、持久化/路径/配置来源，以及语法/构建/真实路径验证。至少覆盖其中 4 类并包含验证证据，再决定修改或总结；发现真实问题后按最小改动修复。'
    }
  }

  if (stage === 'verify-fix') {
    return {
      key: `${taskType}:generic-diagnostic-verify`,
      status: '已修复，继续跑真实路径验证。',
      content: '执行要求：已经修改代码，下一步必须运行能覆盖真实故障路径的检查：语法/类型/测试/构建/启动/真实场景之一。若项目没有现成覆盖，用最小 real scenario 固化这次断裂的契约，避免下次同类回归。'
    }
  }

  return null
}

module.exports = {
  isFailureLikeRequest,
  isBroadFailureLikeRequest,
  hasRealEntryEvidence,
  hasContractEvidence,
  hasVerificationEvidence,
  getBroadDiagnosticCoverage,
  getDiagnosticStage,
  buildGenericDiagnosticProtocolPrompt,
  buildDiagnosticCheckpoint
}
