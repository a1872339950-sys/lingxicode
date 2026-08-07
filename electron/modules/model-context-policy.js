const DEFAULT_MODEL_CONTEXT_TOKENS = 128000

// 按“更具体的名字优先”匹配，避免 gpt-5 抢先命中 gpt-5.6-terra。
const MODEL_CONTEXT_RULES = [
  [/claude[\s_-]*sonnet[\s_-]*5|sonnet[\s_-]*5|fable[\s_-]*5/i, 1000000],
  [/claude[\s_-]*opus[\s_-]*4[.\s_-]*(?:8|7|6)|opus[\s_-]*4[.\s_-]*(?:8|7|6)|sonnet[\s_-]*4[.\s_-]*6/i, 1000000],
  [/gpt[\s_-]*5[.\s_-]*6[\s_-]*(?:sol|terra|luna)/i, 500000],
  [/gpt[\s_-]*5[.\s_-]*(?:5|4)(?!\d)/i, 1000000],
  [/deepseek[\s_-]*v4[\s_-]*(?:pro|flash)?/i, 1000000],
  [/glm[\s_-]*5[.\s_-]*2/i, 1000000],
  [/glm[\s_-]*5[.\s_-]*1|glm[\s_-]*5(?![.\s_-]*2)/i, 200000],
  [/kimi[\s_-]*k3/i, 1000000],
  [/kimi[\s_-]*k2[.\s_-]*7[\s_-]*code/i, 256000],
  [/kimi[\s_-]*k2[.\s_-]*(?:7|6|5)/i, 262144],
  [/minimax[\s_-]*m3/i, 1000000],
  [/minimax[\s_-]*m2[.\s_-]*(?:7|5)/i, 204800],
  [/qwen[\s_-]*3[.\s_-]*7[\s_-]*(?:max|plus)/i, 1000000],
  [/qwen[\s_-]*3[.\s_-]*6[\s_-]*plus/i, 1000000],
  [/qwen[\s_-]*3[.\s_-]*6[\s_-]*max[\s_-]*preview/i, 262144],
  [/qwen[\s_-]*3[.\s_-]*5[\s_-]*(?:plus|flash)/i, 1000000],
  [/mimo[\s_-]*v?2[.\s_-]*5(?:[\s_-]*pro)?/i, 1048576],
  [/doubao[\s_-]*seed[\s_-]*2[\s_-]*(?:1[\s_-]*turbo|0[\s_-]*(?:pro|code|mini))/i, 256000],
  [/grok[\s_-]*4[.\s_-]*1[\s_-]*fast|grok[\s_-]*4[\s_-]*fast/i, 2000000],
  [/grok[\s_-]*4[.\s_-]*3/i, 1000000],
  [/grok[\s_-]*4[.\s_-]*5/i, 500000],
  [/grok[\s_-]*build[\s_-]*0[.\s_-]*1/i, 256000],
  [/gemini[\s_-]*1[.\s_-]*5[\s_-]*pro/i, 2000000],
  [/gemini[\s_-]*(?:1[.\s_-]*5[\s_-]*flash|2[.\s_-]*0[\s_-]*flash(?:[\s_-]*lite)?|2[.\s_-]*5[\s_-]*(?:flash|pro)|3(?:[.\s_-]*1)?[\s_-]*pro)/i, 1000000],
  [/(?:hy3|hunyuan[\s_-]*3)(?:[\s_-]*preview)?|hy[\s_-]*2[.\s_-]*0/i, 256000]
]

function normalizeConfiguredLimit(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 16000 ? Math.floor(parsed) : 0
}

function resolveModelContextLimit(modelName, configuredLimit = 0) {
  const explicit = normalizeConfiguredLimit(configuredLimit)
  if (explicit) return explicit
  const name = String(modelName || '')
  for (const [pattern, limit] of MODEL_CONTEXT_RULES) {
    if (pattern.test(name)) return limit
  }
  return DEFAULT_MODEL_CONTEXT_TOKENS
}

function buildContextBudget(modelName, configuredLimit = 0, options = {}) {
  const maxContextTokens = resolveModelContextLimit(modelName, configuredLimit)
  const outputReserveTokens = Math.max(8000, Number(options.outputReserveTokens) || Math.min(64000, Math.floor(maxContextTokens * 0.12)))
  const safetyTokens = Math.max(8000, Number(options.safetyTokens) || Math.floor(maxContextTokens * 0.1))
  const softInputRatio = Math.min(0.72, Math.max(0.5, Number(options.softInputRatio) || 0.65))
  const hardInputRatio = Math.min(0.86, Math.max(softInputRatio + 0.05, Number(options.hardInputRatio) || 0.78))
  return {
    maxContextTokens,
    softInputRatio,
    hardInputRatio,
    inputBudgetTokens: Math.max(16000, Math.min(
      Math.floor(maxContextTokens * softInputRatio),
      maxContextTokens - outputReserveTokens - safetyTokens
    )),
    hardInputTokens: Math.max(20000, Math.min(
      Math.floor(maxContextTokens * hardInputRatio),
      maxContextTokens - outputReserveTokens
    )),
    outputReserveTokens,
    safetyTokens
  }
}

module.exports = {
  DEFAULT_MODEL_CONTEXT_TOKENS,
  MODEL_CONTEXT_RULES,
  resolveModelContextLimit,
  buildContextBudget
}
