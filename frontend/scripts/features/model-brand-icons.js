(function () {
  const ICON_BASE = 'assets/model-icons/lobe'
  const ICON_RULES = [
    { label: 'DeepSeek', icon: 'deepseek-color.svg', pattern: /deepseek/i },
    { label: 'GPT', icon: 'openai.svg', pattern: /\b(gpt|openai|o1|o3|o4|dall|sora)\b/i },
    { label: 'Claude', icon: 'claude-color.svg', pattern: /claude|anthropic/i },
    { label: 'GLM', icon: 'zhipu-color.svg', pattern: /glm|zhipu|bigmodel|chatglm/i },
    { label: 'Doubao', icon: 'doubao-color.svg', pattern: /doubao|seed|bytedance|volcengine|volces|ark/i },
    { label: 'Gemini', icon: 'gemini-color.svg', pattern: /gemini|google|谷歌/i },
    { label: 'Grok', icon: 'grok.svg', pattern: /grok|xai|x\.ai/i },
    { label: 'Hunyuan', icon: 'hunyuan-color.svg', pattern: /hunyuan|tencent|混元/i },
    { label: 'Qwen', icon: 'qwen-color.svg', pattern: /qwen|dashscope|aliyun|alibaba|通义|千问/i },
    { label: 'MiniMax', icon: 'minimax-color.svg', pattern: /minimax|abab|m1|m2|m3/i },
    { label: 'Kimi', icon: 'kimi-color.svg', pattern: /kimi|moonshot/i },
    { label: 'MiMo', icon: 'xiaomimimo.svg', pattern: /mimo|xiaomi/i }
  ]

  const escapeHtml = HtmlUtils.escapeHtml

  function detect(model = {}) {
    const text = [
      model.modelName,
      model.modelId,
      model.provider,
      model.cloudProvider,
      model.apiType,
      model.apiFormat
    ].filter(Boolean).join(' ')
    return ICON_RULES.find(rule => rule.pattern.test(text)) || null
  }

  // 从 modelName/modelId 提取首字母（中文/英文/数字皆可），跳过空白和符号
  function firstChar(model = {}) {
    const source = String(
      model.modelName || model.modelId || model.modelKey || model.provider || ''
    ).trim()
    if (!source) return '?'
    const match = source.match(/[\p{L}\p{N}]/u)
    return match ? match[0].toUpperCase() : '?'
  }

  // 稳定 hash → 调色板索引，让同一个模型始终是同一个底色
  const AVATAR_PALETTE = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
    '#06b6d4', '#6366f1', '#14b8a6', '#f43f5e', '#0ea5e9',
    '#a855f7', '#22c55e'
  ]
  function avatarColor(seed) {
    const text = String(seed || '')
    let h = 0
    for (let i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) | 0
    }
    return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]
  }

  function getIconHtml(model = {}, className = '') {
    const icon = detect(model)
    const classes = ['model-brand-icon', className].filter(Boolean).join(' ')
    if (icon) {
      return `<img class="${escapeHtml(classes)}" src="${ICON_BASE}/${escapeHtml(icon.icon)}" alt="${escapeHtml(icon.label)}" loading="lazy">`
    }
    // 兜底：固定 24×24 首字母占位，保证 grid 第一格永远占住空间，文字列不再被挤窄
    const ch = firstChar(model)
    const color = avatarColor(model.modelId || model.modelName || model.modelKey || ch)
    return `<span class="${escapeHtml(classes)} model-brand-avatar" style="--avatar-bg:${color}" aria-hidden="true">${escapeHtml(ch)}</span>`
  }

  window.ModelBrandIcons = {
    detect,
    getIconHtml,
    firstChar,
    avatarColor
  }
})()