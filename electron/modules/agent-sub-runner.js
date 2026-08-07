const path = require('path')
const {
  getApiFormat,
  buildApiEndpoint,
  buildApiHeaders,
  buildApiFetchOptions,
  shouldAvoidPersistentModelConnection,
  retryPreResponseSocketClose,
  buildModelRequestBody,
  formatModelTransportError,
  parseGeminiStreamPayload,
  createAnthropicStreamState,
  parseModelStreamEvent
} = require('./model-api-adapter')
const { stableJsonStringify } = require('./prompt-stability')
const { createToolFailureRecoveryTracker } = require('./tool-failure-recovery')

const MODEL_FIRST_RESPONSE_TIMEOUT_MS = 60 * 1000
const MODEL_TOTAL_TIMEOUT_MS = 5 * 60 * 1000

// These tools would recursively open another coordination workflow or ask the
// end user questions from a hidden right-side session. The work session should
// use normal project tools, then report back to the main-window AI.
const COLLAB_DISABLED_TOOLS = [
  'request_agent_collaboration',
  'get_agent_collaboration_status',
  'enter_plan_mode',
  'ask_user_choice',
  'confirm_plan',
  'complete_step'
]

function logSession(...args) {
  console.log('[AiWorkSession]', ...args)
}

function safeJsonParse(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function safeJsonStringify(value, limit = 8000) {
  let text = ''
  try {
    text = JSON.stringify(value)
  } catch {
    text = String(value || '')
  }
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function summarizeToolResultForWorkSession(toolName, result) {
  const text = safeJsonStringify(result, 12000)
  if (text.length <= 5000) return result

  const summary = {
    success: result?.success,
    error: result?.error,
    status: result?.status,
    path: result?.path,
    message: result?.message
  }

  if (toolName === 'read_file' || toolName === 'file_read') {
    summary.file_type = result?.file_type
    summary.line_count = result?.line_count
    summary.contentPreview = String(result?.content || '').slice(0, 2400)
    summary.truncated = String(result?.content || '').length > 2400
  } else if (toolName === 'run_command' || toolName === 'shell_run') {
    summary.command = result?.command
    summary.exitCode = result?.exitCode
    summary.stdout = String(result?.stdout || '').slice(-2400)
    summary.stderr = String(result?.stderr || '').slice(-1600)
  } else if (Array.isArray(result?.files)) {
    summary.count = result.files.length
    summary.files = result.files.slice(0, 120)
  } else if (Array.isArray(result?.matches)) {
    summary.count = result.matches.length
    summary.matches = result.matches.slice(0, 80)
  } else {
    summary.resultPreview = text.slice(0, 2400)
    summary.truncated = text.length > 2400
  }

  return summary
}

function readAgentWrittenReport(reportFilePath = '') {
  if (!reportFilePath) return { exists: false, content: '' }
  try {
    if (!require('fs').existsSync(reportFilePath)) return { exists: false, content: '' }
    const content = require('fs').readFileSync(reportFilePath, 'utf-8').trim()
    return { exists: true, content }
  } catch (error) {
    return { exists: false, content: '', error: error.message }
  }
}

function buildMissingWrittenReportMessage({ agent = {}, toolCalls = [], finalContent = '', reportFilePath = '' }) {
  const lines = [
    '协作 AI 没有按要求写入临时汇报文件，因此本次没有可展示的有效汇报内容。',
    '',
    '## 原因',
    `- 期望汇报文件: ${reportFilePath || '未指定'}`,
    `- 工具调用次数: ${toolCalls.length}`,
    '- 右侧 AI 必须用 write_file 写入 Markdown 汇报，聊天正文或过程性文字不会被当作有效汇报。',
    '',
    '## 右侧 AI 最后正文',
    String(finalContent || '无').slice(0, 1200),
    '',
    '## 任务',
    agent.task || agent.role || agent.name || '未提供具体任务'
  ]
  return lines.join('\n')
}

function getModelId(modelConfig = {}) {
  return modelConfig.modelId || modelConfig.modelName || modelConfig.model || ''
}

function getModelLabel(modelConfig = {}) {
  return modelConfig.displayName || modelConfig.modelName || modelConfig.modelId || modelConfig.model || '当前模型'
}

function resolveProjectPath(projectPath, inputPath) {
  if (!inputPath) return projectPath
  const normalized = String(inputPath).replace(/\//g, path.sep)
  if (path.isAbsolute(normalized)) return normalized
  return path.join(projectPath, normalized)
}

function buildWorkSessionSystemPrompt({ agent = {}, projectPath = '', mode = 'serial', reportDir = '', reportFilePath = '' }) {
  const title = agent.name || agent.role || agent.id || '协作 AI'
  return [
    `你是主窗口 AI 打开的一个右侧 AI 工作会话：${title}。`,
    `协作模式：${mode}。`,
    `项目路径：${projectPath || '未指定'}。`,
    `临时汇报目录：${reportDir || '由系统保存，当前未暴露路径'}。`,
    `你的最终汇报文件路径：${reportFilePath || '未指定'}。`,
    '',
    '你不是装饰面板，也不是只写建议。你要像一个独立聊天窗口里的 AI 一样，根据任务真实读取文件、搜索代码、运行检查或修改文件。',
    '你拥有完整项目工具集。除非任务不需要，否则应主动使用工具完成工作。',
    '你不会看到主聊天完整上下文，只接收主窗口 AI 分配给你的任务、路径、边界和验收标准。',
    '你的执行过程不进入主聊天上下文；最终必须把结构化汇报写入上面的最终汇报文件路径。',
    '完成任务后必须调用 write_file，把完整 Markdown 汇报写入最终汇报文件路径。只在聊天正文里说“已完成”不算完成。',
    '不要声称你已经自动把报告发送给主窗口 AI。是否把临时汇报发送给主窗口 AI 分析总结，必须由用户在主界面点击确认。',
    '严格围绕分配任务工作，不要扩散到无关重构。',
    '如果修改了文件，最终报告必须列出修改路径、修改目的、验证命令和结果。',
    '如果只做审查，最终报告必须列出证据路径、行号或命令输出摘要。',
    '最终汇报文件必须包含：已做什么、关键发现、涉及文件/行号或命令证据、修改内容、验证结果、风险和建议。',
    '最终报告写给系统保存，不要对用户宣称最终交付完成。'
  ].join('\n')
}

function buildWorkSessionUserPrompt({ agent = {}, mainPlan = [], coordinationNote = '', reportDir = '', reportFilePath = '' }) {
  const planText = Array.isArray(mainPlan) && mainPlan.length
    ? mainPlan.map((step, index) => `${index + 1}. ${step.title || step.name || step.task || step}`).join('\n')
    : '无主计划。'
  const focusPaths = Array.isArray(agent.focusPaths) && agent.focusPaths.length
    ? agent.focusPaths.join('\n')
    : '未指定。请按任务自行定位相关文件。'
  const upstreamContext = String(agent.upstreamContext || '').trim()

  return [
    `任务角色：${agent.role || agent.name || '协作 AI'}`,
    `具体任务：${agent.task || '未提供具体任务，请先摸清相关范围并汇报。'}`,
    '',
    '主计划：',
    planText,
    '',
    '建议关注路径：',
    focusPaths,
    '',
    ...(upstreamContext ? [
      '上游节点交付：',
      upstreamContext,
      '',
      '你必须把上游交付作为输入继续处理，但仍需自行判断和验证其中的信息。',
      ''
    ] : []),
    '协作说明：',
    coordinationNote || '完成你的工序后输出结构化报告内容，由系统保存为临时汇报文件。',
    '',
    '临时汇报文件规则：',
    `- 系统保存目录：${reportDir || '未暴露路径'}`,
    `- 你必须写入的汇报文件：${reportFilePath || '未指定'}`,
    '- 完成任务后必须调用 write_file，把完整 Markdown 汇报保存到这个路径。',
    '- 这个 write_file 是你的最终交付动作；不要只输出聊天正文。',
    '- 不要写“已汇报给主窗口 AI”。只能写“已形成结构化汇报内容”。',
    '- 用户稍后会决定是否把临时汇报发送给主窗口 AI 分析总结。',
    '',
    '开始执行。需要信息就使用工具获取；完成后输出结构化报告。'
  ].join('\n')
}

function composeAbortSignal(signals = []) {
  const controller = new AbortController()
  const abort = reason => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      abort(signal.reason || new Error('aborted'))
      break
    }

    signal.addEventListener?.('abort', () => abort(signal.reason || new Error('aborted')), { once: true })
  }
  return controller
}

function createStreamEmitter(onDelta) {
  const state = {
    contentBuffer: '',
    reasoningBuffer: '',
    lastContentAt: 0,
    lastReasoningAt: 0
  }

  function flush(kind, force = false) {
    const now = Date.now()
    if (kind === 'content') {
      if (!state.contentBuffer) return
      if (!force && now - state.lastContentAt < 180) return
      const delta = state.contentBuffer
      state.contentBuffer = ''
      state.lastContentAt = now
      onDelta?.({ type: 'content_delta', content: delta })
    } else if (kind === 'reasoning') {
      if (!state.reasoningBuffer) return
      if (!force && now - state.lastReasoningAt < 360) return
      const delta = state.reasoningBuffer
      state.reasoningBuffer = ''
      state.lastReasoningAt = now
      onDelta?.({ type: 'reasoning_delta', content: delta })
    }
  }

  return {
    pushContent(delta = '') {
      if (!delta) return
      state.contentBuffer += delta
      flush('content')
    },
    pushReasoning(delta = '') {
      if (!delta) return
      state.reasoningBuffer += delta
      flush('reasoning')
    },
    flushAll() {
      flush('content', true)
      flush('reasoning', true)
    }
  }
}

async function readStreamResponse({ response, apiFormat, onDelta }) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const streamState = createAnthropicStreamState()
  const emitter = createStreamEmitter(onDelta)
  let buffer = ''
  let content = ''
  let rawGeminiStream = ''
  let reasoning = ''
  const toolCalls = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const decodedChunk = decoder.decode(value, { stream: true })
    if (apiFormat === 'gemini') rawGeminiStream += decodedChunk
    buffer += decodedChunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue

      try {
        const json = JSON.parse(data)
        const delta = parseModelStreamEvent(json, streamState, apiFormat)

        if (delta?.content) {
          content += delta.content
          emitter.pushContent(delta.content)
        }
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content
          emitter.pushReasoning(delta.reasoning_content)
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? toolCalls.length
            while (toolCalls.length <= idx) {
              toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } })
            }
            if (tc.id) toolCalls[idx].id = tc.id
            if (tc.function?.name) toolCalls[idx].function.name = tc.function.name
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
          }
        }
      } catch { /* 流式数据解析失败 */ }
    }
  }

  if (apiFormat === 'gemini' && rawGeminiStream.trim()) {
    for (const json of parseGeminiStreamPayload(rawGeminiStream)) {
      const delta = parseModelStreamEvent(json, streamState, apiFormat)
      if (delta?.content) {
        content += delta.content
        emitter.pushContent(delta.content)
      }
      if (delta?.reasoning_content) {
        reasoning += delta.reasoning_content
        emitter.pushReasoning(delta.reasoning_content)
      }
    }
  }

  emitter.flushAll()

  return {
    content,
    reasoning,
    toolCalls: toolCalls.filter(tc => tc.id && tc.function?.name)
  }
}

