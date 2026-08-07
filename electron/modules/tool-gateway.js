/**
 * Thin tool gateway.
 *
 * It centralizes "office -> registry -> legacy" dispatch order and builds the
 * shared handler context. Pre/post permission, observation, and recording still
 * live in tools.js for now; this file is the migration point for those concerns.
 */

const toolRegistry = require('./tool-registry')
const officeHandlers = require('./office-handlers')

function featureGateResult(name = '') {
  try {
    const featureSettings = require('./feature-settings')
    if (featureSettings.isToolAllowedByFeatures(name)) return null
    const feature = featureSettings.getFeatureForTool(name)
    const title = feature?.title || name
    return {
      handled: true,
      source: 'feature-settings',
      meta: toolRegistry.getToolMeta(name),
      result: {
        success: false,
        disabled: true,
        error: `能力「${title}」已关闭。请在 设置 → 能力开关 中开启后再试。`,
        feature_id: feature?.id || '',
        next_action: 'ask_user_to_enable_feature_in_settings'
      }
    }
  } catch {
    return null
  }
}

async function dispatchTool(call = {}) {
  const {
    name,
    args = {},
    projectPath,
    resolvePath,
    projectId,
    modelConfig,
    options = {},
    contextManager,
    signal,
    executeToolForProject
  } = call

  const gated = featureGateResult(name)
  if (gated) return gated

  const officeResult = await officeHandlers.handleOfficeTool(name, args)
  if (officeResult.handled) {
    return {
      handled: true,
      source: 'office',
      meta: toolRegistry.getToolMeta(name),
      result: officeResult.result
    }
  }

  const handler = toolRegistry.getToolHandler(name)
  if (!handler) {
    return {
      handled: false,
      source: 'legacy',
      meta: toolRegistry.getToolMeta(name)
    }
  }

  const ctx = {
    projectPath,
    resolvePath,
    projectId,
    modelConfig,
    options,
    contextManager,
    signal,
    registry: toolRegistry,
    dispatch: (toolName, toolArgs, toolOptions) => executeToolForProject(
      toolName,
      toolArgs,
      projectPath,
      resolvePath,
      contextManager,
      projectId,
      modelConfig,
      {
        ...options,
        parentToolTraceId: options.toolTraceId || options.parentToolTraceId || '',
        parentToolName: name,
        ...(toolOptions || {})
      }
    )
  }

  return {
    handled: true,
    source: 'registry',
    meta: toolRegistry.getToolMeta(name),
    result: await handler(args || {}, ctx)
  }
}

module.exports = {
  dispatchTool
}
