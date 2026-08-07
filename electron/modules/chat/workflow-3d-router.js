const systemPromptBuilder = require('../system-prompt-builder')
const { detectWorkbenchMentions } = systemPromptBuilder

function isExplicitBlenderPathIntent(message = '') {
  const text = String(message || '')
  if (!detectWorkbenchMentions(text).blender) return false
  if (!/(Blender|blender|布兰德)/i.test(text)) return false
  if (/(不要|别|无需|不需要|禁止|不要再|别再|不用|不许).{0,10}(Blender|blender|布兰德)|(Blender|blender|布兰德).{0,10}(不要用|别用|不用|不需要|禁止|不要打开|别打开)/i.test(text)) return false
  return /(用|使用|直接|通过|打开|运行|脚本|Python|python|构建|创建|制作|做)/i.test(text)
}

function hasBlenderToolPath(toolCalls = []) {
  return toolCalls.some(call => /^blender_/.test(String(call?.name || '')))
}

function hasNoRelayIntent(message = '') {
  return /(不要|别|无需|不需要|禁止|不要再|别再|不用|不许).{0,12}(接力|接力工作流|relay|多agent|多 Agent|工作流)/i.test(String(message || ''))
}

function hasNoBlenderIntent(message = '') {
  const text = String(message || '')
  return /(不要|别|无需|不需要|禁止|不要再|别再|不用|不许).{0,12}(Blender|blender|布兰德|打开\s*Blender)|(Blender|blender|布兰德).{0,12}(不要用|别用|不用|不需要|禁止|不要打开|别打开)/i.test(text)
}

function get3DWorkflowRoute(message = '', toolCalls = []) {
  const hasBlender = hasBlenderToolPath(toolCalls)
  if (hasBlender) return hasNoRelayIntent(message) ? 'blender_direct' : 'blender'
  if (isExplicitBlenderPathIntent(message)) return hasNoRelayIntent(message) ? 'blender_direct' : 'blender'
  return 'none'
}

module.exports = {
  isExplicitBlenderPathIntent,
  hasBlenderToolPath,
  hasNoRelayIntent,
  hasNoBlenderIntent,
  get3DWorkflowRoute
}