function isUnsupportedPromptCacheHintError(text = '') {
  return /prompt_cache_key|x-grok-conv-id|cache key|cache_key|unsupported parameter|unknown parameter|extra inputs|invalid_request/i.test(String(text || ''))
}

function isUnsupportedResponsesEndpointError(text = '') {
  return /\/responses|responses api|response endpoint|unsupported endpoint|not found|404|unknown url|unknown path|invalid endpoint/i.test(String(text || ''))
}

async function callWorkSessionModel({ modelConfig, messages, signal, notify, projectId = '', sessionId = '' }) {
  const modelId = getModelId(modelConfig)
  if (!modelConfig?.apiUrl || !modelId) throw new Error('协作 AI 模型配置不完整')

  const endpoint = buildApiEndpoint(modelConfig)
  const apiFormat = getApiFormat(modelConfig, endpoint)
  const timeoutController = composeAbortSignal([signal])
  const totalTimer = setTimeout(() => {
    timeoutController.abort(new Error(`协作 AI 模型请求超过 ${Math.round(MODEL_TOTAL_TIMEOUT_MS / 1000)} 秒未完成`))
  }, MODEL_TOTAL_TIMEOUT_MS)
  const firstResponseTimer = setTimeout(() => {
    timeoutController.abort(new Error(`协作 AI 模型 ${Math.round(MODEL_FIRST_RESPONSE_TIMEOUT_MS / 1000)} 秒内没有返回首包`))
  }, MODEL_FIRST_RESPONSE_TIMEOUT_MS)

  logSession('model:request', {
    model: getModelLabel(modelConfig),
    endpoint,
    messageCount: messages.length
  })

  try {
    const buildRequest = (includePromptCache = true, requestEndpoint = endpoint, extraOptions = {}) => ({
      method: 'POST',
      headers: buildApiHeaders(modelConfig, requestEndpoint, { stream: true, modelId, promptCache: includePromptCache, projectId, sessionId }),
      body: stableJsonStringify(buildModelRequestBody(modelConfig, modelId, messages, {
        stream: true,
        includeTools: true,
        endpoint: requestEndpoint,
        disabledTools: COLLAB_DISABLED_TOOLS,
        promptCache: includePromptCache,
        projectId,
        sessionId,
        ...extraOptions
      })),
      signal: timeoutController.signal
    })

    const requestModel = async (requestEndpoint, requestInit) => {
      const avoidPersistentConnection = shouldAvoidPersistentModelConnection(modelConfig, requestEndpoint, modelId)
      try {
        return await retryPreResponseSocketClose(({ connectionClose }) => {
          const headers = { ...(requestInit.headers || {}) }
          if (avoidPersistentConnection || connectionClose) headers.connection = 'close'
          return fetch(requestEndpoint, buildApiFetchOptions(modelConfig, requestEndpoint, {
            ...requestInit,
            headers,
            connectionScope: `${projectId}|${sessionId}`,
            modelId,
            promptCache: true
          }))
        }, {
          delayMs: 150,
          maxAttempts: avoidPersistentConnection ? 3 : 2,
          connectionClose: avoidPersistentConnection
        })
      } catch (error) {
        if (timeoutController.signal.aborted) throw error
        throw new Error(formatModelTransportError(error, requestEndpoint, modelConfig), { cause: error })
      }
    }

    let response = await requestModel(endpoint, buildRequest(true))

    clearTimeout(firstResponseTimer)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      if (apiFormat === 'openai-responses' && isUnsupportedResponsesEndpointError(body) && /\/responses\/?$/i.test(endpoint)) {
        const fallbackEndpoint = endpoint.replace(/\/responses\/?$/i, '/chat/completions')
        response = await requestModel(fallbackEndpoint, buildRequest(true, fallbackEndpoint, {
          forceChatCompletions: true,
          disableReasoningOptions: true
        }))
        if (response.ok) {
          const result = await readStreamResponse({
            response,
            apiFormat: 'openai',
            onDelta: delta => notify?.(delta.type, {
              content: delta.content,
              append: true
            })
          })
          logSession('model:response', {
            model: getModelLabel(modelConfig),
            contentLength: result.content.length,
            reasoningLength: result.reasoning.length,
            toolCount: result.toolCalls.length
          })
          return result
        }
        const retryBody = await response.text().catch(() => '')
        throw new Error(`Collaboration AI API error ${response.status}: ${String(retryBody || '').slice(0, 500)}`)
      }
      if (isUnsupportedPromptCacheHintError(body)) {
        response = await requestModel(endpoint, buildRequest(false))
        if (response.ok) {
          const result = await readStreamResponse({
            response,
            apiFormat,
            onDelta: delta => notify?.(delta.type, {
              content: delta.content,
              append: true
            })
          })
          logSession('model:response', {
            model: getModelLabel(modelConfig),
            contentLength: result.content.length,
            reasoningLength: result.reasoning.length,
            toolCount: result.toolCalls.length
          })
          return result
        }
        const retryBody = await response.text().catch(() => '')
        throw new Error(`Collaboration AI API error ${response.status}: ${String(retryBody || '').slice(0, 500)}`)
      }
      throw new Error(`协作 AI API 错误 ${response.status}: ${String(body || '').slice(0, 500)}`)
    }

    const result = await readStreamResponse({
      response,
      apiFormat,
      onDelta: delta => notify?.(delta.type, {
        content: delta.content,
        append: true
      })
    })

    logSession('model:response', {
      model: getModelLabel(modelConfig),
      contentLength: result.content.length,
      reasoningLength: result.reasoning.length,
      toolCount: result.toolCalls.length
    })

    return result
  } catch (error) {
    notify?.('thinking', {
      title: '模型调用失败',
      content: error?.message || String(error || '协作 AI 模型调用失败'),
      status: 'error'
    })
    throw error
  } finally {
    clearTimeout(firstResponseTimer)
    clearTimeout(totalTimer)
  }
}

