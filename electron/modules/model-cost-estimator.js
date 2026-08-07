function getProviderText(config = {}, currentModelId = '') {
  return [
    config.apiUrl,
    config.provider,
    config.apiType,
    config.modelName,
    config.modelId,
    currentModelId
  ].filter(Boolean).join(' ').toLowerCase()
}

function formatCnyCost(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return '¥0'
  if (amount < 0.0001) return '<¥0.0001'
  if (amount < 0.01) return `¥${amount.toFixed(4)}`
  if (amount < 1) return `¥${amount.toFixed(3)}`
  return `¥${amount.toFixed(2)}`
}

function getDeepSeekCostProfile(config = {}, currentModelId = '') {
  const providerText = getProviderText(config, currentModelId)
  if (!/deepseek|api\.deepseek\.com/.test(providerText)) return null
  const isPro = /deepseek-v4-pro|v4-pro/.test(providerText)
  return isPro
    ? { provider: 'deepseek', tier: 'pro', currency: 'CNY', cachedInputPerMillion: 0.025, missInputPerMillion: 3, outputPerMillion: 6 }
    : { provider: 'deepseek', tier: 'flash', currency: 'CNY', cachedInputPerMillion: 0.02, missInputPerMillion: 1, outputPerMillion: 2 }
}

function getMimoCostProfile(config = {}, currentModelId = '') {
  const providerText = getProviderText(config, currentModelId)
  if (!/mimo|xiaomi|xiaomimimo|token-plan-cn\.xiaomimimo\.com|mimo\.mi\.com/.test(providerText)) return null
  const isPro = /mimo-v?2(?:\.5)?-pro|v?2(?:\.5)?-pro/.test(providerText)
  return isPro
    ? { provider: 'mimo', tier: 'v2.5-pro', currency: 'CNY', cachedInputPerMillion: 0.025, missInputPerMillion: 3, outputPerMillion: 6 }
    : { provider: 'mimo', tier: 'v2.5', currency: 'CNY', cachedInputPerMillion: 0.02, missInputPerMillion: 1, outputPerMillion: 2 }
}

function getGlmCostProfile(config = {}, currentModelId = '', usage = {}) {
  const providerText = getProviderText(config, currentModelId)
  if (!/open\.bigmodel\.cn|bigmodel|zhipu|glm-|智谱/.test(providerText)) return null

  const modelText = [
    config.provider,
    config.modelName,
    config.modelId,
    currentModelId
  ].filter(Boolean).join(' ').toLowerCase()
  const inputTokens = Math.max(0, Number(usage.inputTokens || 0))
  const longContext = inputTokens >= 32000
  const makeTiered = (shortProfile, longProfile) => longContext ? longProfile : shortProfile

  if (/glm-5\.2/.test(modelText)) {
    return { provider: 'glm', tier: '5.2', currency: 'CNY', cachedInputPerMillion: 2, missInputPerMillion: 8, outputPerMillion: 28 }
  }
  if (/glm-5\.1/.test(modelText)) {
    return makeTiered(
      { provider: 'glm', tier: '5.1-short', currency: 'CNY', cachedInputPerMillion: 1.3, missInputPerMillion: 6, outputPerMillion: 24 },
      { provider: 'glm', tier: '5.1-long', currency: 'CNY', cachedInputPerMillion: 2, missInputPerMillion: 8, outputPerMillion: 28 }
    )
  }
  if (/glm-5-turbo/.test(modelText)) {
    return makeTiered(
      { provider: 'glm', tier: '5-turbo-short', currency: 'CNY', cachedInputPerMillion: 1.2, missInputPerMillion: 5, outputPerMillion: 22 },
      { provider: 'glm', tier: '5-turbo-long', currency: 'CNY', cachedInputPerMillion: 1.8, missInputPerMillion: 7, outputPerMillion: 26 }
    )
  }
  if (/glm-5(?![\d.])/.test(modelText)) {
    return makeTiered(
      { provider: 'glm', tier: '5-short', currency: 'CNY', cachedInputPerMillion: 1, missInputPerMillion: 4, outputPerMillion: 18 },
      { provider: 'glm', tier: '5-long', currency: 'CNY', cachedInputPerMillion: 1.5, missInputPerMillion: 6, outputPerMillion: 22 }
    )
  }
  return null
}

