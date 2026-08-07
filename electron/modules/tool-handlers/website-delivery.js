/**
 * website_delivery 工具处理
 */

const path = require('path')
const featureSettings = require('../feature-settings')
const delivery = require('../website-delivery')
const config = require('../config')
const projects = require('../projects')

function disabledResult() {
  return {
    success: false,
    disabled: true,
    error: '网页交付已关闭。请在 设置 → 能力开关 中开启「网页交付」。',
    next_action: 'ask_user_to_enable_website_delivery'
  }
}

function ensureEnabled() {
  return featureSettings.isFeatureEnabled('website_delivery')
}

async function openPreview(projectPath, siteDir, projectId) {
  const status = delivery.getStatus({ projectPath, siteDir })
  if (!status.initialized) {
    return { success: false, error: '未找到站点，请先 init', error_type: 'not_found' }
  }
  const url = status.preview_url
  let previewResult = null
  try {
    const browserTool = require('../../tools/browser-tool-secure')
    if (typeof browserTool.lxweb === 'function') {
      previewResult = await browserTool.lxweb(
        { action: 'open_right', url },
        {
          projectId,
          webContents: projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
        }
      )
    }
  } catch (err) {
    previewResult = { success: false, error: err?.message || String(err) }
  }

  // 兜底：系统浏览器
  if (!previewResult?.success) {
    try {
      const { shell } = require('electron')
      await shell.openExternal(url)
      previewResult = { success: true, opened: 'system_browser', url }
    } catch (err) {
      previewResult = {
        success: false,
        error: previewResult?.error || err?.message || '无法打开预览',
        url
      }
    }
  }

  const siteRoot = status.site_root
  const manifest = delivery.loadManifest(siteRoot) || {}
  delivery.setStage({ projectPath, siteDir: status.site_dir, stage: manifest.stage === 'done' ? 'done' : 'preview' })
  const next = delivery.loadManifest(siteRoot)
  if (next) {
    const websiteDelivery = require('../website-delivery')
    // mark preview opened via saveManifest path
    const fs = require('fs')
    const mp = path.join(siteRoot, websiteDelivery.MANIFEST_NAME)
    try {
      const data = JSON.parse(fs.readFileSync(mp, 'utf8'))
      data.previewOpened = true
      data.updatedAt = Date.now()
      fs.writeFileSync(mp, JSON.stringify(data, null, 2), 'utf8')
    } catch (_) { /* ignore */ }
  }

  return {
    success: !!previewResult?.success,
    preview_url: url,
    index_path: status.index_path,
    preview: previewResult,
    message: previewResult?.success
      ? '已打开站点预览。骨架阶段即可先给用户看进度，再按设计选择完善内容。'
      : (previewResult?.error || '预览打开失败'),
    error: previewResult?.success ? undefined : previewResult?.error
  }
}

async function presentChoices(args, ctx) {
  const projectPath = ctx.projectPath || ''
  const projectId = ctx.projectId || ''
  const status = delivery.getStatus({ projectPath, siteDir: args.site_dir || '' })
  if (!status.initialized) {
    return { success: false, error: '未找到站点，请先 init', error_type: 'not_found' }
  }
  const manifest = status.manifest || {}
  const options = delivery.buildPresentPayload(manifest, status.site_root)
  if (options.length < 2) {
    return {
      success: false,
      error: `设计选项不足（当前 ${options.length} 个），请先 save_option 至少 2 个（建议 3 个）`,
      error_type: 'invalid_tool_args',
      options_count: options.length
    }
  }

  // 延迟加载，避免与 tools 循环依赖
  const tools = require('../tools')
  const webContents = projectId
    ? projects.getWebContentsForProject(projectId)
    : config.getMainWindow()?.webContents
  const requestId = tools.createAskRequestId
    ? tools.createAskRequestId(projectId, 'design')
    : `design-${Date.now()}`
  const question = String(args.question || '请选择一个视觉方向（可稍后微调）')

  webContents?.send('show-ask-popup', {
    requestId,
    type: 'plan',
    layout: 'design',
    projectId,
    question,
    options,
    recommended: options[0]?.value
  })

  try {
    require('../desktop-pet').notifyAiStatus('waiting')
  } catch (_) { /* ignore */ }

  let response
  try {
    response = await tools.waitForAskResponse(projectId, requestId)
  } finally {
    try {
      require('../desktop-pet').notifyAiStatus('running')
    } catch (_) { /* ignore */ }
  }

  const value = response?.value || response?.answer || ''
  const label = response?.label || response?.answer || value
  if (!value || value === 'superseded' || response?.status === 'user_rejected') {
    return {
      success: false,
      cancelled: true,
      response,
      error: '用户未选择设计方向或已取消',
      next_action: '可重新 present_choices 或根据用户文字说明继续'
    }
  }

  const recorded = delivery.recordSelection({
    projectPath,
    siteDir: status.site_dir,
    optionId: value,
    answer: label
  })

  return {
    success: true,
    selected_value: value,
    selected_label: label,
    response,
    ...recorded,
    next_steps: [
      '按 selected.brief / title 实现完整页面（替换骨架）',
      'open_preview 检查效果',
      'finalize 收尾'
    ]
  }
}

const handlers = {
  website_delivery: async (args = {}, ctx = {}) => {
    if (!ensureEnabled()) return disabledResult()

    const action = String(args.action || args.method || '').trim().toLowerCase()
    const projectPath = ctx.projectPath || ''
    const projectId = ctx.projectId || ''

    switch (action) {
      case 'init':
        return delivery.initSite({
          projectPath,
          siteDir: args.site_dir || args.siteDir || 'site',
          title: args.title || '',
          description: args.description || ''
        })
      case 'save_option':
        return delivery.saveOption({
          projectPath,
          siteDir: args.site_dir || args.siteDir || '',
          id: args.id || '',
          title: args.title || '',
          html: args.html || args.preview_html || '',
          brief: args.brief || args.desc || args.description || '',
          colors: args.colors || args.palette || ''
        })
      case 'present_choices':
      case 'present_design_choices':
      case 'choose':
        return presentChoices(args, ctx)
      case 'open_preview':
      case 'preview':
        return openPreview(projectPath, args.site_dir || args.siteDir || '', projectId)
      case 'get_status':
      case 'status':
        return delivery.getStatus({
          projectPath,
          siteDir: args.site_dir || args.siteDir || ''
        })
      case 'set_stage':
        return delivery.setStage({
          projectPath,
          siteDir: args.site_dir || args.siteDir || '',
          stage: args.stage || ''
        })
      case 'finalize':
      case 'finish':
        return delivery.finalizeSite({
          projectPath,
          siteDir: args.site_dir || args.siteDir || '',
          title: args.title || ''
        })
      default:
        return {
          success: false,
          error: `website_delivery 不支持 action=${action || '(empty)'}。可用：init|save_option|present_choices|open_preview|get_status|set_stage|finalize`,
          error_type: 'invalid_tool_args',
          recoverable: true
        }
    }
  }
}

module.exports = { handlers }
