const path = require('path')

module.exports = {
  id: 'model-cost-estimator.glm',
  title: 'Model cost estimator supports GLM 5.x prompt-cache pricing',
  tags: ['model-cost', 'prompt-cache', 'glm'],
  changedFilePatterns: [
    /^electron\/modules\/model-cost-estimator\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i
  ],

  async run(ctx) {
    const {
      getModelCostProfile,
      estimateModelCost
    } = require(path.join(ctx.root, 'electron/modules/model-cost-estimator'))

    const baseConfig = {
      apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      provider: 'zhipu'
    }

    const usage = {
      inputTokens: 1000000,
      cachedTokens: 700000,
      outputTokens: 100000
    }

    const glm52 = estimateModelCost(usage, baseConfig, 'glm-5.2')
    ctx.assert.equal(glm52.provider, 'glm', 'glm-5.2 should use GLM pricing')
    ctx.assert.equal(glm52.tier, '5.2', 'glm-5.2 should use its own pricing tier')
    ctx.assert.equal(Number(glm52.amount.toFixed(6)), 6.6, 'glm-5.2 cost should include cached input, missed input, and output')
    ctx.assert.equal(glm52.amountText, '¥6.60', 'glm-5.2 cost text should use CNY symbol')

    const glm51Short = getModelCostProfile(baseConfig, 'glm-5.1', { inputTokens: 31000 })
    ctx.assert.equal(glm51Short.tier, '5.1-short', 'glm-5.1 under 32K should use short-context tier')
    ctx.assert.equal(glm51Short.cachedInputPerMillion, 1.3, 'glm-5.1 short cache-hit price should match official pricing')
    ctx.assert.equal(glm51Short.missInputPerMillion, 6, 'glm-5.1 short input price should match official pricing')
    ctx.assert.equal(glm51Short.outputPerMillion, 24, 'glm-5.1 short output price should match official pricing')

    const glm51Long = getModelCostProfile(baseConfig, 'glm-5.1', { inputTokens: 32000 })
    ctx.assert.equal(glm51Long.tier, '5.1-long', 'glm-5.1 at 32K and above should use long-context tier')
    ctx.assert.equal(glm51Long.cachedInputPerMillion, 2, 'glm-5.1 long cache-hit price should match official pricing')
    ctx.assert.equal(glm51Long.missInputPerMillion, 8, 'glm-5.1 long input price should match official pricing')
    ctx.assert.equal(glm51Long.outputPerMillion, 28, 'glm-5.1 long output price should match official pricing')

    const glm5Short = getModelCostProfile(baseConfig, 'glm-5', { inputTokens: 12000 })
    ctx.assert.equal(glm5Short.tier, '5-short', 'glm-5 under 32K should use short-context tier')
    ctx.assert.equal(glm5Short.cachedInputPerMillion, 1, 'glm-5 short cache-hit price should match official pricing')
    ctx.assert.equal(glm5Short.missInputPerMillion, 4, 'glm-5 short input price should match official pricing')
    ctx.assert.equal(glm5Short.outputPerMillion, 18, 'glm-5 short output price should match official pricing')

    const glm5Long = getModelCostProfile(baseConfig, 'glm-5', { inputTokens: 80000 })
    ctx.assert.equal(glm5Long.tier, '5-long', 'glm-5 over 32K should use long-context tier')
    ctx.assert.equal(glm5Long.cachedInputPerMillion, 1.5, 'glm-5 long cache-hit price should match official pricing')
    ctx.assert.equal(glm5Long.missInputPerMillion, 6, 'glm-5 long input price should match official pricing')
    ctx.assert.equal(glm5Long.outputPerMillion, 22, 'glm-5 long output price should match official pricing')

    const deepseek = estimateModelCost({
      inputTokens: 1000000,
      cachedTokens: 800000,
      outputTokens: 50000
    }, { apiUrl: 'https://api.deepseek.com/v1/chat/completions' }, 'deepseek-v4-flash')
    ctx.assert.equal(deepseek.provider, 'deepseek', 'existing DeepSeek pricing should still work')
    ctx.assert.equal(Number(deepseek.amount.toFixed(6)), 0.316, 'DeepSeek flash cost should remain unchanged')

    const mimoConfig = { apiUrl: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions', provider: 'mimo' }
    const mimoUsage = {
      inputTokens: 1000000,
      cachedTokens: 700000,
      outputTokens: 100000
    }
    const mimo25 = estimateModelCost(mimoUsage, mimoConfig, 'mimo-v2.5')
    ctx.assert.equal(mimo25.provider, 'mimo', 'MiMo should use Xiaomi official pricing')
    ctx.assert.equal(mimo25.tier, 'v2.5', 'mimo-v2.5 should use the standard tier')
    ctx.assert.equal(Number(mimo25.amount.toFixed(6)), 0.514, 'mimo-v2.5 cost should include cached input, missed input, and output')

    const mimo25Pro = estimateModelCost(mimoUsage, mimoConfig, 'mimo-v2.5-pro')
    ctx.assert.equal(mimo25Pro.tier, 'v2.5-pro', 'mimo-v2.5-pro should use the pro tier')
    ctx.assert.equal(Number(mimo25Pro.amount.toFixed(6)), 1.5175, 'mimo-v2.5-pro cost should match the 2026-06 official table')

    const apikeyFunConfig = { apiUrl: 'https://api.apikey.fun/v1/chat/completions', provider: 'apikey.fun' }
    const apikeyFunUsage = {
      inputTokens: 1000000,
      cachedTokens: 700000,
      outputTokens: 100000
    }
    const gpt55 = estimateModelCost(apikeyFunUsage, apikeyFunConfig, 'gpt-5.5')
    ctx.assert.equal(gpt55.provider, 'apikey.fun', 'api.apikey.fun gpt-5.5 should use transfer-station pricing')
    ctx.assert.equal(gpt55.tier, 'gpt-5.5', 'gpt-5.5 should use its own pricing tier')
    ctx.assert.equal(Number(gpt55.cachedInputCost.toFixed(6)), 0.245, 'gpt-5.5 cache-hit input should be 0.35 CNY per 1M')
    ctx.assert.equal(Number(gpt55.amount.toFixed(6)), 3.395, 'gpt-5.5 cost should include hit input, missed input, and output')

    const gpt56Sol = estimateModelCost(apikeyFunUsage, apikeyFunConfig, 'gpt-5.6-sol')
    ctx.assert.equal(gpt56Sol.tier, 'gpt-5.6-sol', 'gpt-5.6-sol should use its own pricing tier')
    ctx.assert.equal(Number(gpt56Sol.amount.toFixed(6)), 2.425, 'gpt-5.6-sol cost should match the CNY price table')

    const gpt56Terra = estimateModelCost(apikeyFunUsage, apikeyFunConfig, 'gpt-5.6-terra')
    ctx.assert.equal(gpt56Terra.tier, 'gpt-5.6-terra', 'gpt-5.6-terra should use its own pricing tier')
    ctx.assert.equal(Number(gpt56Terra.amount.toFixed(6)), 1.216, 'gpt-5.6-terra cost should match the CNY price table')

    const gpt56Luna = estimateModelCost(apikeyFunUsage, apikeyFunConfig, 'gpt-5.6-luna')
    ctx.assert.equal(gpt56Luna.tier, 'gpt-5.6-luna', 'gpt-5.6-luna should use its own pricing tier')
    ctx.assert.equal(Number(gpt56Luna.amount.toFixed(6)), 0.485, 'gpt-5.6-luna cost should match the CNY price table')

    const gpt54 = estimateModelCost(apikeyFunUsage, apikeyFunConfig, 'gpt-5.4')
    ctx.assert.equal(gpt54.tier, 'gpt-5.4', 'gpt-5.4 should use its own pricing tier')
    ctx.assert.equal(Number(gpt54.amount.toFixed(6)), 1.701, 'gpt-5.4 transfer-station cost should match the provided price table')

    const gpt54Mini = estimateModelCost(apikeyFunUsage, apikeyFunConfig, 'gpt-5.4-mini')
    ctx.assert.equal(gpt54Mini.tier, 'gpt-5.4-mini', 'gpt-5.4-mini should not be swallowed by the gpt-5.4 matcher')
    ctx.assert.equal(Number(gpt54Mini.amount.toFixed(6)), 0.509, 'gpt-5.4-mini transfer-station cost should match the provided price table')

    const apikeyFunClaudeUsage = {
      inputTokens: 1000000,
      cachedTokens: 400000,
      cacheWriteTokens: 200000,
      outputTokens: 100000
    }
    const opus48 = estimateModelCost(apikeyFunClaudeUsage, apikeyFunConfig, 'claude-opus-4-8')
    ctx.assert.equal(opus48.provider, 'apikey.fun', 'api.apikey.fun claude-opus-4-8 should use transfer-station pricing')
    ctx.assert.equal(opus48.tier, 'claude-opus-4-8', 'claude-opus-4-8 should use its own pricing tier')
    ctx.assert.equal(Number(opus48.cacheWriteCost.toFixed(6)), 0.876, 'claude opus cache-write price should be 4.38 CNY per 1M')
    ctx.assert.equal(Number(opus48.amount.toFixed(6)), 4.166, 'claude-opus-4-8 cost should include hit input, write input, missed input, and output')

    const opus47 = getModelCostProfile(apikeyFunConfig, 'claude-opus-4-7')
    ctx.assert.equal(opus47.cacheWritePerMillion, 4.38, 'claude-opus-4-7 cache-write price should match the provided table')
    const opus46 = getModelCostProfile(apikeyFunConfig, 'claude-opus-4-6')
    ctx.assert.equal(opus46.cachedInputPerMillion, 0.35, 'claude-opus-4-6 cache-hit input price should match the provided table')

    const sonnet46 = estimateModelCost(apikeyFunClaudeUsage, apikeyFunConfig, 'claude-sonnet-4-6')
    ctx.assert.equal(sonnet46.tier, 'claude-sonnet-4-6', 'claude-sonnet-4-6 should use its own pricing tier')
    ctx.assert.equal(Number(sonnet46.amount.toFixed(6)), 2.5, 'claude-sonnet-4-6 transfer-station cost should match the provided price table')

    const haiku45 = estimateModelCost(apikeyFunClaudeUsage, apikeyFunConfig, 'claude-haiku-4-5')
    ctx.assert.equal(haiku45.tier, 'claude-haiku-4-5', 'claude-haiku-4-5 should use its own pricing tier')
    ctx.assert.equal(Number(haiku45.amount.toFixed(6)), 0.834, 'claude-haiku-4-5 transfer-station cost should match the provided price table')

    const grokUsage = {
      inputTokens: 1000000,
      cachedTokens: 700000,
      outputTokens: 100000
    }
    const grok45 = estimateModelCost(grokUsage, apikeyFunConfig, 'grok-4.5')
    ctx.assert.equal(grok45.tier, 'grok-4.5', 'grok-4.5 should use its own pricing tier')
    // 中转截图：输入 0.40 / 输出 1.20 / 缓存 0.10
    // 700k cache * 0.10 + 300k miss * 0.40 + 100k output * 1.20 = 0.07 + 0.12 + 0.12 = 0.31
    ctx.assert.equal(Number(grok45.cachedInputCost.toFixed(6)), 0.07, 'grok-4.5 cache-hit input should use 0.10 CNY per 1M')
    ctx.assert.equal(Number(grok45.missInputCost.toFixed(6)), 0.12, 'grok-4.5 uncached input should use 0.40 CNY per 1M')
    ctx.assert.equal(Number(grok45.outputCost.toFixed(6)), 0.12, 'grok-4.5 output should use 1.20 CNY per 1M')
    ctx.assert.equal(Number(grok45.amount.toFixed(6)), 0.31, 'grok-4.5 total should combine cache-hit, uncached input, and output prices')

    const grokBuild = estimateModelCost(grokUsage, apikeyFunConfig, 'grok-build-0.1')
    ctx.assert.equal(grokBuild.tier, 'grok-build-0.1', 'grok-build-0.1 should use its own pricing tier')
    ctx.assert.equal(Number(grokBuild.cachedInputCost.toFixed(6)), 0.14, 'grok-build-0.1 cache-hit input should use 0.20 CNY per 1M')
    ctx.assert.equal(Number(grokBuild.missInputCost.toFixed(6)), 0.12, 'grok-build-0.1 uncached input should use 0.40 CNY per 1M')
    ctx.assert.equal(Number(grokBuild.outputCost.toFixed(6)), 0.004, 'grok-build-0.1 output should use 0.04 CNY per 1M')
    ctx.assert.equal(Number(grokBuild.amount.toFixed(6)), 0.264, 'grok-build-0.1 total should combine cache-hit, uncached input, and output prices')

    const unknown = estimateModelCost(usage, { apiUrl: 'https://example.test/v1/chat/completions' }, 'unknown-model')
    ctx.assert.equal(unknown, null, 'unknown model should not show a fake cost estimate')
  }
}