function getApiKeyFunCostProfile(config = {}, currentModelId = '') {
  const providerText = getProviderText(config, currentModelId)
  if (!/api\.apikey\.fun|apikey\.fun/.test(providerText)) return null

  const modelText = [
    config.provider,
    config.modelName,
    config.modelId,
    currentModelId
  ].filter(Boolean).join(' ').toLowerCase()

  if (/grok-build-0\.1/.test(modelText)) {
    // 暂无独立截图；保持原中转标定值（缓存/输入/输出）
    return { provider: 'apikey.fun', tier: 'grok-build-0.1', currency: 'CNY', cachedInputPerMillion: 0.2, missInputPerMillion: 0.4, outputPerMillion: 0.04 }
  }
  if (/grok-4\.5/.test(modelText)) {
    // 中转站截图顺序：输入 0.40 / 输出 1.20 / 缓存 0.10（CNY per 1M tokens）
    return { provider: 'apikey.fun', tier: 'grok-4.5', currency: 'CNY', missInputPerMillion: 0.4, outputPerMillion: 1.2, cachedInputPerMillion: 0.1 }
  }
  if (/gpt-5\.4-mini/.test(modelText)) {
    return { provider: 'apikey.fun', tier: 'gpt-5.4-mini', currency: 'CNY', cachedInputPerMillion: 0.05, missInputPerMillion: 0.53, outputPerMillion: 3.15 }
  }
  if (/gpt-5\.6-sol/.test(modelText)) {
    return { provider: 'apikey.fun', tier: 'gpt-5.6-sol', currency: 'CNY', cachedInputPerMillion: 0.25, missInputPerMillion: 2.5, outputPerMillion: 15 }
  }
  if (/gpt-5\.6-terra/.test(modelText)) {
    return { provider: 'apikey.fun', tier: 'gpt-5.6-terra', currency: 'CNY', cachedInputPerMillion: 0.13, missInputPerMillion: 1.25, outputPerMillion: 7.5 }
  }
  if (/gpt-5\.6-luna/.test(modelText)) {
    return { provider: 'apikey.fun', tier: 'gpt-5.6-luna', currency: 'CNY', cachedInputPerMillion: 0.05, missInputPerMillion: 0.5, outputPerMillion: 3 }
  }
  if (/gpt-5\.5/.test(modelText)) {
    return { provider: 'apikey.fun', tier: 'gpt-5.5', currency: 'CNY', cachedInputPerMillion: 0.35, missInputPerMillion: 3.5, outputPerMillion: 21 }
  }
  if (/gpt-5\.4/.test(modelText)) {
    return { provider: 'apikey.fun', tier: 'gpt-5.4', currency: 'CNY', cachedInputPerMillion: 0.18, missInputPerMillion: 1.75, outputPerMillion: 10.5 }
  }
  if (/claude-opus-(?:4-[678]|5(?:[^\d]|$))/.test(modelText)) {
    return { provider: 'apikey.fun', tier: modelText.match(/claude-opus-(?:4-[678]|5(?:[^\s]*))/)?.[0] || 'claude-opus', currency: 'CNY', cachedInputPerMillion: 0.35, missInputPerMillion: 3.5, outputPerMillion: 17.5, cacheWritePerMillion: 4.38 }
  }
  if (/claude-sonnet-(?:4-6|5(?:[^\d]|$))/.test(modelText)) {
    return { provider: 'apikey.fun', tier: modelText.match(/claude-sonnet-(?:4-6|5(?:[^\s]*))/)?.[0] || 'claude-sonnet', currency: 'CNY', cachedInputPerMillion: 0.21, missInputPerMillion: 2.1, outputPerMillion: 10.5, cacheWritePerMillion: 2.63 }
  }
  if (/claude-haiku-4-5/.test(modelText)) {
    return { provider: 'apikey.fun', tier: 'claude-haiku-4-5', currency: 'CNY', cachedInputPerMillion: 0.07, missInputPerMillion: 0.7, outputPerMillion: 3.5, cacheWritePerMillion: 0.88 }
  }
  return null
}

function getModelCostProfile(config = {}, currentModelId = '', usage = {}) {
  return getDeepSeekCostProfile(config, currentModelId) ||
    getMimoCostProfile(config, currentModelId) ||
    getGlmCostProfile(config, currentModelId, usage) ||
    getApiKeyFunCostProfile(config, currentModelId)
}

function estimateModelCost(usage = {}, config = {}, currentModelId = '') {
  const profile = getModelCostProfile(config, currentModelId, usage)
  if (!profile) return null
  const cachedTokens = Math.max(0, Number(usage.cachedTokens || 0))
  const cacheWriteTokens = Math.max(0, Number(usage.cacheWriteTokens || 0))
  const inputTokens = Math.max(0, Number(usage.inputTokens || 0))
  const explicitMissTokens = Math.max(0, Number(usage.cacheMissTokens || 0))
  const missTokens = explicitMissTokens || Math.max(0, inputTokens - cachedTokens - cacheWriteTokens)
  const outputTokens = Math.max(0, Number(usage.outputTokens || 0))
  const cachedInputCost = cachedTokens / 1000000 * profile.cachedInputPerMillion
  const cacheWriteCost = cacheWriteTokens / 1000000 * (profile.cacheWritePerMillion ?? profile.missInputPerMillion)
  const missInputCost = missTokens / 1000000 * profile.missInputPerMillion
  const outputCost = outputTokens / 1000000 * profile.outputPerMillion
  const amount = cachedInputCost + cacheWriteCost + missInputCost + outputCost
  return {
    provider: profile.provider,
    tier: profile.tier,
    currency: profile.currency,
    amount,
    amountText: formatCnyCost(amount),
    cachedInputCost,
    cacheWriteCost,
    missInputCost,
    outputCost,
    cachedTokens,
    cacheWriteTokens,
    missTokens,
    outputTokens
  }
}

module.exports = {
  formatCnyCost,
  getDeepSeekCostProfile,
  getMimoCostProfile,
  getGlmCostProfile,
  getApiKeyFunCostProfile,
  getModelCostProfile,
  estimateModelCost
}
