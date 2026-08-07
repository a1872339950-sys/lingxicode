(function () {
  const PUBLIC_THINKING_MAX_LENGTH = Number.POSITIVE_INFINITY

  const escapeHtml = HtmlUtils.escapeHtml

  function stripThinkingArtifacts(text) {
    let result = String(text || '')
    result = result.replace(/```(?:think|thinking|reasoning|reflection|analysis)\b[\s\S]*?```/gi, ' ')
    result = result.replace(/```[\s\S]*?```/g, ' ')
    for (const tag of ['think', 'thinking', 'reasoning', 'reflection', 'scratchpad', 'analysis', 'thought']) {
      result = result.replace(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi'), ' ')
      result = result.replace(new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi'), ' ')
    }
    return result
  }

  function isThinkingInlineToken(value = '') {
    const text = String(value || '').trim()
    if (!text || text.length > 96) return false
    if (/\s/.test(text)) return false
    if (/^[A-Z]{2,8}$/.test(text)) return false
    if (/[\\/]/.test(text) && /^[A-Za-z]:?[\\/]|^[\w.@()-]+[\\/]/.test(text)) return true
    if (/^[\w.@()-]+\.(?:js|ts|tsx|jsx|css|html|json|md|py|cs|java|go|rs)$/i.test(text)) return true
    if (/^[a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*(?:\([^)]*\))?$/.test(text)) return true
    if (/^[a-zA-Z_$][\w$]*\([^)]*\)$/.test(text)) return true
    if (/^[a-zA-Z_$][\w$]*(?:_[a-zA-Z0-9]+)+$/.test(text) && text.length >= 5) return true
    if (/^[a-zA-Z_$][\w$]*[A-Z][\w$]*$/.test(text) &&
        /[a-z]/.test(text) &&
        /[A-Z]/.test(text) &&
        (
          /(Component|Renderer|Manager|Service|Controller|Provider|Config|Store|Handler|Adapter|Client|View|Panel|Window|Dialog|Modal|State|Util|Utils|Result|Call|Start|Stop|Edit|Write|Read|Load|Save|Update|Create|Delete|Render|Build|Parse|Format|Normalize)$/.test(text) ||
          // 通用 camelCase 标识（如 recordToolResult），长度足够时作为内联 code chip
          (text.length >= 8 && /[a-z][A-Z]/.test(text))
        )) return true
    return false
  }

  function stripNaturalLanguageQuotes(text = '') {
    return String(text || '').replace(/[""''"]([^""''"\n]{2,96})[""''"]/g, (match, inner) => {
      const token = String(inner || '').trim()
      return isThinkingInlineToken(token) ? match : token
    })
  }

  function hasInternalThinkingLeak(raw = '') {
    const text = String(raw || '')
    if (!text) return false
    return [
      /系统(?:内部)?(?:提醒|提示|指令|规则)|内部(?:机制|工作流|提示|指令|门禁|链路|策略)/i,
      /代码地图|codemap|code\s*map|query_code_map|map[a-z0-9_-]{6,}/i,
      /workflow|internal_next_instruction|start_final_reply|hidden\s*(?:prompt|rule|system)/i,
      /根据[^。！？!?]{0,80}(?:系统提醒|系统提示|代码地图|codemap|工作流)/i,
      /(?:read|grep|rg|findstr|apply_patch|post_change_verify)\s*(?:报告|返回|显示|结果)/i
    ].some(pattern => pattern.test(text))
  }

  function normalizeThinkingPunctuation(raw = '') {
    let text = stripNaturalLanguageQuotes(stripThinkingArtifacts(raw))
      .replace(/[#*`|~]+/g, ' ')
      .replace(/[✓✔✅❌]/g, ' ')
      .replace(/(^|[。！？!?]\s*)[-*•]\s+/g, '$1')
      .replace(/\s*(?:->|=>|→)\s*/g, '，')
      .replace(/\s*(?:——|--+)\s*/g, '，')
      .replace(/[!！]{2,}/g, '！')
      .replace(/[?？]{2,}/g, '？')
      .replace(/[。]{2,}/g, '。')
      .replace(/[，]{2,}/g, '，')
      .replace(/\s*([，。！？；：,.!?;:])\s*/g, '$1')
      .replace(/：([。！？；])/g, '$1')
      .replace(/([：])([。！？；，])/g, '$2')
      .replace(/([，。！？；：,.!?;:])\1+/g, '$1')
      .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim()

    text = text
      .replace(/^[\s,，。！？!?：:；;'"""''()[\]{}<>《》「」]+/, '')
      .replace(/[：:]\s*$/, '')
      .replace(/[，,]\s*$/, '')
      .trim()

    return text
  }

  function getVisibleThinkingLength(value = '') {
    return String(value || '')
      .replace(/[#>*_`|~\s,，。！？!?：:；;'"""''()[\]{}<>《》「」]+/g, '')
      .trim()
      .length
  }

  function isUserRequestRestatement(raw = '') {
    const text = normalizeThinkingPunctuation(raw)
    if (!text) return false
    if (/^(用户|你|需求|任务|问题|这次)(?:想|要|要求|问|说|需要|让我|希望|是)/.test(text)) return true
    if (/^(用户问的是|用户想了解|用户要求|用户的需求是|这次需求是)/.test(text)) return true
    return false
  }

  function isNonProgressThinking(raw = '') {
    const text = normalizeThinkingPunctuation(raw)
    if (!text) return true
    if (getVisibleThinkingLength(text) <= 6) return true
    if (/^(遵守情况|执行情况|检查清单|完成清单|自检|约束确认)/.test(text)) return true
    if (/换一(?:个|种)思路[:：，]?.{0,40}(?:告诉用户|让用户|手动)/.test(text)) return true
    if (/(?:无法|不能|不行|没法).{0,80}(?:让用户|用户自己|用户手动|自行)/.test(text)) return true
    return false
  }

  const ACTION_RE = /(检查|创建|执行|验证|读取|查看|分析|调用|打开|运行|审查|修复|编辑|写入|搜索|检索|抓取|定位|确认|设计|实现|排查|核对|对齐|收拢|清理|恢复|保留|测试|新增|抽成|改成|补一个|动文件)/
  const FINDING_RE = /(关键点|定位方向|问题|原因|根因|导致|边界|结论|发现|看到|找到了|确认到|判断|修法|风险|回归|状态|生命周期|持久化|误判)/
  const TECH_RE = /\b(?:DOM|CSS|HTML|JS|API|Git|IPC|runtime|snapshot|history|reload|switch|ensure|cache|state|status|done|final|stream|reasoning|tool|branch|project|json|module)\b/i
  const NATURAL_RE = /(这里|那边|好像|可能|应该|不太|有点|奇怪|不对劲|再看看|让我|我想|我觉得|我猜|我怀疑|嗯|唔|咦|先不管|等等|等下|换个|试试|试一下|看看|瞅瞅|翻翻|瞄一眼|查一下|找找)/

  function isPublicThinkingSentence(raw = '') {
    const text = normalizeThinkingPunctuation(raw)
    if (!text) return false
    if (hasInternalThinkingLeak(text)) return false
    if (isUserRequestRestatement(text)) return false
    if (isNonProgressThinking(text)) return false
    return ACTION_RE.test(text) || FINDING_RE.test(text) || TECH_RE.test(text) || NATURAL_RE.test(text)
  }

  function getPublicThinkingScore(raw = '') {
    const text = normalizeThinkingPunctuation(raw)
    let score = 0
    if (FINDING_RE.test(text)) score += 3
    if (ACTION_RE.test(text)) score += 3
    if (TECH_RE.test(text)) score += 2
    if (NATURAL_RE.test(text)) score += 3
    if (/^(我先|我会|我看到|我继续|接下来|现在|这里|这次)/.test(text)) score += 1
    if (text.length > 240) score -= 1
    return score
  }

  function splitSentences(raw = '') {
    return normalizeThinkingPunctuation(raw)
      .split(/(?<=[。！？!?])\s*/)
      .map(item => normalizeThinkingPunctuation(item))
      .filter(Boolean)
  }

  function compactThinkingStatus(raw = '', maxLength = PUBLIC_THINKING_MAX_LENGTH) {
    const value = normalizeThinkingPunctuation(raw)
    if (!value || getVisibleThinkingLength(value) <= maxLength) return value
    const limited = value.slice(0, maxLength)
    const sentenceEnd = Math.max(
      limited.lastIndexOf('。'),
      limited.lastIndexOf('！'),
      limited.lastIndexOf('？'),
      limited.lastIndexOf('!'),
      limited.lastIndexOf('?')
    )
    if (sentenceEnd >= Math.floor(maxLength * 0.35)) {
      return normalizeThinkingPunctuation(limited.slice(0, sentenceEnd + 1))
    }
    const clauseEnd = Math.max(limited.lastIndexOf('，'), limited.lastIndexOf('；'), limited.lastIndexOf(','), limited.lastIndexOf(';'))
    if (clauseEnd >= Math.floor(maxLength * 0.45)) {
      return `${normalizeThinkingPunctuation(limited.slice(0, clauseEnd))}。`
    }
    return `${normalizeThinkingPunctuation(limited)}。`
  }

  function cleanVisibleThinkingPhrase(raw = '') {
    let text = normalizeThinkingPunctuation(raw)
    if (!text || hasInternalThinkingLeak(text)) return ''
    text = text
      .replace(/\b(?:line|lines)\s*\d+(?:\s*[-—至到]\s*\d+)?\b/gi, '')
      .replace(/第\s*\d+\s*行/g, '')
      .replace(/\b\d+\s*(?:个文件|条命令|次)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text || hasInternalThinkingLeak(text)) return ''
    if (getVisibleThinkingLength(text) <= 10) return ''
    return compactThinkingStatus(text)
  }

  function summarizeThinkingStatus(raw = '') {
    const text = normalizeThinkingPunctuation(raw)
    if (!text || !/[\p{L}\p{N}\u4e00-\u9fa5]/u.test(text)) return ''
    const sentences = splitSentences(text)
    const candidates = sentences
      .filter(isPublicThinkingSentence)
      .map((item, index) => ({ text: item, index, score: getPublicThinkingScore(item) }))
    if (!candidates.length) return ''
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.index - b.index
    })
    const top = candidates.slice(0, 2)
    const combined = top.map(c => cleanVisibleThinkingPhrase(c.text)).filter(Boolean).join('。')
    return combined || cleanVisibleThinkingPhrase(candidates[0]?.text || '')
  }

  function shouldDisplayThinkingStatus(raw = '') {
    return getVisibleThinkingLength(summarizeThinkingStatus(raw)) > 6
  }

  function renderThinkingStatusHtml(text = '') {
    const placeholders = []
    const stash = value => {
      const token = String(value || '').trim()
      if (!isThinkingInlineToken(token)) return escapeHtml(value)
      const index = placeholders.length
      placeholders.push(`<code class="ai-thinking-inline-code">${escapeHtml(token)}</code>`)
      return `\u0000${index}\u0000`
    }

    let value = normalizeThinkingPunctuation(text)
      .replace(/[""''"]([^""''"\n]{2,96})[""''"]/g, (match, inner) => {
        const token = String(inner || '').trim()
        return isThinkingInlineToken(token) ? stash(token) : escapeHtml(token)
      })
      .replace(/`([^`\n]{2,96})`/g, (match, inner) => stash(inner))
      .replace(/\b(?:[A-Za-z]:)?(?:[\w.@()-]+[\\/])+[\w.@() -]+\.[A-Za-z0-9]{1,8}\b/g, match => stash(match))
      .replace(/\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\([^)]*\))\b/g, match => stash(match))
      .replace(/(^|[^\w$])([a-zA-Z_$][\w$]*[A-Z][\w$]*)(?=$|[^\w$])/g, (match, prefix, token) => `${prefix}${stash(token)}`)

    value = escapeHtml(value)
    placeholders.forEach((html, index) => {
      value = value.replaceAll(`\u0000${index}\u0000`, html)
    })
    return value
  }

  window.ThinkingDisplay = {
    PUBLIC_THINKING_MAX_LENGTH,
    escapeHtml,
    isThinkingInlineToken,
    isUserRequestRestatement,
    isNonProgressThinking,
    hasInternalThinkingLeak,
    normalizeThinkingPunctuation,
    compactThinkingStatus,
    cleanVisibleThinkingPhrase,
    summarizeThinkingStatus,
    shouldDisplayThinkingStatus,
    renderThinkingStatusHtml,
    getVisibleThinkingLength
  }
})()
