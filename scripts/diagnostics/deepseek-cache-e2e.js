const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildApiEndpoint,
  buildApiHeaders,
  buildApiFetchOptions,
  buildModelRequestBody,
  closeStickyModelAgents
} = require('../../electron/modules/model-api-adapter')
const { normalizePromptCacheUsage } = require('../../electron/modules/prompt-cache-capabilities')
const { buildDeepSeekMultiToolCacheBridge } = require('../../electron/modules/ai-chat').__test

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.lingxicode', 'api-config.json')

function findDeepSeekConfig(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  if (!Array.isArray(value)) {
    const url = String(value.apiUrl || value.baseUrl || '')
    const model = String(value.modelId || value.model || value.modelName || '')
    if (/api\.deepseek\.com/i.test(url) && /^deepseek-v4-pro$/i.test(model) && value.apiKey) return value
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    const found = findDeepSeekConfig(item, seen)
    if (found) return found
  }
  return null
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function usageFromResponse(json = {}) {
  return normalizePromptCacheUsage(json.usage || {}) || {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: 0
  }
}

async function main() {
  const configPath = process.env.LINGXI_API_CONFIG || DEFAULT_CONFIG_PATH
  const rounds = Math.max(2, Math.min(12, Number(process.env.CACHE_E2E_ROUNDS) || 8))
  const settleMs = Math.max(0, Math.min(15000, Number(process.env.CACHE_E2E_SETTLE_MS) || 5000))
  const toolMode = String(process.env.CACHE_E2E_TOOL_MODE || 'single').toLowerCase() === 'multi' ? 'multi' : 'single'
  const allowParallelTools = process.env.CACHE_E2E_ALLOW_PARALLEL === 'true'
  const configRoot = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const modelConfig = findDeepSeekConfig(configRoot)
  if (!modelConfig) throw new Error('DeepSeek v4-pro official API configuration was not found')

  const modelId = modelConfig.modelId || modelConfig.model || modelConfig.modelName
  const endpoint = buildApiEndpoint(modelConfig)
  const origin = new URL(endpoint).origin
  const stableFixture = Array.from({ length: 320 }, (_, index) =>
    `stable-cache-fixture-${String(index).padStart(4, '0')}: The exact prefix must remain byte-stable across every diagnostic request.`
  ).join('\n')
  const messages = [
    {
      role: 'system',
      content: [
        'You are running a transport-level prompt cache diagnostic.',
        toolMode === 'multi'
          ? `This diagnostic has exactly ${rounds} tool rounds. In every response, emit exactly two tool calls in the same assistant message: one shell_run with command \"Write-Output cache-probe\", and one read_file with path \"package.json\". Never answer normally.`
          : `This diagnostic has exactly ${rounds} tool rounds. Until the tool result says round ${rounds}, call show_thinking_note exactly once in every response and never answer normally.`,
        toolMode === 'multi'
          ? 'The shell_run and read_file calls are independent. Always emit both together before waiting for their results.'
          : `After receiving the round ${rounds} tool result, call show_thinking_note one final time.`,
        'Keep reasoning and tool arguments short and deterministic.',
        stableFixture
      ].join('\n\n')
    },
    {
      role: 'user',
      content: 'Begin the cache diagnostic. Call show_thinking_note once.'
    }
  ]

  const results = []
  try {
    for (let round = 1; round <= rounds; round += 1) {
      const body = buildModelRequestBody(modelConfig, modelId, messages, {
        stream: false,
        includeTools: true,
        endpoint,
        userMessage: messages[1].content,
        projectId: 'deepseek-cache-e2e',
        branchId: 'sticky-connection',
        sessionId: 'sticky-connection'
      })
      if (toolMode === 'multi') body.parallel_tool_calls = allowParallelTools
      const startedAt = Date.now()
      const response = await fetch(endpoint, buildApiFetchOptions(modelConfig, endpoint, {
        method: 'POST',
        headers: buildApiHeaders(modelConfig, endpoint, { stream: false, modelId }),
        body: JSON.stringify(body),
        connectionScope: 'deepseek-cache-e2e|sticky-connection',
        modelId,
        promptCache: true
      }))
      const text = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
      const json = JSON.parse(text)
      const message = json.choices?.[0]?.message
      if (!message) throw new Error(`Round ${round} returned no assistant message`)
      const usage = usageFromResponse(json)
      const inputTokens = Number(usage.inputTokens || 0)
      const cachedTokens = Number(usage.cachedTokens || 0)
      const cacheMissTokens = Number(usage.cacheMissTokens || Math.max(0, inputTokens - cachedTokens))
      const cacheRate = inputTokens > 0 ? Number(((cachedTokens / inputTokens) * 100).toFixed(2)) : 0
      results.push({
        round,
        inputTokens,
        cachedTokens,
        cacheMissTokens,
        cacheRate,
        elapsedMs: Date.now() - startedAt,
        requestId: response.headers.get('x-request-id') || response.headers.get('x-ds-request-id') || '',
        connection: response.headers.get('connection') || '',
        server: response.headers.get('server') || ''
      })

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      if (!toolCalls.length) {
        results[results.length - 1].toolCallCount = 0
        results[results.length - 1].endedNaturally = true
        break
      }
      if (toolMode === 'multi' && allowParallelTools && toolCalls.length < 2) {
        throw new Error(`Round ${round} returned ${toolCalls.length} tool call instead of two`)
      }
      if (toolMode === 'multi' && !allowParallelTools && toolCalls.length > 1) {
        results[results.length - 1].toolCallCount = toolCalls.length
        results[results.length - 1].consolidatedMultiToolResult = true
        messages.push(...buildDeepSeekMultiToolCacheBridge(toolCalls.map((toolCall, index) => ({
          tool_call_id: toolCall.id,
          name: toolCall.function?.name,
          arguments: toolCall.function?.arguments,
          result: { success: true, round, output: `cache-probe-${index + 1}` }
        }))))
        if (round < rounds) await sleep(settleMs)
        continue
      }
      results[results.length - 1].toolCallCount = toolCalls.length
      messages.push(message)
      for (const toolCall of toolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            success: true,
            round,
            totalRounds: rounds,
            remainingRounds: Math.max(0, rounds - round),
            instruction: round < rounds
              ? 'Continue immediately with exactly one show_thinking_note call. Do not answer normally.'
              : 'This is the final diagnostic round.'
          })
        })
      }
      if (round < rounds) await sleep(settleMs)
    }
  } finally {
    await closeStickyModelAgents()
  }

  const totalInput = results.reduce((sum, item) => sum + item.inputTokens, 0)
  const totalCached = results.reduce((sum, item) => sum + item.cachedTokens, 0)
  console.log(JSON.stringify({
    endpoint: origin,
    modelId,
    toolMode,
    allowParallelTools,
    rounds,
    settleMs,
    totalInput,
    totalCached,
    totalRate: totalInput > 0 ? Number(((totalCached / totalInput) * 100).toFixed(2)) : 0,
    results
  }, null, 2))
}

main().catch(error => {
  console.error(error.stack || error.message || String(error))
  process.exit(1)
})
