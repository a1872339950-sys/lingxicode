(function () {
  function bind(options = {}) {
    const getCurrentAiMsg = options.getCurrentAiMsg || function () { return null }
    const getCurrentProjectPath = options.getCurrentProjectPath || function () { return '' }
    const getOpIcons = options.getOpIcons || function () { return {} }
    const getOpTypes = options.getOpTypes || function () { return {} }
    const getFileName = options.getFileName || function (path) { return path || '' }
    const calculateEditLines = options.calculateEditLines || function () { return { add: 0, remove: 0 } }
    const sanitizeContent = options.sanitizeContent || function (content) { return content || '' }

    let currentToolGroup = null
    const pendingToolCards = []
    const ToolDisplay = window.ToolDisplayMetadata || {}
    const HIDDEN_TOOL_CARD_NAMES = new Set(['complete_step'])

    const escapeHtml = HtmlUtils.escapeHtml

    const displayText = HtmlUtils.displayText.bind(HtmlUtils)
    const displayCount = HtmlUtils.displayCount.bind(HtmlUtils)

    function pendingHtmlFor(name, type) {
      const text = ToolDisplay.getPendingText
        ? ToolDisplay.getPendingText(name, type)
        : displayText('toolDisplay.pending.default')
      return `<span class="op-pending">${escapeHtml(text)}</span>`
    }

    function getFullFilePath(filePath) {
      return HtmlUtils.getFullFilePath(filePath, getCurrentProjectPath())
    }

    function toFileUrl(filePath = '') {
      const value = String(filePath || '').trim()
      if (!value) return ''
      if (/^(?:https?:|file:|data:|blob:)/i.test(value)) return value
      let normalized = value.replace(/\\/g, '/')
      if (!normalized.startsWith('/')) normalized = '/' + normalized
      return 'file://' + encodeURI(normalized)
    }

    function getMediaStageKind(name = '', type = '') {
      if (name === 'generate_image') return 'image'
      if (name === 'generate_video') return 'video'
      if (name === 'generate_music') return 'music'
      if (name === 'text_to_speech') return 'music'
      if (name === 'image_analyze' || name === 'inspect_image' || name === 'view_image' || type === 'vision') return 'vision'
      return ''
    }

    function getMediaStageLabel(kind = '', complete = false) {
      const key = `toolDisplay.mediaStage.${kind}.${complete ? 'complete' : 'pending'}`
      const translated = displayText(key)
      if (translated && translated !== key) return translated
      return complete ? '生成完成' : '正在生成'
    }

    /** P4 · 解析 vision 源图：路径 或 粘贴/上传的 dataUrl/base64 */
    function resolveVisionSourceUrl(args = {}, result = {}) {
      const pathValue = String(
        result.path || args.path || args.file_path || result.outputPath || ''
      ).trim()
      if (pathValue && !/^data:image\//i.test(pathValue)) {
        return toFileUrl(getFullFilePath(pathValue))
      }
      const inline = String(
        result.thumbnailDataUrl ||
        args.dataUrl || args.data_url || args.preview ||
        args.thumbnailDataUrl || args.base64 || args.data ||
        (pathValue.startsWith('data:image/') ? pathValue : '') ||
        ''
      ).trim()
      if (!inline) return ''
      if (/^(?:data:image\/|blob:|file:|https?:)/i.test(inline)) return inline
      // 纯 base64
      if (inline.length > 64 && /^[A-Za-z0-9+/=\r\n]+$/.test(inline)) {
        return `data:image/png;base64,${inline.replace(/\s+/g, '')}`
      }
      return ''
    }

    function resolveAspectStyle(width, height) {
      const w = Number(width) || 0
      const h = Number(height) || 0
      if (w > 0 && h > 0) return ` style="--media-result-aspect:${w} / ${h}"`
      return ''
    }

    function buildPendingMediaStage(name = '', type = '', args = {}) {
      const kind = getMediaStageKind(name, type)
      if (!kind) return ''
      const sourceUrl = kind === 'vision' ? resolveVisionSourceUrl(args) : ''
      const aspectStyle = resolveAspectStyle(
        args.width || args.thumbnailWidth,
        args.height || args.thumbnailHeight
      )
      // 紧凑 HTML：禁止换行/缩进文本节点（.tool-card-detail 曾用 pre-wrap 会撑出大块空白）
      const sourceImg = sourceUrl
        ? `<img class="tool-media-source" src="${escapeHtml(sourceUrl)}" alt="" data-media-source="1">`
        : ''
      return `<div class="tool-media-stage is-pending" data-media-kind="${kind}"${aspectStyle}><div class="tool-media-visual">${sourceImg}<canvas class="tool-media-prism-canvas" aria-hidden="true"></canvas></div></div>`
    }

    function buildCompletedMediaStage(name = '', type = '', args = {}, result = {}) {
      if (result.error || result.success === false) return ''
      const kind = getMediaStageKind(name, type)
      if (!kind) return ''
      const outputPath = result.path || result.outputPath || args.path || args.output_path || ''
      const fullPath = getFullFilePath(outputPath)
      const mediaUrl = toFileUrl(fullPath)
      const imageUrl = result.thumbnailDataUrl ||
        (kind === 'vision' ? resolveVisionSourceUrl(args, result) : '') ||
        (kind === 'vision' || kind === 'image' ? mediaUrl : '')
      let content = ''
      if ((kind === 'image' || kind === 'vision') && imageUrl) {
        content = `<button class="tool-media-result-button" type="button" data-path="${escapeHtml(fullPath)}" onclick="event.stopPropagation();openImagePreviewFromData(this)" title="${escapeHtml(displayText('toolDisplay.text.openOriginalImage'))}"><img class="tool-media-result-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(getFileName(outputPath) || getMediaStageLabel(kind, true))}" data-media-result="1"></button>`
      } else if (kind === 'video' && mediaUrl) {
        content = `<video class="tool-media-result-video" controls preload="metadata" src="${escapeHtml(mediaUrl)}"></video>`
      } else if (kind === 'music' && mediaUrl) {
        content = `<div class="tool-media-audio-shell"><img src="assets/brand/lingxi-logo-transparent.png" alt="" aria-hidden="true"><audio class="tool-media-result-audio" controls preload="metadata" src="${escapeHtml(mediaUrl)}"></audio></div>`
      }
      if (!content) return ''
      const dimensions = resolveAspectStyle(
        result.width || result.thumbnailWidth || args.width,
        result.height || result.thumbnailHeight || args.height
      )
      return `<div class="tool-media-stage is-complete" data-media-kind="${kind}"${dimensions}><div class="tool-media-visual">${content}</div></div>`
    }

    function hasMediaStage(detailHtml = '') {
      return /<div\s+class=["'][^"']*\btool-media-stage\b/i.test(String(detailHtml || ''))
    }

    /** 把宽高写入舞台：vision 在 maxW×maxH 盒内按真实比例缩放，杜绝 letterbox 空带 */
    function applyAspectToStage(stage, w, h) {
      if (!stage || !(w > 0 && h > 0)) return false
      const visual = stage.querySelector('.tool-media-visual')
      const kind = stage.dataset.mediaKind || ''
      const ratio = `${w} / ${h}`
      stage.style.setProperty('--media-result-aspect', ratio)
      if (!visual) return true
      visual.style.aspectRatio = ratio
      if (kind === 'vision') {
        const maxW = 340
        const maxH = 200
        // 以最大可用宽高按比例缩放，显式写 height，避免 aspect-ratio + max-height 在部分引擎下仍撑出空带
        let dispW = maxW
        let dispH = dispW * (h / w)
        if (dispH > maxH) {
          dispH = maxH
          dispW = dispH * (w / h)
        }
        dispW = Math.max(120, Math.round(dispW))
        dispH = Math.max(72, Math.round(dispH))
        stage.style.width = `${dispW}px`
        stage.style.maxWidth = '100%'
        visual.style.width = '100%'
        visual.style.height = `${dispH}px`
        visual.style.maxHeight = `${maxH}px`
      } else {
        visual.style.height = 'auto'
        visual.style.width = '100%'
      }
      return true
    }

    /**
     * P3 · 后端未返回 width/height 时，用 Image 探针读 naturalWidth 写入比例。
     * 不依赖 DOM 里是否已有 img（粘贴 base64 无 path 时仍可用 URL 探测）。
     */
    function probeMediaAspectFromUrl(stage, imageUrl) {
      if (!stage || !imageUrl) return
      if (stage.dataset.aspectProbed === '1') return
      // 已有内联比例则跳过
      const existing = String(stage.style.getPropertyValue('--media-result-aspect') || '').trim()
      if (existing) {
        stage.dataset.aspectProbed = '1'
        return
      }
      stage.dataset.aspectProbed = '1'
      const probe = new Image()
      probe.onload = () => {
        if (!document.contains(stage)) return
        applyAspectToStage(stage, probe.naturalWidth, probe.naturalHeight)
      }
      probe.onerror = () => {
        // 探针失败：vision 保持 4:3 默认，避免回落到正方形
        if ((stage.dataset.mediaKind || '') === 'vision') applyAspectToStage(stage, 4, 3)
      }
      probe.src = imageUrl
    }

    function applyMediaAspectRatio(stage) {
      if (!stage) return
      const kind = stage.dataset.mediaKind || ''
      const imgs = stage.querySelectorAll('img[data-media-source], img[data-media-result]')
      if (!imgs.length) {
        // 无 DOM 内 img：尝试 data-probe 属性旁的结果图 src，或 vision 默认 4:3
        const resultImg = stage.querySelector('.tool-media-result-image, .tool-media-source')
        const url = resultImg?.getAttribute('src') || ''
        if (url) {
          probeMediaAspectFromUrl(stage, url)
        } else if (kind === 'vision' && !String(stage.style.getPropertyValue('--media-result-aspect') || '').trim()) {
          applyAspectToStage(stage, 4, 3)
        }
        return
      }
      imgs.forEach(img => {
        const apply = () => applyAspectToStage(stage, img.naturalWidth, img.naturalHeight)
        if (img.complete && img.naturalWidth > 0) {
          apply()
        } else {
          img.addEventListener('load', apply, { once: true })
          img.addEventListener('error', () => {
            // load 失败时用 URL 再探一次；vision 最终兜底 4:3
            if (img.src) probeMediaAspectFromUrl(stage, img.src)
            else if (kind === 'vision') applyAspectToStage(stage, 4, 3)
          }, { once: true })
        }
        // 即使 complete 但 naturalWidth 暂为 0（缓存竞态），仍挂 URL 探针
        if (img.src && !(img.complete && img.naturalWidth > 0)) {
          probeMediaAspectFromUrl(stage, img.src)
        }
      })
    }

    function sampleLogoPrismPoints(logoImage) {
      const sampleSize = 160
      const sampleCanvas = document.createElement('canvas')
      sampleCanvas.width = sampleSize
      sampleCanvas.height = sampleSize
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })
      if (!sampleContext) return []
      sampleContext.clearRect(0, 0, sampleSize, sampleSize)
      sampleContext.drawImage(logoImage, 0, 0, sampleSize, sampleSize)
      const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data
      const raw = []
      let minX = sampleSize
      let minY = sampleSize
      let maxX = 0
      let maxY = 0
      for (let y = 1; y < sampleSize; y += 3) {
        for (let x = 1; x < sampleSize; x += 3) {
          const alpha = pixels[(y * sampleSize + x) * 4 + 3]
          if (alpha <= 72) continue
          raw.push({ x, y, alpha: alpha / 255 })
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
      if (!raw.length) return []
      // 裁掉透明边，点阵按 logo 实体包围盒归一化，避免上下大块空心
      const pad = 2
      minX = Math.max(0, minX - pad)
      minY = Math.max(0, minY - pad)
      maxX = Math.min(sampleSize - 1, maxX + pad)
      maxY = Math.min(sampleSize - 1, maxY + pad)
      const bw = Math.max(1, maxX - minX)
      const bh = Math.max(1, maxY - minY)
      return raw.map(point => ({
        x: ((point.x - minX) / bw) - 0.5,
        y: ((point.y - minY) / bh) - 0.5,
        alpha: point.alpha
      }))
    }

    function mountPrismAnimations(root) {
      root?.querySelectorAll?.('.tool-media-prism-canvas:not([data-mounted])').forEach(canvas => {
        canvas.dataset.mounted = 'true'
        const stage = canvas.closest('.tool-media-stage')
        const context = canvas.getContext('2d')
        if (!context || !stage) return
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        const kind = stage.dataset.mediaKind || 'image'
        applyMediaAspectRatio(stage)
        const phaseOffset = { image: 0, video: 0.7, music: 1.4, vision: 2.1 }[kind] || 0
        const logoImage = new Image()
        let logoPoints = []
        logoImage.onload = () => {
          logoPoints = sampleLogoPrismPoints(logoImage)
        }
        logoImage.src = 'assets/brand/lingxi-logo-transparent.png'

        const draw = now => {
          if (!document.contains(canvas) || !stage.classList.contains('is-pending')) return
          const rect = canvas.getBoundingClientRect()
          const dpr = Math.min(window.devicePixelRatio || 1, 1.6)
          const width = Math.max(1, Math.round(rect.width * dpr))
          const height = Math.max(1, Math.round(rect.height * dpr))
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
          }
          context.setTransform(dpr, 0, 0, dpr, 0, 0)
          context.clearRect(0, 0, rect.width, rect.height)
          const t = reducedMotion ? phaseOffset : now / 2600 + phaseOffset
          const cx = rect.width / 2
          const cy = rect.height / 2
          const dark = document.documentElement.getAttribute('data-theme-mode') !== 'light'
          const baseColor = dark ? [198, 220, 249] : [74, 108, 157]
          const fieldWidth = Math.min(rect.width * 0.98, 420)
          const fieldHeight = Math.min(rect.height * 0.95, 400)
          for (let row = 0; row < 11; row += 1) {
            for (let column = 0; column < 18; column += 1) {
              const nx = column / 17
              const ny = row / 10
              const wave = (Math.sin(t * 3.2 - nx * 6.4 + ny * 2.4) + 1) / 2
              const edgeFade = Math.sin(nx * Math.PI) * Math.sin(ny * Math.PI)
              const alpha = (0.045 + wave * 0.12) * edgeFade
              context.beginPath()
              context.arc(cx - fieldWidth / 2 + nx * fieldWidth, cy - fieldHeight / 2 + ny * fieldHeight, 0.7 + wave * 0.25, 0, Math.PI * 2)
              context.fillStyle = `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${alpha})`
              context.fill()
            }
          }

          // vision 用较大边缩放，logo 更填满舞台；其它类型略放大以抵消原透明边
          const logoScale = kind === 'music' ? 0.88 : kind === 'vision' ? 0.78 : 0.84
          const logoSize = Math.min(rect.width, rect.height) * logoScale
          const sweep = ((t * 0.46) % 1.4) - 0.2
          for (const point of logoPoints) {
            const diagonal = point.x * 0.72 + point.y * 0.28 + 0.5
            const distance = Math.abs(diagonal - sweep)
            const highlight = Math.max(0, 1 - distance / 0.17)
            const pulse = 0.72 + Math.sin(t * 2.1 + point.x * 10 + point.y * 7) * 0.12
            const alpha = point.alpha * (0.12 + highlight * 0.62) * pulse
            const drift = reducedMotion ? 0 : Math.sin(t * 1.7 + point.y * 11) * 0.45
            context.beginPath()
            context.arc(cx + point.x * logoSize + drift, cy + point.y * logoSize, 0.72 + highlight * 0.62, 0, Math.PI * 2)
            context.fillStyle = `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${alpha})`
            context.fill()
          }
          if (!reducedMotion) requestAnimationFrame(draw)
        }
        requestAnimationFrame(draw)
      })
    }

    const clipText = HtmlUtils.clipText.bind(HtmlUtils)

    function asPre(text, className = '') {
      const classAttr = className ? ` class="${className}"` : ''
      return `<pre${classAttr}>${escapeHtml(text)}</pre>`
    }

    const formatFileList = HtmlUtils.formatFileList.bind(HtmlUtils)

    const formatMatches = HtmlUtils.formatMatches.bind(HtmlUtils)

    const formatSearchCandidates = HtmlUtils.formatSearchCandidates.bind(HtmlUtils)

    const formatPathFailureDetail = HtmlUtils.formatPathFailureDetail.bind(HtmlUtils)

    function getCommandOutput(result = {}) {
      const parts = []
      if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
      if (result.stdout) parts.push(`[stdout]\n${result.stdout}`)
      if (result.output) parts.push(result.output)
      if (result.text) parts.push(result.text)
      if (!parts.length && result.message) parts.push(result.message)
      const limit = window.ToolDetailLazy?.UI_BASH_CHARS || 1000
      return clipText(parts.join('\n\n'), limit)
    }

    function buildBashDetailHtml(args = {}, result = {}) {
      const cmd = String(args.command || result.command || '').trim()
      const cwd = String(args.cwd || result.cwd || '').trim()
      const stdout = String(result.stdout || '').replace(/\s+$/, '')
      const stderr = String(result.stderr || '').replace(/\s+$/, '')
      const errorMsg = result.error || (result.success === false ? (result.message || 'Command failed') : '')
      const exitCode = result.exit_code ?? result.exitCode ?? result.code
      const sessionId = result.sessionId || result.session_id || result.session?.id || ''
      const isBackground = args.background === true || args.action === 'status' || args.action === 'stop' || !!sessionId
      const action = args.action || (isBackground ? 'run' : '')
      const hint = result.model_facing_hint || ''
      const fallbackOutput = result.output || result.text || result.message || ''
      const isFailure = !!errorMsg || result.success === false

      const parts = []

      // 命令头：$ <完整命令>
      if (cmd) {
        parts.push(`<div class="tool-bash-cmd"><span class="tool-bash-prompt">$</span><code>${escapeHtml(cmd)}</code></div>`)
      } else if (action) {
        parts.push(`<div class="tool-bash-cmd"><span class="tool-bash-prompt">⊳</span><code>action=${escapeHtml(action)}${sessionId ? ` session=${escapeHtml(sessionId)}` : ''}</code></div>`)
      }

      // 元信息行
      const metaBits = []
      if (exitCode !== undefined && exitCode !== null && exitCode !== '') {
        const exitCls = Number(exitCode) === 0 ? 'tool-bash-exit-ok' : 'tool-bash-exit-fail'
        metaBits.push(`<span class="${exitCls}">exit ${escapeHtml(String(exitCode))}</span>`)
      } else if (isFailure) {
        metaBits.push(`<span class="tool-bash-exit-fail">失败</span>`)
      } else if (cmd || action) {
        metaBits.push(`<span class="tool-bash-exit-ok">完成</span>`)
      }
      if (isBackground) {
        metaBits.push(`<span class="tool-bash-tag">后台</span>`)
      }
      if (cwd) {
        metaBits.push(`<span class="tool-bash-cwd" title="${escapeHtml(cwd)}">cwd: ${escapeHtml(getFileName(cwd) || cwd)}</span>`)
      }
      if (sessionId) {
        metaBits.push(`<span class="tool-bash-session">session: ${escapeHtml(String(sessionId).slice(0, 14))}</span>`)
      }
      if (metaBits.length) {
        parts.push(`<div class="tool-bash-meta">${metaBits.join('<span class="tool-bash-dot">·</span>')}</div>`)
      }

      // 输出区域
      const renderOutputBlock = (label, text, cls = '') => {
        if (!text) return
        const labelHtml = `<div class="tool-bash-label">${escapeHtml(label)}</div>`
        parts.push(`<div class="tool-bash-block ${cls}">${labelHtml}<pre>${escapeHtml(text)}</pre></div>`)
      }

      if (errorMsg) {
        renderOutputBlock('error', formatPathFailureDetail(result) || errorMsg, 'tool-bash-block-error')
      }
      renderOutputBlock('stdout', stdout || (isFailure ? '' : fallbackOutput && !stderr ? fallbackOutput : ''))
      renderOutputBlock('stderr', stderr, 'tool-bash-block-error')

      // 都为空时的提示区
      const hasOutput = !!(stdout || stderr || errorMsg || (fallbackOutput && !cmd))
      if (!hasOutput) {
        if (hint) {
          parts.push(`<div class="tool-bash-hint">${escapeHtml(hint)}</div>`)
        } else if (!cmd && !action) {
          // 检查是否有解析错误标记
          const hasParseError = result._parseError || result.code === 'invalid_tool_arguments'
          if (hasParseError) {
            parts.push(`<pre class="tool-bash-hint tool-bash-hint-error">${escapeHtml(displayText('toolDisplay.text.argumentParseFailed') || '参数解析失败，命令未执行')}</pre>`)
          } else {
            parts.push(`<pre>${escapeHtml(displayText('toolDisplay.text.commandDone'))}</pre>`)
          }
        } else {
          parts.push(`<div class="tool-bash-hint tool-bash-hint-mute">${escapeHtml(displayText('toolDisplay.text.commandDone'))}</div>`)
        }
      }

      return `<div class="tool-bash-detail">${parts.join('')}</div>`
    }

    function countTextLines(value = '') {
      const text = String(value || '')
      if (!text) return 0
      return Math.max(1, text.split(/\r\n|\r|\n/).length)
    }

    function getTextEditDelta(args = {}, result = {}) {
      const applied = Array.isArray(result.applied) ? result.applied : []
      const fromResult = {
        add: Number(result.added_lines || 0) || applied.reduce((sum, item) => sum + (Number(item.added_lines || 0) || 0), 0),
        remove: Number(result.removed_lines || 0) || applied.reduce((sum, item) => sum + (Number(item.removed_lines || 0) || 0), 0)
      }
      if (fromResult.add || fromResult.remove) return fromResult
      const edits = Array.isArray(args.edits) ? args.edits : []
      return edits.reduce((acc, edit) => {
        const op = String(edit?.op || '')
        if (op === 'insert_before' || op === 'insert_after') acc.add += countTextLines(edit.content)
        else if (op === 'delete') acc.remove += countTextLines(edit.old_content)
        else if (op === 'replace' || op === 'replace_all') {
          acc.add += countTextLines(edit.new_content)
          acc.remove += countTextLines(edit.old_content)
        }
        return acc
      }, { add: 0, remove: 0 })
    }

    function parsePatchFileDeltas(patch = '') {
      const map = new Map()
      let currentPath = ''
      const ensure = pathValue => {
        const key = String(pathValue || '').trim()
        if (!key) return null
        if (!map.has(key)) map.set(key, { path: key, add: 0, remove: 0 })
        return map.get(key)
      }
      String(patch || '').split(/\r\n|\r|\n/).forEach(line => {
        const addMatch = line.match(/^\*\*\* Add File:\s*(.+)$/)
        const updateMatch = line.match(/^\*\*\* Update File:\s*(.+)$/)
        const deleteMatch = line.match(/^\*\*\* Delete File:\s*(.+)$/)
        const moveMatch = line.match(/^\*\*\* Move to:\s*(.+)$/)
        if (addMatch || updateMatch || deleteMatch) {
          currentPath = (addMatch || updateMatch || deleteMatch)[1].trim()
          ensure(currentPath)
          return
        }
        if (moveMatch) {
          currentPath = moveMatch[1].trim()
          ensure(currentPath)
          return
        }
        if (!currentPath || line.startsWith('***') || line.startsWith('@@')) return
        const item = ensure(currentPath)
        if (!item) return
        if (line.startsWith('+')) item.add += 1
        else if (line.startsWith('-')) item.remove += 1
      })
      return map
    }

    function parsePatchFileSnippets(patch = '') {
      const map = new Map()
      let currentPath = ''
      const ensure = pathValue => {
        const key = String(pathValue || '').trim()
        if (!key) return null
        if (!map.has(key)) map.set(key, { path: key, oldLines: [], newLines: [] })
        return map.get(key)
      }
      String(patch || '').split(/\r\n|\r|\n/).forEach(line => {
        const addMatch = line.match(/^\*\*\* Add File:\s*(.+)$/)
        const updateMatch = line.match(/^\*\*\* Update File:\s*(.+)$/)
        const deleteMatch = line.match(/^\*\*\* Delete File:\s*(.+)$/)
        const moveMatch = line.match(/^\*\*\* Move to:\s*(.+)$/)
        if (addMatch || updateMatch || deleteMatch) {
          currentPath = (addMatch || updateMatch || deleteMatch)[1].trim()
          ensure(currentPath)
          return
        }
        if (moveMatch) {
          currentPath = moveMatch[1].trim()
          ensure(currentPath)
          return
        }
        if (!currentPath || line.startsWith('***') || line.startsWith('@@')) return
        const item = ensure(currentPath)
        if (!item) return
        if (line.startsWith('+')) item.newLines.push(line.slice(1))
        else if (line.startsWith('-')) item.oldLines.push(line.slice(1))
      })
      const result = new Map()
      map.forEach((value, key) => {
        result.set(key, {
          oldText: value.oldLines.join('\n'),
          newText: value.newLines.join('\n')
        })
      })
      return result
    }

    function collectTextEditDiffSnippet(args = {}) {
      const edits = Array.isArray(args.edits) ? args.edits : []
      const oldParts = []
      const newParts = []
      edits.forEach(edit => {
        const op = String(edit?.op || '')
        const oldVal = edit?.old_content != null ? String(edit.old_content) : ''
        const newVal = edit?.new_content != null ? String(edit.new_content) : ''
        const insertVal = edit?.content != null ? String(edit.content) : ''
        if (op === 'replace' || op === 'replace_all' || op === 'replace_regex' || op === 'replace_lines') {
          if (oldVal) oldParts.push(oldVal)
          if (newVal) newParts.push(newVal)
        } else if (op === 'insert_before' || op === 'insert_after' || op === 'insert_at_line' || op === 'insert_before_regex' || op === 'insert_after_regex') {
          if (insertVal) newParts.push(insertVal)
        } else if (op === 'delete' || op === 'delete_regex') {
          if (oldVal) oldParts.push(oldVal)
        } else {
          if (oldVal) oldParts.push(oldVal)
          if (newVal) newParts.push(newVal)
          if (!newVal && insertVal) newParts.push(insertVal)
        }
      })
      return { oldText: oldParts.join('\n\n'), newText: newParts.join('\n\n') }
    }

    function renderInlineDiffSnippet(oldText, newText) {
      const oldClipped = clipText(oldText || '', 1200)
      const newClipped = clipText(newText || '', 1200)
      if (!oldClipped && !newClipped) return ''
      const removeLabel = escapeHtml(displayText('toolDisplay.text.diffRemove'))
      const addLabel = escapeHtml(displayText('toolDisplay.text.diffAdd'))
      const removePane = `<div class="op-diff-section op-diff-remove"><div class="op-diff-label">${removeLabel}</div><pre>${escapeHtml(oldClipped || '')}</pre></div>`
      const addPane = `<div class="op-diff-section op-diff-add"><div class="op-diff-label">${addLabel}</div><pre>${escapeHtml(newClipped || '')}</pre></div>`
      return `<div class="op-diff">${removePane}${addPane}</div>`
    }

    function getToolFileEdits(name, args = {}, result = {}) {
      if (name === 'write_file' || name === 'create_file_session' || name === 'append_file_chunk' || name === 'finish_file_session') {
        const filePath = result.path || result.file_path || args.path || args.file_path || result.target_path || args.target_path || ''
        const content = args.content ?? args.chunk ?? result.content ?? ''
        const resultLines = Number(result.line_count || result.lines || result.written_lines || result.total_lines || args._streamAddedLines || 0)
        const add = resultLines > 0 ? resultLines : countTextLines(content)
        return [{ path: filePath, label: getFileName(filePath) || filePath, add, remove: 0 }]
      }
      if (name === 'apply_patch') {
        const deltas = parsePatchFileDeltas(args.patch || '')
        const files = Array.isArray(result.files) ? result.files : []
        const paths = new Set()
        files.forEach(item => {
          const filePath = item.path || item.file || item.to || item.destination || ''
          if (filePath) paths.add(filePath)
        })
        deltas.forEach((_, filePath) => paths.add(filePath))
        return [...paths].map(filePath => {
          const file = files.find(item => (item.path || item.file || item.to || item.destination || '') === filePath) || {}
          const delta = deltas.get(filePath) || {}
          const action = String(file.action || '').toLowerCase()
          return {
            path: filePath,
            label: getFileName(filePath) || filePath,
            add: Math.max(0, Number(file.added || file.additions || file.add || delta.add || (action === 'add' ? file.line_count : 0) || 0)),
            remove: Math.max(0, Number(file.removed || file.deletions || file.remove || delta.remove || (action === 'delete' ? file.line_count : 0) || 0))
          }
        }).filter(item => item.path || item.label)
      }
      if (name === 'json_edit') {
        const filePath = result.path || args.path || ''
        return [{ path: filePath, label: getFileName(filePath) || filePath, add: 1, remove: 1 }]
      }
      if (name === 'text_edit') {
        const filePath = result.path || args.path || ''
        const delta = getTextEditDelta(args, result)
        return [{ path: filePath, label: getFileName(filePath) || filePath, add: delta.add || 0, remove: delta.remove || 0 }]
      }
      if (name === 'copy_file' || name === 'move_file') {
        const filePath = result.destination || args.destination || args.to || args.path || args.file_path || ''
        return [{ path: filePath, label: getFileName(filePath) || filePath, add: 0, remove: 0 }]
      }
      const filePath = args.path || args.file_path || result.path || ''
      const oldStr = getEditOldContent(args)
      const newStr = getEditNewContent(args)
      if (!filePath && !oldStr && !newStr) return []
      const lines = calculateEditLines(oldStr, newStr)
      return [{ path: filePath, label: getFileName(filePath) || filePath, add: lines.add || 0, remove: lines.remove || 0 }]
    }

    function getEditRowKey(item = {}, index = 0) {
      const rawPath = String(item.path || '').trim()
      if (rawPath) return rawPath.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
      const label = String(item.label || '').trim()
      return label ? `label:${label.toLowerCase()}` : `row:${index}`
    }

    function mergeEditRowsByPath(edits = []) {
      const merged = []
      const byKey = new Map()
      edits.forEach((item, index) => {
        if (!item) return
        const key = getEditRowKey(item, index)
        const existing = byKey.get(key)
        if (existing) {
          existing.add += Math.max(0, Number(item.add || 0))
          existing.remove += Math.max(0, Number(item.remove || 0))
          if (!existing.path && item.path) existing.path = item.path
          if (!existing.label && item.label) existing.label = item.label
          return
        }
        const next = {
          ...item,
          add: Math.max(0, Number(item.add || 0)),
          remove: Math.max(0, Number(item.remove || 0))
        }
        byKey.set(key, next)
        merged.push(next)
      })
      return merged
    }

    function getReadRangeSuffix(args = {}, result = {}) {
      const start = args.start_line ?? args.startLine ?? result.start_line ?? result.startLine
      const end = args.end_line ?? args.endLine ?? result.end_line ?? result.endLine
      if (start || end) return `:${start || 1}-${end || '?'}`
      if (args.limit) {
        const startLine = parseInt(args.offset || 1, 10)
        return `:${startLine}-${startLine + parseInt(args.limit, 10)}`
      }
      return ''
    }

    function getReadManyItems(args = {}, result = {}) {
      const resultFiles = Array.isArray(result.files) ? result.files : []
      const argFiles = Array.isArray(args.files) ? args.files : []
      const source = resultFiles.length ? resultFiles : argFiles
      return source.map(item => {
        if (typeof item === 'string') return { path: item, label: item, success: true }
        const filePath = item.relative_path || item.requested_path || item.path || item.file || item.file_path || ''
        const start = item.start_line ?? item.startLine
        const end = item.end_line ?? item.endLine
        const range = item.range_read || start || end ? `:${start || 1}-${end || '?'}` : ''
        return {
          path: filePath,
          label: `${filePath}${range}`,
          success: item.success !== false,
          error: item.error || ''
        }
      }).filter(item => item.path || item.label)
    }

    function buildReadManyTargetSummary(args = {}, result = {}, maxItems = Infinity) {
      const items = getReadManyItems(args, result)
      if (!items.length) return displayText('toolDisplay.text.batchFiles')
      const limit = Number.isFinite(maxItems) ? maxItems : items.length
      const labels = items.slice(0, limit).map(item => getFileName(item.label || item.path) || item.label || item.path)
      const more = items.length > limit ? displayCount('toolDisplay.text.moreFilesSuffix', items.length) : ''
      return `${labels.join('、')}${more}`
    }

    function getToolTargetLabel(name, args = {}, result = {}) {
      if (name === 'write_file' || name === 'create_file_session' || name === 'append_file_chunk' || name === 'finish_file_session') {
        const edits = mergeEditRowsByPath(getToolFileEdits(name, args, result))
        return edits[0]?.label || edits[0]?.path || getFileName(result.path || result.file_path || args.path || args.file_path || '')
      }
      if (name === 'copy_file' || name === 'move_file') return getFileName(result.destination || args.destination || args.to || args.source || args.from || '')
      if (name === 'apply_patch') {
        const edits = mergeEditRowsByPath(getToolFileEdits(name, args, result))
        if (edits.length === 1) return edits[0].label || edits[0].path
        return edits.length ? displayCount('toolDisplay.text.files', edits.length) : displayText('toolDisplay.text.patch')
      }
      if (name === 'git_diff') return args.path || displayText('toolDisplay.text.workingTreeDiff')
      if (name === 'read_many_files') {
        return buildReadManyTargetSummary(args, result)
      }
      if (name === 'get_latest_change_session' || name === 'get_change_session') return displayText('toolDisplay.text.recentChanges')
      if (name === 'rollback_latest_change_session' || name === 'rollback_change_session') return displayText('toolDisplay.text.changeRollback')
      if (name === 'ui_smoke_check') return args.html_path || args.url || result.url || displayText('toolDisplay.text.interface')
      if (name === 'json_edit') return getFileName(result.path || args.path || '')
      const filePath = args.file_path || args.path || result.path || ''
      if (filePath && !args.query && !args.pattern && !args.q) return `${getFileName(filePath)}${name === 'read_file' ? getReadRangeSuffix(args, result) : ''}`
      return args.pattern || args.query || args.q || args.regex || result.query || getWebTarget(args, result) || filePath || name
    }

    function getToolEditStats(name, args = {}, result = {}) {
      if (name === 'write_file' || name === 'create_file_session' || name === 'append_file_chunk' || name === 'finish_file_session') {
        const edits = mergeEditRowsByPath(getToolFileEdits(name, args, result))
        return {
          fileCount: edits.length,
          add: edits.reduce((sum, item) => sum + Math.max(0, Number(item.add || 0)), 0),
          remove: 0
        }
      }
      if (name === 'apply_patch') {
        const edits = mergeEditRowsByPath(getToolFileEdits(name, args, result))
        return {
          fileCount: edits.length,
          add: edits.reduce((sum, item) => sum + Math.max(0, Number(item.add || 0)), 0),
          remove: edits.reduce((sum, item) => sum + Math.max(0, Number(item.remove || 0)), 0)
        }
      }
      if (name === 'json_edit') return { fileCount: 1, add: 1, remove: 1 }
      if (name === 'text_edit') {
        const delta = getTextEditDelta(args, result)
        return { fileCount: args.path || result.path ? 1 : 0, add: delta.add || 0, remove: delta.remove || 0 }
      }
      if (name === 'copy_file' || name === 'move_file') return { fileCount: 1, add: 0, remove: 0 }
      const lines = calculateEditLines(getEditOldContent(args), getEditNewContent(args))
      const fileCount = args.path || args.file_path ? 1 : 0
      return { fileCount, add: lines.add || 0, remove: lines.remove || 0 }
    }

    function renderDiffNumber(value, direction = 'up') {
      const text = String(Math.max(0, Number(value) || 0))
      const digits = text.split('').map((digit, index) => (
        `<span class="diff-roll-digit" style="--roll-index:${index}">${escapeHtml(digit)}</span>`
      )).join('')
      return `<span class="diff-roll-number" data-roll-dir="${direction}" aria-label="${escapeHtml(text)}">${digits}</span>`
    }

    function renderLiveDiffNumber(value) {
      const text = String(Math.max(0, Number(value) || 0))
      const digits = text.split('').map(digit => (
        `<span class="diff-live-digit">${escapeHtml(digit)}</span>`
      )).join('')
      return `<span class="diff-live-number" data-live-value="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">${digits}</span>`
    }

    function updateLiveDiffNumber(numberEl, nextValue) {
      if (!numberEl) return
      const nextText = String(Math.max(0, Number(nextValue) || 0))
      const previousText = String(numberEl.dataset.liveValue || numberEl.getAttribute('aria-label') || '0')
      if (previousText === nextText) return
      if (previousText.length !== nextText.length) {
        numberEl.innerHTML = nextText.split('').map(digit => `<span class="diff-live-digit">${escapeHtml(digit)}</span>`).join('')
      } else {
        const digits = numberEl.querySelectorAll('.diff-live-digit')
        nextText.split('').forEach((digit, index) => {
          const digitEl = digits[index]
          if (!digitEl || digitEl.textContent === digit) return
          digitEl.textContent = digit
          digitEl.classList.remove('rolling')
          void digitEl.offsetWidth
          digitEl.classList.add('rolling')
        })
      }
      numberEl.dataset.liveValue = nextText
      numberEl.setAttribute('aria-label', nextText)
    }

    function renderEditStats(stats = {}) {
      const addText = stats.add > 0 ? `<span class="op-add">+${renderDiffNumber(stats.add, 'up')}</span>` : ''
      const removeText = stats.remove > 0 ? `<span class="op-remove">-${renderDiffNumber(stats.remove, 'down')}</span>` : ''
      return [addText, removeText].filter(Boolean).join('')
    }

    function renderWriteSummaryHtml(name, args = {}, result = {}) {
      const edits = mergeEditRowsByPath(getToolFileEdits(name, args, result))
      const item = edits[0] || {}
      const rawPath = item.path || result.path || result.file_path || args.path || args.file_path || result.target_path || args.target_path || ''
      const fullPath = rawPath ? getFullFilePath(rawPath) : ''
      const label = item.label || getFileName(rawPath) || rawPath || displayText('toolDisplay.text.file')
      const statsHtml = renderEditStats({ add: item.add || 0, remove: 0 })
      const chunkIndex = result.chunk_index ?? result.chunkIndex ?? args.chunk_index ?? args.chunkIndex
      const totalChunks = result.total_chunks ?? result.totalChunks ?? args.total_chunks ?? args.totalChunks
      const chunkHtml = chunkIndex !== undefined || totalChunks !== undefined
        ? ` <span class="op-source">${escapeHtml(`分片 ${chunkIndex !== undefined ? chunkIndex : '?'}${totalChunks !== undefined ? '/' + totalChunks : ''}`)}</span>`
        : ''
      const fileHtml = fullPath
        ? `<span class="op-file" data-path="${escapeHtml(fullPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(label)}</span>`
        : `<span class="op-file">${escapeHtml(label)}</span>`
      return `${fileHtml}${statsHtml ? ` ${statsHtml}` : ''}${chunkHtml}`
    }

    function buildWriteDetailHtml(name, args = {}, result = {}) {
      if (result.error || result.success === false) return asPre(formatPathFailureDetail(result) || result.error || 'Tool failed', 'tool-error')
      const rawPath = result.path || result.file_path || args.path || args.file_path || result.target_path || args.target_path || ''
      const content = args.content ?? args.chunk ?? ''
      const preview = content ? clipText(content, 1000) : ''
      const lines = [
        result.message || '',
        rawPath ? `${displayText('toolDisplay.text.path')} ${rawPath}` : '',
        preview ? `${displayText('toolDisplay.text.preview')}\n${preview}` : ''
      ].filter(Boolean).join('\n\n')
      return asPre(lines || displayText('toolDisplay.text.done'))
    }

    function renderToolEditFileRows(edits = [], diffMap = null) {
      const rows = mergeEditRowsByPath(edits).map((item, index) => {
        const fullPath = getFullFilePath(item.path || '')
        const label = item.label || getFileName(item.path || '') || item.path || displayText('toolDisplay.text.file')
        const statsHtml = renderEditStats(item)
        const rowHeader = `
          <span class="tool-card-summary">
            <span class="op-file" data-path="${escapeHtml(fullPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(label)}</span>
            ${statsHtml}
          </span>`
        const snippet = diffMap && diffMap.get ? diffMap.get(item.path || '') : null
        const diffHtml = snippet ? renderInlineDiffSnippet(snippet.oldText || '', snippet.newText || '') : ''
        if (!diffHtml) {
          return `<div class="tool-edit-file-row">${rowHeader}</div>`
        }
        return `<details class="tool-edit-file-row-details" data-row-index="${index}"><summary class="tool-edit-file-row tool-edit-file-row-summary" onclick="event.stopPropagation();">${rowHeader}<span class="tool-edit-file-row-toggle" aria-hidden="true"><svg viewBox="0 0 16 16" width="10" height="10"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></summary><div class="tool-edit-file-row-detail">${diffHtml}</div></details>`
      }).join('')
      return `<div class="tool-edit-file-list">${rows}</div>`
    }

    function setToolCardMeta(card, name, type, args = {}, result = {}, summaryHtml = '') {
      if (!card) return
      const target = getToolTargetLabel(name, args, result)
      const stats = getToolEditStats(name, args, result)
      card.dataset.toolName = name || ''
      card.dataset.toolType = type || ''
      card.dataset.diagnosticHit = isRuntimeErrorCaptureHit(name, result) ? 'true' : ''
      card.dataset.targetLabel = target || ''
      card.dataset.summaryText = String(summaryHtml || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      card.dataset.editFileCount = String(stats.fileCount || 0)
      card.dataset.editAdd = String(stats.add || 0)
      card.dataset.editRemove = String(stats.remove || 0)
    }


    function getToolType(name) {
      const type = getOpTypes()[name]
      if (type) return type
      if (name === 'apply_patch') return 'edit'
      if (name === 'json_edit') return 'edit'
      if (name === 'text_edit') return 'edit'
      if (name === 'edit_file') return 'edit'
      if (name === 'write_file') return 'write'
      if (name === 'create_file_session' || name === 'append_file_chunk' || name === 'finish_file_session') return 'write'
      if (name === 'move_file') return 'edit'
      if (name === 'copy_file') return 'write'
      if (name === 'create_directory') return 'folder'
      if (name === 'delete_file') return 'edit'
      if (name === 'get_latest_change_session' || name === 'get_change_session') return 'read'
      if (name === 'rollback_latest_change_session' || name === 'rollback_change_session') return 'edit'
      if (name === 'shell_run') return 'bash'
      if (name === 'lxweb') return 'browser'
      if (name === 'research_website_runtime' || name === 'verify_runtime_smoke' || name === 'runtime_verify') return 'browser'
      if (name === 'find_software') return 'search'
      if (name === 'open_software') return 'step'
      if (name === 'report_progress' || name === 'start_final_reply' || name === 'show_thinking_note' || name === 'get_agent_collaboration_status') return 'step'
      if (name === 'enter_plan_mode' || name === 'ask_user_choice' || name === 'confirm_plan' || name === 'complete_step') return 'step'
      if (name === 'read_task_ledger_entry') return 'read'
      if (name === 'find_references') return 'grep'
      if (name === 'check_syntax' || name === 'post_change_verify') return 'read'
      if (String(name || '').startsWith('excel_')) return 'excel'
      if (String(name || '').startsWith('ppt_')) return 'ppt'
      if (String(name || '').startsWith('blender_')) return 'blender'
      if (name === 'read_many_files') return 'read'
      if (name === 'git_diff') return 'read'
      if (name === 'find_in_file') return 'grep'
      if (name === 'grep_code') return 'grep'
      if (name === 'glob_files') return 'glob'
      if (name === 'locate_code' || name === 'search_project' || name === 'discover_code' || name === 'dev_workflow' || name === 'parallel_research' || name === 'recall_history' || name === 'code_navigate') return 'search'
      if (name === 'generate_music') return 'music'
      if (name === 'text_to_speech') return 'music'
      if (name === 'generate_video') return 'video'
      if (name === 'image_analyze' || name === 'inspect_image') return 'vision'
      if (name === 'view_image') return 'vision'
      if (name === 'ui_interaction_check' || name === 'ui_smoke_check') return 'browser'
      if (String(name || '').startsWith('music_')) return 'music'
      return 'unknown'
    }

    function shouldHideToolCard(name = '') {
      return HIDDEN_TOOL_CARD_NAMES.has(String(name || ''))
    }

    function getEditOldContent(args = {}) {
      return args.old_content ?? args.old_string ?? args.old ?? ''
    }

    function getEditNewContent(args = {}) {
      return args.new_content ?? args.new_string ?? args.new ?? args.content ?? ''
    }

    function buildResultDetail(result = {}, fallback = displayText('toolDisplay.text.done')) {
      if (result.error || result.success === false) return asPre(formatPathFailureDetail(result) || result.error || 'Tool failed', 'tool-error')
      return asPre(clipText(result.content || result.text || result.message || fallback, 800))
    }

    function isRuntimeErrorCaptureHit(name, result = {}) {
      if (name !== 'ui_interaction_check') return false
      if (!(result.error || result.success === false)) return false
      const text = [result.error, result.message, ...(Array.isArray(result.failures) ? result.failures : [])]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      return /window error|unhandled rejection|console error|runtime error|interaction/.test(text)
    }

    function formatRuntimeErrorCaptureDetail(result = {}) {
      const lines = [displayText('toolDisplay.text.runtimeErrorCapturedDetail')]
      const raw = String(result.error || result.message || '').trim()
      if (raw && !/ui interaction check failed/i.test(raw)) lines.push(raw)
      const failures = Array.isArray(result.failures) ? result.failures.filter(Boolean) : []
      const consoleErrors = Array.isArray(result.consoleErrors) ? result.consoleErrors.filter(Boolean) : []
      const events = Array.isArray(result.events) ? result.events : Array.isArray(result.errors) ? result.errors : []
      const source = result.sourceId || result.sourceURL || result.url || result.pageUrl || ''
      const line = result.lineNumber || result.line || result.lineno || ''
      const column = result.columnNumber || result.column || result.colno || ''
      const stack = result.stack || result.stackTrace || ''
      if (source) lines.push(`${displayText('toolDisplay.text.runtimeErrorSource')} ${source}`)
      if (line || column) lines.push(`${displayText('toolDisplay.text.runtimeErrorLine')} ${[line, column].filter(Boolean).join(':')}`)
      if (failures.length) lines.push(`${displayText('toolDisplay.text.failures')} ${failures.join('；')}`)
      if (consoleErrors.length) lines.push(`${displayText('toolDisplay.text.consoleErrors')} ${consoleErrors.map(item => typeof item === 'string' ? item : item.text || item.message || JSON.stringify(item)).join('\n')}`)
      events.slice(0, 5).forEach(item => {
        const message = typeof item === 'string' ? item : item.message || item.text || item.error || ''
        const itemSource = typeof item === 'object' ? (item.sourceId || item.sourceURL || item.url || '') : ''
        const itemLine = typeof item === 'object' ? (item.lineNumber || item.line || '') : ''
        if (message) lines.push(message)
        if (itemSource) lines.push(`${displayText('toolDisplay.text.runtimeErrorSource')} ${itemSource}${itemLine ? ':' + itemLine : ''}`)
      })
      if (stack) lines.push(`${displayText('toolDisplay.text.runtimeErrorStack')}\n${stack}`)
      return asPre(lines.filter(Boolean).join('\n'), 'tool-diagnostic')
    }

    function getWebTarget(args = {}, result = {}) {
      const action = String(args.action || args.fn || args.type || result.action || '').toLowerCase()
      const url = args.url || args.html_path || args.htmlPath || args.ref_id || args.href || args.link || result.url || result.href || result.link || ''
      if (url) return String(url)
      if (action.includes('search')) return String(args.query || args.q || result.query || '')
      return String(args.query || args.q || result.query || '')
    }

    function buildWebSummary(target = '') {
      const value = String(target || '').trim()
      if (!value) return `<span class="op-source">${escapeHtml(displayText('toolDisplay.text.processing'))}</span>`
      const short = escapeHtml(value.substring(0, 80))
      if (/^https?:\/\//i.test(value)) {
        return `<span class="op-file" onclick="event.stopPropagation();openInWebview('${escapeHtml(value)}')">${short}</span>`
      }
      return `<span class="op-file">${short}</span>`
    }

    function getWebToolLabel(name = '', args = {}, result = {}) {
      if (name !== 'lxweb') return getToolLabel(name, 'browser')
      const rawAction = String(args.action || result.action || (args.query || args.q ? 'search' : args.url ? 'fetch' : 'status')).toLowerCase()
      const action = /design|ui_design|analyze_ui|inspect_ui|replicate_ui/.test(rawAction)
        ? 'design'
        : /find/.test(rawAction)
          ? 'find'
          : /open/.test(rawAction)
            ? 'open'
            : /fetch|url/.test(rawAction)
              ? 'fetch'
              : /search/.test(rawAction)
                ? 'search'
                : 'status'
      const key = `tool.lxweb.action.${action}`
      return ToolDisplay.t ? ToolDisplay.t(key, null, getToolLabel(name, 'browser')) : getToolLabel(name, 'browser')
    }

    function stableArgsKey(value) {
      if (value === null || value === undefined) return ''
      if (typeof value !== 'object') return String(value)
      if (Array.isArray(value)) return `[${value.map(stableArgsKey).join(',')}]`
      return `{${Object.keys(value).sort().map(key => `${key}:${stableArgsKey(value[key])}`).join(',')}}`
    }

    function updateToolStats(stats, type, args, result, fullFilePath) {
      if (!stats) return
      if (!result?.error && result?.success !== false) {
        if (type === 'read' && fullFilePath && !stats.read.includes(fullFilePath)) {
          stats.read.push(fullFilePath)
        } else if ((type === 'write' || type === 'folder') && fullFilePath && !stats.created.includes(fullFilePath)) {
          stats.created.push(fullFilePath)
        } else if (type === 'edit' && fullFilePath && !stats.modified.includes(fullFilePath)) {
          stats.modified.push(fullFilePath)
        }
      }
      if (type === 'bash' && args.command) {
        stats.commands.push(args.command)
      }
    }

    function getToolLabel(name, type) {
      // 编辑/写入类工具统一展示为 已编辑 / 已写入，后接文件名和 diff
      if (type === 'edit') return '已编辑'
      if (type === 'write') return '已写入'
      return ToolDisplay.getToolLabel ? ToolDisplay.getToolLabel(name, type) : (name || type || '')
    }

    function buildOperationContent(name, args = {}, result = {}) {
      const type = getToolType(name)
      const filePath = args.file_path || args.path || ''
      const fullFilePath = getFullFilePath(filePath)
      let toolNameCn = getToolLabel(name, type)
      let summaryHtml = ''
      let detailHtml = ''

      switch (type) {
        case 'search': {
          if (name === 'dev_workflow') {
            const modeLabel = displayText(`toolDisplay.devMode.${result.mode || args.mode || 'default'}`)
            const failedCount = Number(result.syntax?.failed_count || 0)
            const logicErrorCount = Number(result.logic_review?.error_count || 0)
            const logicWarningCount = Number(result.logic_review?.warning_count || 0)
            const candidateCount = Array.isArray(result.discovery?.candidates) ? result.discovery.candidates.length : 0
            const summaryBits = []
            if (failedCount) summaryBits.push(displayCount('toolDisplay.text.issues', failedCount))
            if (logicErrorCount) summaryBits.push(displayCount('toolDisplay.text.risks', logicErrorCount))
            if (!logicErrorCount && logicWarningCount) summaryBits.push(displayCount('toolDisplay.text.warnings', logicWarningCount))
            if (candidateCount) summaryBits.push(displayCount('toolDisplay.text.clues', candidateCount))
            summaryHtml = `<span class="op-file">${escapeHtml(modeLabel)}</span>${summaryBits.length ? ` <span class="op-source">${escapeHtml(summaryBits.join('，'))}</span>` : ''}`
            const rows = [
              result.summary || '',
              result.next_action ? `${displayText('toolDisplay.text.nextStep')} ${result.next_action}` : '',
              result.logic_review?.findings?.length ? `${displayText('toolDisplay.text.qualityReview')}\n${result.logic_review.findings.slice(0, 8).map(item => `- ${item.severity || 'warning'} ${item.path || ''}${item.line ? ':' + item.line : ''} ${item.message || ''}${item.suggestion ? `\n  ${displayText('toolDisplay.text.suggestion')} ${item.suggestion}` : ''}`).join('\n')}` : '',
              result.syntax?.failed_files?.length ? `${displayText('toolDisplay.text.failedFiles')}\n${result.syntax.failed_files.slice(0, 10).map(item => `- ${item.path || item.file || item}`).join('\n')}` : '',
              result.syntax?.code_frames?.length ? `${displayText('toolDisplay.text.codeSnippets')}\n${result.syntax.code_frames.slice(0, 4).map(item => `${item.path || ''}:${item.start_line || '?'}-${item.end_line || '?'}\n${item.content || ''}`).join('\n\n')}` : '',
              result.discovery?.readHints?.length ? `${displayText('toolDisplay.text.suggestedReads')}\n${result.discovery.readHints.slice(0, 8).map(item => `- ${item.path || ''}:${item.start_line || 1}-${item.end_line || '?'}`).join('\n')}` : ''
            ].filter(Boolean).join('\n\n')
            detailHtml = result.error || result.success === false ? asPre(result.error || displayText('toolDisplay.text.devFailed'), 'tool-error') : asPre(rows || displayText('toolDisplay.text.devDone'))
            break
          }
          if (name === 'code_navigate') {
            const sym = args.symbol || args.query || ''
            const line = args.line || result.matches?.[0]?.start_line || ''
            const targetLabel = sym ? `${sym}${line ? ':' + line : ''}` : (line ? `:${line}` : '')
            summaryHtml = targetLabel
              ? `<span class="op-file">${escapeHtml(targetLabel)}</span>`
              : ''
            const matchCount = Array.isArray(result.matches) ? result.matches.length : 0
            if (matchCount) summaryHtml += ` <span class="op-source">${escapeHtml(displayCount('toolDisplay.text.matches', matchCount))}</span>`
            detailHtml = asPre(result.preview || (result.matches || []).map(m => `${m.name || ''} ${m.kind || ''}:${m.start_line || '?'} ${m.preview || ''}`).join('\n') || displayText('toolDisplay.text.searchDone'))
            break
          }
          const query = args.query || args.q || args.pattern || result.query || ''
          const url = result.url || ''
          const candidateCount = Array.isArray(result.highConfidence) && result.highConfidence.length
            ? result.highConfidence.length
            : (Array.isArray(result.candidates) ? result.candidates.length : 0)
          const fileCount = Array.isArray(result.files) ? result.files.length : 0
          const grepCount = Array.isArray(result.grep) ? result.grep.length : 0
          const mediumCount = Array.isArray(result.mediumConfidence) ? result.mediumConfidence.length : 0
          const hitCount = candidateCount || mediumCount || fileCount || grepCount || result.count || result.totalMatches || 0
          const targetHtml = url
            ? `<span class="op-file" onclick="event.stopPropagation();openInWebview('${escapeHtml(url)}')">${escapeHtml(query || url)}</span>`
            : `<span class="op-file">${escapeHtml(query || displayText('toolDisplay.text.projectClues'))}</span>`
          summaryHtml = `${targetHtml}${hitCount ? ` <span class="op-source">${escapeHtml(displayCount('toolDisplay.text.matches', hitCount))}</span>` : ''}`
          const searchRows = formatSearchCandidates(result)
          const rows = Array.isArray(result.results)
            ? result.results.map((item, index) => `${index + 1}. ${item.title || item.url || ''}`).join('\n')
            : ''
          detailHtml = result.error ? asPre(result.error, 'tool-error') : asPre(searchRows || rows || result.text || displayText('toolDisplay.text.searchDone'))
          break
        }
        case 'read': {
          if (name === 'git_diff') {
            summaryHtml = `<span class="op-file">${escapeHtml(args.path || displayText('toolDisplay.text.workingTreeDiff'))}</span>`
            detailHtml = result.error || result.success === false
              ? asPre(result.error || 'Git diff failed', 'tool-error')
              : asPre(result.diff || displayText('toolDisplay.text.noDiff'))
            break
          }
          if (name === 'read_many_files') {
            const files = Array.isArray(result.files) ? result.files : []
            const items = getReadManyItems(args, result)
            const okCount = result.ok_count ?? files.filter(item => item.success).length
            const label = buildReadManyTargetSummary(args, result)
            const count = okCount || files.length || items.length || 0
            const readState = result.error || result.success === false ? displayText('toolDisplay.text.readFailed') : displayText('toolDisplay.text.readDone')
            summaryHtml = `<span class="op-source">${escapeHtml(readState)}</span><span class="op-file">${escapeHtml(label)}</span>${count ? ` <span class="op-source">${escapeHtml(displayCount('toolDisplay.text.itemsShort', count))}</span>` : ''}`
            const rows = items.map(item => {
              const status = item.success ? 'ok' : (item.error || 'failed')
              return `${status} ${item.label || item.path}`
            }).join('\n')
            detailHtml = result.error || result.success === false
              ? asPre(formatPathFailureDetail(result) || result.error || 'Tool failed', 'tool-error')
              : asPre(rows || displayText('toolDisplay.text.readManyDone'))
            break
          }
          if (name === 'get_latest_change_session' || name === 'get_change_session') {
            const session = result.session || result.changeSession || result.latest || result
            const files = Array.isArray(session.files) ? session.files : Array.isArray(result.files) ? result.files : []
            const count = files.length || Number(session.file_count || session.fileCount || 0) || 0
            summaryHtml = `<span class="op-file">${escapeHtml(displayText('toolDisplay.text.recentChanges'))}</span>${count ? ` <span class="op-source">${escapeHtml(displayCount('toolDisplay.text.files', count))}</span>` : ''}`
            detailHtml = result.error || result.success === false
              ? asPre(formatPathFailureDetail(result) || result.error || 'Tool failed', 'tool-error')
              : asPre(result.message || session.title || displayText('toolDisplay.text.recentChangesRead', { count }))
            break
          }
          const displayName = getFileName(filePath)
          const explicitStart = args.start_line ?? args.startLine ?? result.start_line ?? result.startLine
          const explicitEnd = args.end_line ?? args.endLine ?? result.end_line ?? result.endLine
          const offsetStart = parseInt(args.offset || 1, 10)
          const offsetEnd = args.limit ? offsetStart + parseInt(args.limit, 10) : ''
          const lineInfo = explicitStart || explicitEnd
            ? `:${explicitStart || 1}-${explicitEnd || '?'}`
            : (args.limit ? `:${offsetStart}-${offsetEnd}` : '')
          const readState = result.error || result.success === false ? displayText('toolDisplay.text.readFailed') : ''
          summaryHtml = `${readState ? `<span class="op-source">${readState}</span>` : ''}<span class="op-file" data-path="${escapeHtml(fullFilePath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(displayName)}</span>${lineInfo}`
          detailHtml = buildResultDetail(result, '')
          break
        }
        case 'write': {
          if (name === 'copy_file') {
            const displayName = getFileName(result.destination || args.destination || args.to || '')
            const fullTargetPath = result.destination || getFullFilePath(args.destination || args.to || '')
            summaryHtml = `<span class="op-file" data-path="${escapeHtml(fullTargetPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(displayName)}</span>`
            detailHtml = result.error || result.success === false
              ? asPre(formatPathFailureDetail(result) || result.error || 'Tool failed', 'tool-error')
              : asPre(result.message || '')
            break
          }
          summaryHtml = renderWriteSummaryHtml(name, args, result)
          detailHtml = buildWriteDetailHtml(name, args, result)
          break
        }
        case 'edit': {
          if (name === 'move_file') {
            const displayName = getFileName(result.destination || args.destination || args.to || '')
            const fullTargetPath = result.destination || getFullFilePath(args.destination || args.to || '')
            summaryHtml = `<span class="op-file" data-path="${escapeHtml(fullTargetPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(displayName)}</span>`
            detailHtml = result.error || result.success === false
              ? asPre(formatPathFailureDetail(result) || result.error || 'Tool failed', 'tool-error')
              : asPre(result.message || '')
            break
          }
          if (name === 'apply_patch') {
            const edits = mergeEditRowsByPath(getToolFileEdits(name, args, result))
            const total = edits.reduce((acc, item) => ({ add: acc.add + (Number(item.add) || 0), remove: acc.remove + (Number(item.remove) || 0) }), { add: 0, remove: 0 })
            const statsHtml = renderEditStats(total)
            summaryHtml = edits.length === 1
              ? `<span class="op-file" data-path="${escapeHtml(getFullFilePath(edits[0].path || ''))}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(edits[0].label || edits[0].path || displayText('toolDisplay.text.file'))}</span>${statsHtml ? ` ${statsHtml}` : ''}`
              : `<span class="op-file">${escapeHtml(displayCount('toolDisplay.text.files', edits.length || 0))}</span>${statsHtml ? ` ${statsHtml}` : ''}`
            const patchSnippets = parsePatchFileSnippets(args.patch || '')
            detailHtml = result.error || result.success === false
              ? asPre(result.error || 'Patch failed', 'tool-error')
              : (edits.length === 1
                  ? renderInlineDiffSnippet(patchSnippets.get(edits[0].path || '')?.oldText || '', patchSnippets.get(edits[0].path || '')?.newText || '') || asPre(result.message || displayText('toolDisplay.text.patchApplied'))
                  : (edits.length ? renderToolEditFileRows(edits, patchSnippets) : asPre(result.message || displayText('toolDisplay.text.patchApplied'))))
            break
          }
          if (name === 'json_edit') {
            const targetPath = result.path || args.path || ''
            const displayName = getFileName(targetPath)
            const fullTargetPath = result.path || getFullFilePath(args.path || '')
            summaryHtml = `<span class="op-file" data-path="${escapeHtml(fullTargetPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(displayName)}</span> <span class="op-source">${escapeHtml(displayCount('toolDisplay.text.operations', result.operation_count || args.operations?.length || 0))}</span>`
            const rows = Array.isArray(result.operations)
              ? result.operations.map(item => `${item.op || ''} ${item.json_path || ''}${item.skipped ? ` (${item.reason || 'skipped'})` : ''}`).join('\n')
              : Array.isArray(args.operations)
                ? args.operations.map(item => `${item.op || ''} ${item.json_path || item.path || ''}`).join('\n')
                : ''
            detailHtml = result.error || result.success === false
              ? asPre(formatPathFailureDetail(result) || result.error || 'JSON edit failed', 'tool-error')
              : asPre(rows || result.message || displayText('toolDisplay.text.jsonUpdated'))
            break
          }
          if (name === 'text_edit') {
            const edits = mergeEditRowsByPath(getToolFileEdits(name, args, result))
            const total = edits.reduce((acc, item) => ({ add: acc.add + (Number(item.add) || 0), remove: acc.remove + (Number(item.remove) || 0) }), { add: 0, remove: 0 })
            const statsHtml = renderEditStats(total)
            summaryHtml = edits.length === 1
              ? `<span class="op-file" data-path="${escapeHtml(getFullFilePath(edits[0].path || ''))}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(edits[0].label || edits[0].path || displayText('toolDisplay.text.file'))}</span>${statsHtml ? ` ${statsHtml}` : ''}`
              : `<span class="op-file">${escapeHtml(displayCount('toolDisplay.text.files', edits.length || 0))}</span>${statsHtml ? ` ${statsHtml}` : ''}`
            const textEditSnippets = new Map()
            if (edits.length) {
              const snippet = collectTextEditDiffSnippet(args)
              if (snippet.oldText || snippet.newText) {
                textEditSnippets.set(edits[0].path || '', snippet)
              }
            }
            detailHtml = result.error || result.success === false
              ? asPre(formatPathFailureDetail(result) || result.error || 'Text edit failed', 'tool-error')
              : (edits.length === 1
                  ? renderInlineDiffSnippet(textEditSnippets.get(edits[0].path || '')?.oldText || '', textEditSnippets.get(edits[0].path || '')?.newText || '') || renderToolEditFileRows(edits, textEditSnippets)
                  : renderToolEditFileRows(edits, textEditSnippets))
            break
          }
          const displayName = getFileName(filePath)
          const oldStr = getEditOldContent(args)
          const newStr = getEditNewContent(args)
          const lines = calculateEditLines(oldStr, newStr)
          const addText = lines.add > 0 ? `<span class="op-add">+${renderDiffNumber(lines.add, 'up')}</span>` : ''
          const removeText = lines.remove > 0 ? `<span class="op-remove">-${renderDiffNumber(lines.remove, 'down')}</span>` : ''
          summaryHtml = `<span class="op-file" data-path="${escapeHtml(fullFilePath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(displayName)}</span> ${addText} ${removeText}`
          detailHtml = result.error || result.success === false
            ? asPre(formatPathFailureDetail(result) || result.error || 'Tool failed', 'tool-error')
            : renderInlineDiffSnippet(oldStr, newStr)
          break
        }
        case 'folder':
        case 'list': {
          const folderPath = args.path || args.folder_path || ''
          const folderName = getFileName(folderPath) || displayText('toolDisplay.text.projectDirectory')
          summaryHtml = `<span class="op-file">${escapeHtml(folderName)}</span>`
          detailHtml = result.error || result.success === false
            ? asPre(formatPathFailureDetail(result) || result.error || 'Tool failed', 'tool-error')
            : asPre(formatFileList(result.files, type === 'list' ? 80 : 50) || result.message || displayCount('toolDisplay.text.items', result.count || 0))
          break
        }
        case 'bash': {
          const cmd = args.command || result.command || ''
          summaryHtml = escapeHtml(cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd)
          detailHtml = buildBashDetailHtml(args, result)
          break
        }
        case 'grep': {
          const pattern = args.pattern || args.query || args.q || args.regex || result.query || ''
          const count = result.count || result.matches?.length || 0
          summaryHtml = pattern
            ? `<span class="op-file">${escapeHtml(pattern)}</span>${count ? ` <span class="op-source">${escapeHtml(displayCount('toolDisplay.text.matches', count))}</span>` : ''}`
            : `<span class="op-source">${count ? escapeHtml(displayCount('toolDisplay.text.results', count)) : escapeHtml(displayText('toolDisplay.text.findDone'))}</span>`
          detailHtml = result.error
            ? asPre(result.error, 'tool-error')
            : asPre(formatMatches(result.matches, 20) || displayText('toolDisplay.text.findDone'))
          break
        }
        case 'glob': {
          const pattern = args.pattern || args.query || args.q || result.query || ''
          const files = Array.isArray(result.files) ? result.files : []
          summaryHtml = pattern
            ? `<span class="op-file">${escapeHtml(pattern)}</span>${files.length ? ` <span class="op-source">${escapeHtml(displayCount('toolDisplay.text.files', files.length))}</span>` : ''}`
            : `<span class="op-source">${files.length ? escapeHtml(displayCount('toolDisplay.text.files', files.length)) : escapeHtml(displayText('toolDisplay.text.findDone'))}</span>`
          detailHtml = result.error
            ? asPre(result.error, 'tool-error')
            : asPre(formatFileList(files, 50) || displayText('toolDisplay.text.findDone'))
          break
        }
        case 'browser': {
          toolNameCn = getWebToolLabel(name, args, result)
          if (name === 'ui_interaction_check') {
            const target = args.html_path || args.url || result.url || displayText('toolDisplay.text.interface')
            const hit = isRuntimeErrorCaptureHit(name, result)
            const statusText = hit
              ? displayText('toolDisplay.text.runtimeErrorCaptured')
              : (result.success === false ? displayText('toolDisplay.text.fail') : displayText('toolDisplay.text.pass'))
            summaryHtml = `<span class="op-file">${escapeHtml(String(target).substring(0, 80))}</span> <span class="op-source">${escapeHtml(statusText)}</span>`
            detailHtml = hit
              ? formatRuntimeErrorCaptureDetail(result)
              : (result.error || result.success === false
                  ? asPre(formatPathFailureDetail(result) || result.error || result.message || 'UI interaction check failed', 'tool-error')
                  : asPre(result.message || displayText('toolDisplay.text.uiCheckPass')))
            break
          }
          if (name === 'ui_smoke_check') {
            const target = args.html_path || args.url || result.url || displayText('toolDisplay.text.interface')
            const checks = [
              result.expectedText ? `${displayText('toolDisplay.text.expectedText')} ${result.expectedTextFound ? displayText('toolDisplay.text.found') : displayText('toolDisplay.text.notFound')} ${result.expectedText}` : '',
              result.pageState?.bodyTextLength !== undefined ? `${displayText('toolDisplay.text.bodyLength')} ${result.pageState.bodyTextLength}` : '',
              Array.isArray(result.failures) && result.failures.length ? `${displayText('toolDisplay.text.failures')} ${result.failures.join(', ')}` : '',
              Array.isArray(result.consoleErrors) && result.consoleErrors.length ? `${displayText('toolDisplay.text.consoleErrors')} ${result.consoleErrors.length}` : ''
            ].filter(Boolean).join('\n')
            summaryHtml = `<span class="op-file">${escapeHtml(String(target).substring(0, 80))}</span> <span class="op-source">${escapeHtml(result.success === false ? displayText('toolDisplay.text.fail') : displayText('toolDisplay.text.pass'))}</span>`
            detailHtml = result.error || result.success === false
              ? asPre(formatPathFailureDetail(result) || [result.error || result.message || 'UI smoke check failed', checks].filter(Boolean).join('\n'), 'tool-error')
              : asPre(checks || result.message || displayText('toolDisplay.text.uiCheckPass'))
            break
          }
          summaryHtml = buildWebSummary(getWebTarget(args, result))
          detailHtml = buildResultDetail(result, displayText('toolDisplay.text.visitDone'))
          break
        }
        case 'recall_history': {
          const query = args.query || ''
          const count = result.results?.length || 0
          summaryHtml = escapeHtml(displayText('toolDisplay.text.historyArrow', { query, count }))
          const rows = Array.isArray(result.results)
            ? result.results.map(item => `${item.role || 'history'}: ${String(item.content || '').substring(0, 100)}`).join('\n')
            : ''
          detailHtml = result.error ? asPre(result.error, 'tool-error') : asPre(rows || displayText('toolDisplay.text.queryDone'))
          break
        }
        case 'image':
        case 'capture_screenshot':
        case 'vision': {
          const isScreenshot = name === 'capture_screenshot'
          const isGeneratedImage = name === 'generate_image'
          const outputPath = result.path || args.path || args.output_path || result.outputPath || ''
          const displayName = getFileName(outputPath) || (type === 'vision' ? displayText('toolDisplay.text.image') : isScreenshot ? displayText('toolDisplay.text.screenshot') : displayText('toolDisplay.text.imageAsset'))
          const fullOutputPath = getFullFilePath(outputPath)
          const preview = result.thumbnailDataUrl
            ? `<button class="tool-image-preview${type === 'vision' ? ' compact' : ''}" type="button" data-path="${escapeHtml(fullOutputPath)}" onclick="event.stopPropagation();openImagePreviewFromData(this)" title="${escapeHtml(displayText('toolDisplay.text.openOriginalImage'))}"><img src="${escapeHtml(result.thumbnailDataUrl)}" alt="${escapeHtml(displayName)}"></button>`
            : ''
          summaryHtml = (isScreenshot || isGeneratedImage) && preview
            ? `<span class="tool-card-summary-shot">${preview}</span>`
            : isScreenshot
              ? `<span class="op-file" data-path="${escapeHtml(fullOutputPath)}" onclick="event.stopPropagation();openImagePreviewFromData(this)">${escapeHtml(displayText('toolDisplay.text.screenshotPreview'))}</span>`
              : `<span class="op-file" data-path="${escapeHtml(fullOutputPath)}" onclick="event.stopPropagation();openImagePreviewFromData(this)">${escapeHtml(displayName)}</span>`
          const completedStage = buildCompletedMediaStage(name, type, args, result)
          detailHtml = result.error
            ? asPre(result.error, 'tool-error')
            : [
              completedStage || preview,
              asPre([
                result.message || (type === 'vision' ? displayText('toolDisplay.text.visionDone') : isScreenshot ? displayText('toolDisplay.text.screenshotDone') : displayText('toolDisplay.text.imageDone')),
                result.modelName ? `${displayText('toolDisplay.text.model')} ${result.modelName}` : '',
                isGeneratedImage && (result.prompt || args.prompt) ? `Prompt: ${result.prompt || args.prompt}` : '',
                result.summary ? `${displayText('toolDisplay.text.analysis')}\n${result.summary}` : '',
                result.status === 'user_rejected' ? displayText('toolDisplay.text.visionRejected') : '',
                result.format ? `${displayText('toolDisplay.text.format')} ${result.format}` : '',
                result.width && result.height ? `${displayText('toolDisplay.text.size')} ${result.width}x${result.height}` : '',
                result.sourcePath ? `SVG: ${result.sourcePath}` : '',
                result.outputPath ? `${displayText('toolDisplay.text.output')} ${result.outputPath}` : '',
                result.path ? `${displayText('toolDisplay.text.path')} ${result.path}` : ''
              ].filter(Boolean).join('\n\n'))
            ].filter(Boolean).join('')
          break
        }
        case 'music': {
          const projectId = result.projectId || args.projectId || ''
          const scene = result.scene || {}
          const mediaPath = result.path || ''
          const fullMediaPath = getFullFilePath(mediaPath)
          summaryHtml = mediaPath
            ? `<span class="op-file" data-path="${escapeHtml(fullMediaPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(getFileName(mediaPath) || getToolLabel('generate_music', 'music'))}</span>`
            : `<span class="op-file" onclick="event.stopPropagation();openAgentMusicStudioFromTool('${escapeHtml(projectId)}')">${escapeHtml(getToolLabel('music_open', 'music'))}</span>`
          const completedStage = buildCompletedMediaStage(name, type, args, result)
          detailHtml = result.error
            ? asPre(result.error, 'tool-error')
            : `${completedStage}${asPre([
              result.kind === 'generated_music' ? displayText('toolDisplay.text.musicGenerated') : '',
              scene.style ? `${displayText('toolDisplay.text.style')} ${scene.style}` : '',
              scene.bpm ? `${displayText('toolDisplay.text.bpm')} ${scene.bpm}` : '',
              scene.scale ? `${displayText('toolDisplay.text.scale')} ${scene.scale}` : '',
              result.modelName ? `${displayText('toolDisplay.text.model')} ${result.modelName}` : '',
              result.format ? `${displayText('toolDisplay.text.format')} ${result.format}` : '',
              result.outputFormat ? `${displayText('toolDisplay.text.returned')} ${result.outputFormat}` : '',
              Array.isArray(result.instruments) ? `${displayText('toolDisplay.text.instruments')} ${result.instruments.map(item => item.name || item.id).join('，')}` : '',
              Array.isArray(scene.tracks) ? `${displayText('toolDisplay.text.tracks')} ${scene.tracks.map(t => `${t.name || t.id}:${t.activeSteps}`).join('，')}` : '',
              result.path ? `${displayText('toolDisplay.text.saved')} ${result.path}` : '',
              result.message || displayText('toolDisplay.text.reopenMusic')
            ].filter(Boolean).join('\n'))}`
          break
        }
        case 'video': {
          const mediaPath = result.path || ''
          const fullMediaPath = getFullFilePath(mediaPath)
          summaryHtml = mediaPath
            ? `<span class="op-file" data-path="${escapeHtml(fullMediaPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(getFileName(mediaPath) || getToolLabel('generate_video', 'video'))}</span>`
            : `<span class="op-file">${escapeHtml(result.taskId || getToolLabel('generate_video', 'video'))}</span>`
          const completedStage = buildCompletedMediaStage(name, type, args, result)
          detailHtml = result.error
            ? asPre(result.error, 'tool-error')
            : `${completedStage}${asPre([
              displayText('toolDisplay.text.videoGenerated'),
              result.modelName ? `${displayText('toolDisplay.text.model')} ${result.modelName}` : '',
              result.taskId ? `${displayText('toolDisplay.text.task')} ${result.taskId}` : '',
              result.fileId ? `${displayText('toolDisplay.text.fileId')} ${result.fileId}` : '',
              result.format ? `${displayText('toolDisplay.text.format')} ${result.format}` : '',
              result.path ? `${displayText('toolDisplay.text.saved')} ${result.path}` : '',
              result.message || ''
            ].filter(Boolean).join('\n'))}`
          break
        }
        default: {
          summaryHtml = escapeHtml(name)
          detailHtml = result.error
            ? asPre(result.error, 'tool-error')
            : asPre(result.message || JSON.stringify(result).substring(0, 500))
        }
      }

      return { type, toolNameCn, summaryHtml, detailHtml, fullFilePath }
    }

    function findToolHostSegment(dynamicArea, meta = {}) {
      if (!dynamicArea) return null
      const segments = [...dynamicArea.querySelectorAll('.ai-work-segment')]
      if (meta.agentRole) {
        for (let i = segments.length - 1; i >= 0; i--) {
          const block = segments[i].querySelector('.ai-thinking-block')
          if ((block?.dataset.agentRole || '') === meta.agentRole && block.dataset.thinkingKind !== 'reasoning') return segments[i]
        }
      }
      for (let i = segments.length - 1; i >= 0; i--) {
        const block = segments[i].querySelector('.ai-thinking-block')
        if (!block || block.dataset.thinkingKind !== 'reasoning') return segments[i]
      }
      return null
    }

    function createToolGroup(dynamicArea, meta = {}) {
      if (!dynamicArea) return null
      dynamicArea.querySelectorAll('.tool-call-group[data-active="true"]').forEach(group => {
        group.dataset.active = 'false'
      })

      const latestSegment = findToolHostSegment(dynamicArea, meta)
      let hostEl = latestSegment
      if (!hostEl || latestSegment.querySelector('.tool-call-group')) {
        hostEl = document.createElement('div')
        hostEl.className = 'ai-work-segment'
        dynamicArea.appendChild(hostEl)
      }

      const group = document.createElement('div')
      group.className = 'tool-call-group'
      group.dataset.active = 'true'
      group.innerHTML = `
        <div class="tool-group-header" onclick="toggleToolGroup(this)">
          <span class="tool-group-current"></span>
          <span class="tool-card-toggle"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg></span>
        </div>
        <div class="tool-group-list collapsed"></div>
      `
      hostEl.appendChild(group)
      currentToolGroup = group
      return group
    }

    function startToolGroup() {
      const currentAiMsg = getCurrentAiMsg()
      if (!currentAiMsg) return null
      const dynamicArea = currentAiMsg.querySelector('.ai-dynamic-area')
      if (!dynamicArea) return null
      dynamicArea.querySelectorAll('.tool-call-group[data-active="true"]').forEach(group => {
        group.dataset.active = 'false'
      })
      currentToolGroup = null
      return null
    }

    function markMediaGroup(group) {
      if (!group) return
      group.classList.add('tool-media-group')
      if (!group.querySelector(':scope > .tool-media-timeline')) {
        const timeline = document.createElement('span')
        timeline.className = 'tool-media-timeline'
        timeline.setAttribute('aria-hidden', 'true')
        const list = group.querySelector(':scope > .tool-group-list')
        group.insertBefore(timeline, list || null)
      }
      const list = group.querySelector(':scope > .tool-group-list')
      if (list) {
        const userCollapsed = group.dataset.mediaCollapsed === 'true'
        list.classList.toggle('collapsed', userCollapsed)
        group.classList.toggle('media-collapsed', userCollapsed)
        group.querySelector(':scope > .tool-group-header')?.setAttribute('aria-expanded', userCollapsed ? 'false' : 'true')
        list.style.setProperty('height', 'auto')
        list.style.setProperty('min-height', '0')
        list.style.setProperty('max-height', 'none', 'important')
        list.style.setProperty('margin', '0', 'important')
        list.style.setProperty('padding', '2px 0 0 6px', 'important')
        list.style.setProperty('border-top', '0', 'important')
        list.style.setProperty('opacity', '1')
        list.style.setProperty('overflow', 'visible')
      }
    }

    function normalizeMediaCardLayout(card) {
      if (!card?.classList.contains('tool-media-card')) return
      card.style.setProperty('display', 'block')
      card.style.setProperty('width', '100%')
      card.style.setProperty('height', 'auto')
      card.style.setProperty('min-height', '0')
      card.style.setProperty('margin', '0')
      card.style.setProperty('padding', '0')
      card.style.setProperty('border', '0', 'important')
      card.style.setProperty('box-shadow', 'none', 'important')
      const header = card.querySelector(':scope > .tool-card-header')
      if (header) {
        header.style.setProperty('display', 'none', 'important')
        header.style.setProperty('height', '0', 'important')
        header.style.setProperty('margin', '0', 'important')
        header.style.setProperty('padding', '0', 'important')
      }
      const detail = card.querySelector(':scope > .tool-card-detail')
      if (detail) {
        detail.classList.add('tool-media-stage-detail')
        detail.classList.remove('collapsed')
        detail.style.setProperty('display', 'block')
        detail.style.setProperty('height', 'auto')
        detail.style.setProperty('min-height', '0')
        detail.style.setProperty('max-height', 'none', 'important')
        detail.style.setProperty('margin', '0', 'important')
        detail.style.setProperty('padding', '0', 'important')
        detail.style.setProperty('border', '0', 'important')
        detail.style.setProperty('box-shadow', 'none', 'important')
        detail.style.setProperty('transform', 'none', 'important')
        // 覆盖全局 pre-wrap，避免模板空白变成上下大块空隙
        detail.style.setProperty('white-space', 'normal', 'important')
        // 清掉可能残留的空白文本节点（pre-wrap 遗留的主要元凶）
        ;[...detail.childNodes].forEach(node => {
          if (node.nodeType === 3 && !String(node.textContent || '').trim()) {
            node.remove()
          }
        })
      }
    }

    function resetNonMediaCardLayout(card) {
      if (!card) return
      card.classList.remove('tool-media-card')
      ;['display', 'width', 'height', 'min-height', 'margin', 'padding', 'border', 'box-shadow'].forEach(property => {
        card.style.removeProperty(property)
      })

      const header = card.querySelector(':scope > .tool-card-header')
      ;['display', 'height', 'margin', 'padding'].forEach(property => {
        header?.style.removeProperty(property)
      })

      const detail = card.querySelector(':scope > .tool-card-detail')
      detail?.classList.remove('tool-media-stage-detail')
      ;['display', 'height', 'min-height', 'max-height', 'margin', 'padding', 'border', 'box-shadow', 'transform', 'white-space'].forEach(property => {
        detail?.style.removeProperty(property)
      })
    }

    function ensureToolGroup(dynamicArea, meta = {}) {
      const latestSegment = findToolHostSegment(dynamicArea, meta)
      const latestGroup = latestSegment?.querySelector('.tool-call-group')
      if (latestGroup && !latestGroup.classList.contains('tool-media-group')) {
        dynamicArea.querySelectorAll('.tool-call-group[data-active="true"]').forEach(group => {
          if (group !== latestGroup) group.dataset.active = 'false'
        })
        latestGroup.dataset.active = 'true'
        currentToolGroup = latestGroup
        return latestGroup
      }
      return createToolGroup(dynamicArea, meta)
    }

    function updateGroupCount(group) {
      if (!group) return
      const listEl = group.querySelector('.tool-group-list')
      if (!listEl) return
      group.dataset.hasError = listEl.querySelector('.tool-call-card.error') ? 'true' : 'false'

      // 已移除「全部展开/全部收起」入口与逻辑；保留历史残留节点清理
      const header = group.querySelector('.tool-group-header')
      header?.querySelector('.tool-group-expand-all')?.remove()
    }

    function buildGroupBriefFromCards(cards = []) {
      const counts = { edit: 0, write: 0, bash: 0, read: 0, search: 0, other: 0 }
      cards.forEach(card => {
        const type = card.dataset.toolType || ''
        if (type === 'edit') counts.edit += 1
        else if (type === 'write') counts.write += 1
        else if (type === 'bash') counts.bash += 1
        else if (type === 'read') counts.read += 1
        else if (type === 'grep' || type === 'glob' || type === 'search') counts.search += 1
        else counts.other += 1
      })

      const parts = []
      const edited = counts.edit + counts.write
      if (edited) parts.push(displayText('toolDisplay.summary.editedFiles', { count: edited }))
      if (counts.bash) parts.push(displayText('toolDisplay.summary.ranCommands', { count: counts.bash }))
      if (!parts.length && counts.read) parts.push(displayText('toolDisplay.summary.readFiles', { count: counts.read }))
      if (!parts.length && counts.search) parts.push(displayText('toolDisplay.summary.searchedTimes', { count: counts.search }))
      const total = cards.length
      if (!parts.length && total) parts.push(displayText('toolDisplay.summary.completedOps', { count: total }))
      return parts.join('')
    }

    function getToolLogIcon(type = '') {
      if (type === 'runtime-diagnostic') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><circle cx="12" cy="12" r="5"/><path d="m15.5 8.5-7 7"/><path d="M9 9h.01"/><path d="M15 15h.01"/></svg>'
      }
      if (type === 'bash') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="m8 9 3 3-3 3"/><path d="M13 15h4"/></svg>'
      }
      if (type === 'read') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>'
      }
      if (type === 'grep' || type === 'glob' || type === 'search' || type === 'browser') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 3.5 3.5"/></svg>'
      }
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
    }

    function getDominantToolType(cards = []) {
      const preferred = ['edit', 'write', 'bash', 'read', 'grep', 'glob', 'search']
      for (const type of preferred) {
        if (cards.some(card => card.dataset.toolType === type)) return type
      }
      return cards[0]?.dataset.toolType || ''
    }

    function buildGroupBriefHtml(text = '') {
      const value = String(text || '').trim()
      if (!value) return ''
      return `<span class="tool-log-icon">${getToolLogIcon('edit')}</span><span class="tool-log-text">${escapeHtml(value)}</span>`
    }

    function getOperationVerb(type, pending = false) {
      return ToolDisplay.getOperationVerb ? ToolDisplay.getOperationVerb(type, pending) : displayText('toolDisplay.verb.done.default')
    }

    function buildToolCurrentHtml(toolNameCn, summaryHtml = '', type = '') {
      const iconPart = type ? `<span class="tool-card-icon">${getToolLogIcon(type)}</span>` : ''
      const summaryPart = summaryHtml
        ? `<span class="tool-card-summary">${summaryHtml}</span>`
        : ''
      return `${iconPart}<span class="tool-card-tool">${toolNameCn}</span>${summaryPart}`
    }

    function updateGroupCurrent(group, fallbackHtml = '') {
      if (!group) return
      const currentEl = group.querySelector('.tool-group-current')
      const listEl = group.querySelector('.tool-group-list')
      if (!currentEl || !listEl) return
      const cards = [...listEl.querySelectorAll('.tool-call-card')]
      if (!cards.length) {
        currentEl.innerHTML = fallbackHtml
        return
      }
      currentEl.innerHTML = buildGroupCurrentAggHtml(cards)
    }
    function buildGroupCurrentAggHtml(cards = []) {
      const completed = cards.filter(card => !card.classList.contains('pending'))
      if (!completed.length) return ''

      const getCardSummary = card => card.querySelector('.tool-card-summary')?.innerHTML || ''
      const getCardToolName = card => card.querySelector('.tool-card-tool')?.textContent || ''
      const getCardType = card => card.dataset.diagnosticHit === 'true' ? 'runtime-diagnostic' : (card.dataset.toolType || '')
      const iconHtml = type => `<span class="tool-card-icon">${getToolLogIcon(type || 'step')}</span>`
      const normalizeType = type => (type === 'grep' || type === 'search' ? 'search' : (type || 'default'))
      const buildAggregateBlock = type => {
        const normalizedType = normalizeType(type)
        const summary = ToolDisplay.getAggregateSummary
          ? ToolDisplay.getAggregateSummary(normalizedType)
          : displayText('toolDisplay.aggregate.default')
        return `<span class="tool-agg-block">${iconHtml(normalizedType)}<span class="tool-agg-text">${escapeHtml(summary)}</span></span>`
      }

      // 单卡：直接复用该卡的完整展示
      if (completed.length === 1) {
        const card = completed[0]
        return buildToolCurrentHtml(getCardToolName(card), getCardSummary(card), getCardType(card))
      }

      // 按类型分组
      const buckets = new Map()
      completed.forEach(card => {
        const t = getCardType(card) || 'step'
        if (!buckets.has(t)) buckets.set(t, [])
        buckets.get(t).push(card)
      })

      // 同类多次：显示操作摘要，避免无上下文的数字徽章
      if (buckets.size === 1) {
        const [type] = [...buckets.keys()]
        return buildAggregateBlock(type)
      }

      // 混合类型：按动作类型并列展示，不重复计数
      const aggregateTypes = []
      completed.forEach(card => {
        const type = normalizeType(getCardType(card))
        if (!aggregateTypes.includes(type)) aggregateTypes.push(type)
      })
      return aggregateTypes.map(buildAggregateBlock).join('<span class="tool-agg-sep">，</span>')
    }

    function buildPendingSummary(name, args = {}) {
      const type = getToolType(name)
      const filePath = args.file_path || args.path || ''
      const fileName = getFileName(filePath)
      switch (type) {
        case 'write': {
          return `<span class="op-file">${escapeHtml(fileName)}</span>`
        }
        case 'edit':
          {
            if (name === 'apply_patch' || name === 'text_edit') {
              const edits = mergeEditRowsByPath(getToolFileEdits(name, args, {}))
              const total = edits.reduce((acc, item) => ({ add: acc.add + (Number(item.add) || 0), remove: acc.remove + (Number(item.remove) || 0) }), { add: 0, remove: 0 })
              const statsHtml = renderEditStats(total)
              if (edits.length === 1) {
                return `<span class="op-file">${escapeHtml(edits[0].label || edits[0].path || displayText('toolDisplay.text.file'))}</span>${statsHtml ? ` ${statsHtml}` : ''}`
              }
              if (edits.length > 1) return `<span class="op-file">${escapeHtml(displayCount('toolDisplay.text.files', edits.length))}</span>`
            }
            const oldStr = getEditOldContent(args)
            const newStr = getEditNewContent(args)
            const lines = calculateEditLines(oldStr, newStr)
            const addText = lines.add > 0 ? `<span class="op-add">+${renderDiffNumber(lines.add, 'up')}</span>` : ''
            const removeText = lines.remove > 0 ? `<span class="op-remove">-${renderDiffNumber(lines.remove, 'down')}</span>` : ''
            return `<span class="op-file">${escapeHtml(fileName)}</span> ${addText} ${removeText}`.trim()
          }
        case 'read':
          {
            const label = name === 'read_many_files'
              ? buildReadManyTargetSummary(args, {})
              : `${fileName || filePath || displayText('toolDisplay.text.file')}${getReadRangeSuffix(args, {})}`
            return `<span class="op-file">${escapeHtml(label)}</span>`
          }
        case 'bash':
          return `<span class="op-pending">${escapeHtml(String(args.command || '').substring(0, 60))}</span>`
        case 'grep':
        case 'glob':
        case 'search':
          {
            const query = args.pattern || args.query || args.q || args.command || ''
            return `<span class="op-file">${escapeHtml(String(query || '').substring(0, 50))}</span>`
          }
        case 'image':
          return ''
        case 'vision':
          return ''
        case 'music':
          return pendingHtmlFor(name, type)
        default:
          return pendingHtmlFor(name, type)
      }
    }

    function preShowOperation(name, args = {}, meta = {}) {
      if (shouldHideToolCard(name)) return null
      const currentAiMsg = getCurrentAiMsg()
      if (!currentAiMsg) return null
      const dynamicArea = currentAiMsg.querySelector('.ai-dynamic-area')
      if (!dynamicArea) return null

      if (meta.toolCallId) {
        const existing = pendingToolCards.find(item =>
          item.toolCallId === meta.toolCallId &&
          item.card &&
          document.contains(item.card)
        )
        if (existing) {
          existing.name = name || existing.name
          existing.args = { ...(existing.args || {}), ...(args || {}) }
          existing.argsKey = stableArgsKey(existing.args)
          const summaryEl = existing.card.querySelector('.tool-card-summary')
          if (summaryEl) summaryEl.innerHTML = buildPendingSummary(existing.name, existing.args)
          setToolCardMeta(existing.card, existing.name, getToolType(existing.name), existing.args, {}, summaryEl?.innerHTML || '')
          return existing.card
        }
      }

      const type = getToolType(name)
      const displayToolName = type === 'browser' ? getWebToolLabel(name, args, {}) : getToolLabel(name, type)
      const preSummary = buildPendingSummary(name, args)
      const mediaStageKind = getMediaStageKind(name, type)
      const group = mediaStageKind ? createToolGroup(dynamicArea, meta) : ensureToolGroup(dynamicArea, meta)
      if (!group) return null

      const currentEl = group.querySelector('.tool-group-current')
      const existingCards = [...(group.querySelector('.tool-group-list')?.querySelectorAll('.tool-call-card') || [])]
      const aggHtml = buildGroupCurrentAggHtml(existingCards)
      if (currentEl) {
        currentEl.innerHTML = aggHtml || buildToolCurrentHtml(displayToolName, preSummary, type)
      }
      group.querySelectorAll('.tool-call-card[data-latest="true"]').forEach(item => {
        item.dataset.latest = 'false'
      })

      const card = document.createElement('div')
      card.className = 'tool-call-card pending'
      card.dataset.latest = 'true'
      setToolCardMeta(card, name, type, args, {}, preSummary)
      const mediaStageHtml = buildPendingMediaStage(name, type, args)
      if (mediaStageHtml) {
        card.classList.add('tool-media-card')
        markMediaGroup(group)
      }
      const pendingDetailHtml = mediaStageHtml || (type === 'edit'
        ? ''
        : `<pre class="tool-pending-text">${escapeHtml(ToolDisplay.getPendingText ? ToolDisplay.getPendingText(name, type) : displayText('toolDisplay.pending.default'))}</pre>`)
      card.innerHTML = `
        <div class="tool-card-header" onclick="toggleToolCard(this)">
          <span class="tool-card-icon">${getToolLogIcon(type)}</span>
          ${buildToolCurrentHtml(displayToolName, preSummary)}
          <span class="tool-card-status"></span>
        </div>
        <div class="tool-card-detail${mediaStageHtml ? ' tool-media-stage-detail' : ' collapsed'}">
          ${pendingDetailHtml}
        </div>
      `
      if (mediaStageHtml) normalizeMediaCardLayout(card)
      const groupList = group.querySelector('.tool-group-list')
      groupList?.appendChild(card)
      if (mediaStageHtml && group.dataset.mediaCollapsed !== 'true') groupList?.classList.remove('collapsed')
      mountPrismAnimations(card)
      updateGroupCount(group)
      pendingToolCards.push({ card, name, args, argsKey: stableArgsKey(args), agentRole: meta.agentRole || '', toolCallId: meta.toolCallId || '', _parseError: meta._parseError || false })
      return card
    }

    function updateStreamingOperation(name, progress = {}, meta = {}) {
      if (shouldHideToolCard(name)) return null
      const toolCallId = meta.toolCallId || progress.toolCallId || ''
      const streamArgs = {
        path: progress.path || '',
        file_path: progress.path || '',
        _streamAddedLines: Math.max(0, Number(progress.addedLines) || 0),
        _streamRemovedLines: Math.max(0, Number(progress.removedLines) || 0),
        _streamReceivedChars: Math.max(0, Number(progress.receivedChars) || 0)
      }
      let pending = toolCallId
        ? pendingToolCards.find(item => item.toolCallId === toolCallId && item.card && document.contains(item.card))
        : null
      if (!pending) {
        const card = preShowOperation(name, streamArgs, { ...meta, toolCallId })
        pending = pendingToolCards.find(item => item.card === card) || null
      }
      if (!pending?.card) return null

      pending.name = name || pending.name
      pending.args = { ...(pending.args || {}), ...streamArgs }
      pending.argsKey = stableArgsKey(pending.args)
      const card = pending.card
      const type = getToolType(pending.name)
      const displayToolName = getToolLabel(pending.name, type)
      const filePath = progress.path || pending.args.path || pending.args.file_path || ''
      const fileName = getFileName(filePath) || filePath || displayText('toolDisplay.text.file')
      const addedLines = Math.max(0, Number(progress.addedLines) || 0)
      const removedLines = Math.max(0, Number(progress.removedLines) || 0)
      const summaryEl = card.querySelector('.tool-card-summary')
      if (summaryEl) {
        let fileEl = summaryEl.querySelector('.op-file')
        if (!fileEl) {
          fileEl = document.createElement('span')
          fileEl.className = 'op-file'
          summaryEl.prepend(fileEl)
        }
        fileEl.textContent = fileName

        let addEl = summaryEl.querySelector('.op-add')
        if (!addEl) {
          addEl = document.createElement('span')
          addEl.className = 'op-add'
          addEl.innerHTML = `+${renderLiveDiffNumber(addedLines)}`
          summaryEl.append(' ', addEl)
        } else {
          updateLiveDiffNumber(addEl.querySelector('.diff-live-number'), addedLines)
        }

        let removeEl = summaryEl.querySelector('.op-remove')
        if (removedLines > 0) {
          if (!removeEl) {
            removeEl = document.createElement('span')
            removeEl.className = 'op-remove'
            removeEl.innerHTML = `-${renderLiveDiffNumber(removedLines)}`
            summaryEl.append(' ', removeEl)
          } else {
            updateLiveDiffNumber(removeEl.querySelector('.diff-live-number'), removedLines)
          }
        } else {
          removeEl?.remove()
        }
      }

      const toolEl = card.querySelector('.tool-card-tool')
      if (toolEl) toolEl.textContent = displayToolName
      setToolCardMeta(card, pending.name, type, pending.args, {}, summaryEl?.innerHTML || '')
      const group = card.closest('.tool-call-group')
      const currentEl = group?.querySelector('.tool-group-current')
      if (currentEl && summaryEl) {
        currentEl.innerHTML = buildToolCurrentHtml(displayToolName, summaryEl.innerHTML, type)
      }
      return card
    }

    function updateOperationResult(card, name, args = {}, result = {}, stats) {
      if (!card) return null
      const { type, toolNameCn, summaryHtml, detailHtml, fullFilePath } = buildOperationContent(name, args, result)
      updateToolStats(stats, type, args, result, fullFilePath)
      card.dataset.toolType = type

      // 状态类名：success / error / 清除 pending
      const isDiagnosticHit = isRuntimeErrorCaptureHit(name, result)
      const isError = !isDiagnosticHit && !!(result.error || result.success === false)
      card.classList.remove('pending')
      card.classList.remove('error', 'success', 'diagnostic-hit')
      card.classList.add(isDiagnosticHit ? 'diagnostic-hit' : isError ? 'error' : 'success')

      const headerEl = card.querySelector('.tool-card-header')
      if (headerEl) {
        const iconEl = headerEl.querySelector('.tool-card-icon')
        if (iconEl) {
          iconEl.classList.remove('loading')
          iconEl.innerHTML = getToolLogIcon(isDiagnosticHit ? 'runtime-diagnostic' : type)
        }
        const toolEl = headerEl.querySelector('.tool-card-tool')
        if (toolEl) toolEl.textContent = toolNameCn
        const summaryEl = headerEl.querySelector('.tool-card-summary')
        if (summaryEl) summaryEl.innerHTML = summaryHtml
        headerEl.querySelector('.tool-card-spinner')?.remove()
        // 替换 spinner 为状态徽章
        if (!headerEl.querySelector('.tool-card-status')) {
          const status = document.createElement('span')
          status.className = 'tool-card-status'
          headerEl.appendChild(status)
        }
        if (!headerEl.querySelector('.tool-card-toggle')) {
          const toggle = document.createElement('span')
          toggle.className = 'tool-card-toggle'
          toggle.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>'
          headerEl.appendChild(toggle)
        }
      }

      const detailEl = card.querySelector('.tool-card-detail')
      if (detailEl) {
        const isMedia = hasMediaStage(detailHtml)
        if (isMedia) {
          detailEl.classList.add('tool-media-stage-detail')
          card.classList.add('tool-media-card')
          markMediaGroup(card.closest('.tool-call-group'))
          if (window.ToolDetailLazy?.stash) {
            window.ToolDetailLazy.stash(detailEl, detailHtml, { media: true })
          } else {
            detailEl.innerHTML = detailHtml
            detailEl.classList.remove('collapsed')
          }
          normalizeMediaCardLayout(card)
          mountPrismAnimations(card)
          card.querySelectorAll('.tool-media-stage').forEach(applyMediaAspectRatio)
        } else if (window.ToolDetailLazy?.stash) {
          resetNonMediaCardLayout(card)
          detailEl.classList.remove('tool-media-stage-detail')
          card.classList.remove('tool-media-card')
          // 折叠态不挂大段详情 HTML；用户展开时再 hydrate
          window.ToolDetailLazy.stash(detailEl, detailHtml)
        } else {
          resetNonMediaCardLayout(card)
          detailEl.classList.remove('tool-media-stage-detail')
          card.classList.remove('tool-media-card')
          detailEl.innerHTML = detailHtml
          detailEl.classList.add('collapsed')
        }
      }

      setToolCardMeta(card, name, type, args, result, summaryHtml)
      const group = card.closest('.tool-call-group')
      updateGroupCount(group)
      if (group) {
        const listEl = group.querySelector('.tool-group-list')
        const allCards = listEl ? [...listEl.querySelectorAll('.tool-call-card')] : []
        const aggHtml = buildGroupCurrentAggHtml(allCards)
        if (aggHtml) {
          const currentEl = group.querySelector('.tool-group-current')
          if (currentEl) currentEl.innerHTML = group.classList.contains('tool-media-group')
            ? buildToolCurrentHtml(toolNameCn, '', type)
            : aggHtml
        }
      }
      return card
    }

    function addOperation(name, args = {}, result = {}, stats, meta = {}) {
      if (shouldHideToolCard(name)) return null
      const currentAiMsg = getCurrentAiMsg()
      if (!currentAiMsg) return null

      const argsKey = stableArgsKey(args)
      let pendingIndex = meta.toolCallId
        ? pendingToolCards.findIndex(item => item.toolCallId === meta.toolCallId && item.card && document.contains(item.card))
        : -1
      if (pendingIndex < 0) {
        pendingIndex = pendingToolCards.findIndex(item =>
          item.name === name &&
          item.argsKey === argsKey &&
          (!meta.agentRole || item.agentRole === meta.agentRole) &&
          item.card &&
          document.contains(item.card)
        )
      }
      if (pendingIndex < 0) {
        pendingIndex = pendingToolCards.findIndex(item =>
          item.name === name &&
          (!meta.agentRole || item.agentRole === meta.agentRole) &&
          item.card &&
          document.contains(item.card)
        )
      }
      if (pendingIndex >= 0) {
        const pending = pendingToolCards.splice(pendingIndex, 1)[0]
        // 将解析错误标记传递到 result 中
        if (pending._parseError) {
          result._parseError = true
        }
        return updateOperationResult(pending.card, name, args, result, stats)
      }

      const dynamicArea = currentAiMsg.querySelector('.ai-dynamic-area')
      if (!dynamicArea) return null

      const { type, toolNameCn, summaryHtml, detailHtml, fullFilePath } = buildOperationContent(name, args, result)
      updateToolStats(stats, type, args, result, fullFilePath)
      const group = getMediaStageKind(name, type) ? createToolGroup(dynamicArea, meta) : ensureToolGroup(dynamicArea, meta)
      if (!group) return null

      const currentEl = group.querySelector('.tool-group-current')
      const currentHtml = buildToolCurrentHtml(toolNameCn, summaryHtml, type)
      if (currentEl) {
        currentEl.innerHTML = currentHtml
      }

      group.querySelectorAll('.tool-call-card[data-latest="true"]').forEach(item => {
        item.dataset.latest = 'false'
      })

      const card = document.createElement('div')
      const isError = !!(result.error || result.success === false)
      card.className = 'tool-call-card ' + (isError ? 'error' : 'success')
      card.dataset.latest = 'true'
      setToolCardMeta(card, name, type, args, result, summaryHtml)
      card.innerHTML = `
        <div class="tool-card-header" onclick="toggleToolCard(this)">
          <span class="tool-card-icon">${getToolLogIcon(type)}</span>
          ${buildToolCurrentHtml(toolNameCn, summaryHtml)}
          <span class="tool-card-status"></span>
          <span class="tool-card-toggle"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg></span>
        </div>
        <div class="tool-card-detail collapsed"></div>
      `
      const detailEl = card.querySelector('.tool-card-detail')
      const isMedia = hasMediaStage(detailHtml)
      if (window.ToolDetailLazy?.stash) {
        window.ToolDetailLazy.stash(detailEl, detailHtml, { media: isMedia })
      } else if (detailEl) {
        detailEl.innerHTML = detailHtml
        if (!isMedia) detailEl.classList.add('collapsed')
      }
      if (isMedia) {
        card.classList.add('tool-media-card')
        markMediaGroup(group)
        normalizeMediaCardLayout(card)
        mountPrismAnimations(card)
        card.querySelectorAll('.tool-media-stage').forEach(applyMediaAspectRatio)
      }
      group.querySelector('.tool-group-list')?.appendChild(card)
      updateGroupCount(group)
      return card
    }

    function addIntermediateContent(content) {
      const currentAiMsg = getCurrentAiMsg()
      if (!currentAiMsg || !content) return null
      const dynamicArea = currentAiMsg.querySelector('.ai-dynamic-area')
      if (!dynamicArea) return null
      const contentBlock = document.createElement('div')
      contentBlock.className = 'intermediate-content-block'
      contentBlock.innerHTML = sanitizeContent(content)
      dynamicArea.appendChild(contentBlock)
      return contentBlock
    }

    return {
      startToolGroup,
      preShowOperation,
      updateStreamingOperation,
      updateOperationResult,
      addOperation,
      addIntermediateContent,
      escapeHtml
    }
  }

  window.AiToolRenderer = { bind }
})()