function makeEmitter(emit, projectId, sessionId, agentId) {
  return (type, payload = {}) => {
    emit?.({
      type,
      projectId,
      collaborationSessionId: sessionId,
      sessionId,
      agentId,
      agentRole: payload.agentRole || '',
      agentTitle: payload.agentTitle || '',
      ...payload,
      createdAt: Date.now()
    })
  }
}

async function runAgentSession(options = {}) {
  const {
    projectId,
    sessionId,
    agent,
    mode = 'serial',
    mainPlan = [],
    projectPath = '',
    contextManager = null,
    modelConfig,
    modelSource = 'agent',
    coordinationNote = '',
    signal,
    emit
  } = options
  const reportFilePath = options.reportFilePath || ''

  const agentId = String(agent?.id || agent?.name || `agent-${Date.now()}`)
  const agentTitle = agent?.name || agent?.role || agentId
  const notify = makeEmitter(emit, projectId, sessionId, agentId)
  const startedAt = Date.now()
  const messages = [
    { role: 'system', content: buildWorkSessionSystemPrompt({ agent, projectPath, mode, reportDir: options.reportDir, reportFilePath }) },
    { role: 'user', content: buildWorkSessionUserPrompt({ agent, mainPlan, coordinationNote, reportDir: options.reportDir, reportFilePath }) }
  ]
  const toolCalls = []
  const resolvePath = inputPath => resolveProjectPath(projectPath, inputPath)
  const { executeToolForProject } = require('./tools')
  const toolFailureRecovery = createToolFailureRecoveryTracker()

  logSession('start', {
    sessionId,
    projectId,
    agentId,
    name: agentTitle,
    model: getModelLabel(modelConfig)
  })

  notify('agent_status', {
    status: 'running',
    title: '协作 AI 开始执行',
    agentTitle,
    agentRole: agent?.role || agentTitle,
    content: modelSource === 'fallback'
      ? '该协作 AI 未单独配置模型，已跟随主窗口当前模型执行。'
      : `正在使用 ${getModelLabel(modelConfig)} 执行。`
  })

  let finalContent = ''
  let loop = 0
  while (true) {
    loop += 1
    if (signal?.aborted) throw signal.reason || new Error('协作 AI 已中断')

    const reply = options.callModel
      ? await options.callModel({ modelConfig, messages, signal, loop, agent, projectId, sessionId })
      : await callWorkSessionModel({ modelConfig, messages, signal, notify, projectId, sessionId })

    if (reply.reasoning) {
      notify('reasoning_final', {
        title: '模型推理',
        content: reply.reasoning,
        agentTitle,
        agentRole: agent?.role || agentTitle,
        append: true
      })
    }
    if (reply.content) {
      finalContent = reply.content
      notify('content', {
        title: '协作 AI 正文',
        content: finalContent,
        agentTitle,
        agentRole: agent?.role || agentTitle
      })
    }

    if (toolFailureRecovery.isStopRequested() && reply.toolCalls.length) {
      notify('thinking', {
        title: '协作 AI 工具循环已停止',
        content: '连续工具失败后仍请求调用工具，本次协作已停止继续执行工具。',
        agentTitle,
        agentRole: agent?.role || agentTitle,
        append: true
      })
      break
    }

    if (!reply.toolCalls.length) {
      if (reportFilePath && !readAgentWrittenReport(reportFilePath).content) {
        messages.push({
          role: 'assistant',
          content: reply.content || ''
        })
        messages.push({
          role: 'user',
          content: [
            `你还没有写入最终汇报文件：${reportFilePath}`,
            '现在不要继续闲聊，也不要只输出正文。',
            '请立即调用 write_file，把完整 Markdown 汇报写入该路径。',
            '汇报必须包含：已做什么、关键发现、涉及文件/行号或命令证据、修改内容、验证结果、风险和建议。'
          ].join('\n')
        })
        notify('thinking', {
          title: '等待写入汇报文件',
          content: '协作 AI 已输出正文但还没有写入临时汇报文件，系统要求它继续写入 Markdown 汇报。',
          agentTitle,
          agentRole: agent?.role || agentTitle,
          append: true
        })
        continue
      }
      notify('thinking', {
        title: '协作 AI 输出报告',
        content: finalContent || '无正文报告',
        agentTitle,
        agentRole: agent?.role || agentTitle,
        append: true
      })
      break
    }

    messages.push({
      role: 'assistant',
      content: reply.content || null,
      tool_calls: reply.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments || '{}'
        }
      }))
    })

    for (const tc of reply.toolCalls) {
      if (signal?.aborted) throw signal.reason || new Error('协作 AI 已中断')

      const toolName = tc.function.name
      const toolArgs = safeJsonParse(tc.function.arguments, {})

      logSession('tool:start', { sessionId, agentId, toolName, toolCallId: tc.id })
      notify('tool_start', {
        title: toolName,
        name: toolName,
        args: toolArgs,
        content: safeJsonStringify(toolArgs, 1600),
        toolCallId: tc.id,
        agentTitle,
        agentRole: agent?.role || agentTitle
      })

      const result = toolFailureRecovery.shouldBlock(toolName)
        ? toolFailureRecovery.getBlockResult(toolName)
        : await executeToolForProject(
        toolName,
        toolArgs,
        projectPath,
        resolvePath,
        contextManager,
        projectId,
        modelConfig,
        {
          signal,
          userMessage: agent?.task || '',
          collaborationSessionId: sessionId,
          collaborationAgentId: agentId,
          collaborationAgentName: agentTitle,
          collaborationReportFilePath: reportFilePath
        }
        )
      const summary = summarizeToolResultForWorkSession(toolName, result)
      const recovery = toolFailureRecovery.record(toolName, result)
      if (recovery.guidance) summary.recovery_guidance = recovery.guidance
      if (recovery.writeRestricted) summary.recovery_mode = 'write_restricted_until_successful_read'

      logSession('tool:result', {
        sessionId,
        agentId,
        toolName,
        success: summary?.success !== false,
        error: summary?.error || ''
      })

      toolCalls.push({ id: tc.id, name: toolName, args: toolArgs, result: summary })
      notify('tool_result', {
        title: toolName,
        name: toolName,
        args: toolArgs,
        result: summary,
        content: safeJsonStringify(summary, 3000),
        toolCallId: tc.id,
        agentTitle,
        agentRole: agent?.role || agentTitle
      })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: safeJsonStringify(summary, 12000) })
      if (recovery.stopRequested) {
        messages.push({ role: 'user', content: toolFailureRecovery.getStopInstruction() })
        break
      }
    }
  }

  const writtenReport = readAgentWrittenReport(reportFilePath)
  const reportContent = writtenReport.content || buildMissingWrittenReportMessage({ agent, toolCalls, finalContent, reportFilePath })
  const report = {
    agentId,
    name: agent?.name || agent?.role || agentId,
    role: agent?.role || '',
    task: agent?.task || '',
    content: reportContent,
    reportFilePath: writtenReport.content ? reportFilePath : '',
    missingWrittenReport: !writtenReport.content,
    toolCalls,
    startedAt,
    completedAt: Date.now(),
    durationMs: Date.now() - startedAt
  }

  logSession('done', {
    sessionId,
    projectId,
    agentId,
    toolCount: toolCalls.length,
    durationMs: report.durationMs,
    contentLength: report.content.length
  })

  notify('agent_status', {
    status: 'done',
    title: '协作 AI 完成',
    content: report.content,
    report,
    agentTitle,
    agentRole: agent?.role || agentTitle
  })

  return report
}

module.exports = {
  runAgentSession,
  runSubAgent: runAgentSession
}
