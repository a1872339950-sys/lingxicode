const fs = require('fs')
const path = require('path')
const vm = require('vm')

function createClassList(initial = []) {
  const values = new Set(initial)
  return {
    add(...names) { names.forEach(name => values.add(name)) },
    remove(...names) { names.forEach(name => values.delete(name)) },
    toggle(name, force) {
      const next = force === undefined ? !values.has(name) : !!force
      if (next) values.add(name)
      else values.delete(name)
      return next
    },
    contains(name) { return values.has(name) }
  }
}

module.exports = {
  id: 'media-prism-stage-contract',
  title: 'Media and vision tools use the branded prism transition stage',
  tags: ['frontend', 'media', 'vision', 'tool-ui'],
  changedFilePatterns: [
    /^frontend\/scripts\/features\/ai-tool-renderer\.js$/i,
    /^frontend\/styles\/chat\.css$/i,
    /^electron\/modules\/ai-chat\.js$/i
  ],

  async run(ctx) {
    const renderer = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-tool-renderer.js'), 'utf8')
    const messageUi = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-message-ui.js'), 'utf8')
    const styles = fs.readFileSync(path.join(ctx.root, 'frontend/styles/chat.css'), 'utf8')
    const chat = fs.readFileSync(path.join(ctx.root, 'electron/modules/ai-chat.js'), 'utf8')

    ctx.assert.ok(renderer.includes("if (name === 'generate_image') return 'image'"), 'image generation must map to the prism image variant')
    ctx.assert.ok(renderer.includes("if (name === 'generate_video') return 'video'"), 'video generation must map to the prism video variant')
    ctx.assert.ok(renderer.includes("if (name === 'generate_music') return 'music'"), 'music generation must map to the prism music variant')
    ctx.assert.ok(renderer.includes("if (name === 'image_analyze' || name === 'inspect_image' || name === 'view_image' || type === 'vision') return 'vision'"), 'vision tools must map to the prism vision variant')
    ctx.assert.ok(renderer.includes('tool-media-prism-canvas'), 'pending media stage must mount the prism canvas')
    ctx.assert.ok(renderer.includes('lingxi-logo-transparent.png'), 'prism stage must use the real transparent Lingxi logo asset')
    ctx.assert.ok(renderer.includes("groupList?.classList.remove('collapsed')"), 'pending media stage must be visible without an extra expand click')
    ctx.assert.ok(renderer.includes('tool-media-result-video'), 'completed video stage must become a real video player')
    ctx.assert.ok(renderer.includes('tool-media-result-audio'), 'completed music stage must become a real audio player')
    ctx.assert.ok(renderer.includes('tool-media-result-image'), 'completed image and vision stages must become the real image')
    ctx.assert.ok(renderer.includes('onclick="toggleToolGroup(this)"'), 'media stage must reuse the native tool-group expand and collapse interaction')
    ctx.assert.ok(!messageUi.includes("if (group.classList.contains('tool-media-group')) return"), 'media groups must not ignore the native collapse interaction')
    ctx.assert.ok(!renderer.includes('window.toggleMediaStage'), 'media stage must not introduce a second component-level collapse control')
    ctx.assert.ok(styles.includes('.tool-media-group > .tool-group-list'), 'media output must remain inside the native indented tool timeline')
    ctx.assert.ok(styles.includes('display: none !important') && styles.includes('.tool-media-group.media-collapsed'), 'collapsed media must hide without max-height measurement or blank space')
    ctx.assert.ok(styles.includes('.ai-work-segment:has(> .tool-media-group)'), 'media stage host must remove inherited process-segment whitespace')
    ctx.assert.ok(renderer.includes("timeline.className = 'tool-media-timeline'"), 'media timeline must be a real DOM element instead of a fragile pseudo-element')
    ctx.assert.ok(styles.includes('grid-template-columns: 14px minmax(0, 1fr);') && styles.includes('background: color-mix(in srgb, currentColor 28%, transparent);'), 'media timeline must share the deep-reasoning line position and color')
    ctx.assert.ok(
      styles.includes('padding: 2px 0 0 6px') || styles.includes('margin: 2px 0 0;') || styles.includes('padding: 2px 0 0 6px !important'),
      'expanded media content must sit directly below its title with only a small gap'
    )
    ctx.assert.ok(styles.includes('@media (prefers-reduced-motion: reduce)'), 'motion-reduced users must receive a static prism state')
    ctx.assert.ok(styles.includes('--media-stage-max-height') && styles.includes('4 / 3'), 'vision stage must default to 4:3 (not 1:1) with a max height cap')
    ctx.assert.ok(!/is-pending\[data-media-kind="vision"\][^{]*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s.test(styles), 'vision pending must not force 1:1 aspect ratio')
    ctx.assert.ok(styles.includes('var(--media-result-aspect, auto)') || styles.includes('var(--media-result-aspect, 4 / 3)'), 'complete stage must not hard-fallback to 1:1')
    ctx.assert.ok(styles.includes(':not(:has(.tool-media-source))'), 'pending vision without source image must keep a non-square compact ratio')
    ctx.assert.ok(styles.includes('white-space: normal !important') && styles.includes('tool-media-stage-detail'), 'media detail must disable pre-wrap to prevent template whitespace gaps')
    ctx.assert.ok(styles.includes('grid-template-areas') && styles.includes('"rail content"'), 'media group must use explicit grid areas so timeline does not create header-to-thumbnail dead space')
    ctx.assert.ok(styles.includes('object-fit: cover'), 'vision previews must cover the stage to avoid letterbox bars')
    ctx.assert.ok(renderer.includes('resolveVisionSourceUrl') && renderer.includes('dataUrl'), 'pending vision must accept pasted dataUrl/base64 as media source')
    ctx.assert.ok(renderer.includes('probeMediaAspectFromUrl') && renderer.includes('naturalWidth'), 'frontend must probe image natural size when backend omits width/height')
    ctx.assert.ok(renderer.includes('sampleLogoPrismPoints') && renderer.includes('minX'), 'prism logo sampling must crop transparent padding before normalizing points')
    ctx.assert.ok(renderer.includes('thumbnailWidth') && renderer.includes('thumbnailHeight'), 'completed media stage must accept thumbnail dimensions as aspect fallback')
    ctx.assert.ok(renderer.includes('white-space') && renderer.includes('nodeType === 3'), 'normalizeMediaCardLayout must strip blank text nodes and force white-space normal')
    ctx.assert.ok(renderer.includes('<div class="tool-media-stage is-pending"') && !renderer.includes('\n        <div class="tool-media-stage is-pending"'), 'pending media stage HTML must be compact single-line to avoid pre-wrap gaps')
    ctx.assert.ok(renderer.includes("if (!card?.classList.contains('tool-media-card')) return"), 'media layout normalization must reject ordinary tool cards')
    ctx.assert.ok(renderer.includes('if (mediaStageHtml) normalizeMediaCardLayout(card)'), 'pending ordinary tools must not enter media layout normalization')
    ctx.assert.ok(renderer.includes('resetNonMediaCardLayout(card)'), 'completed ordinary tools must clear stale media-only inline styles')

    const sandbox = {
      window: {},
      document: { addEventListener() {} },
      navigator: { clipboard: { writeText: async () => {} } },
      requestAnimationFrame(callback) { callback() },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      HtmlUtils: { escapeHtml: value => String(value || '') },
      FormatUtils: { formatElapsedSeconds: value => String(value || 0) },
      console
    }
    vm.runInNewContext(messageUi, sandbox, { filename: 'ai-message-ui.js' })
    const list = {
      classList: createClassList(),
      querySelector() { return null }
    }
    const group = {
      classList: createClassList(['tool-call-group', 'tool-media-group']),
      dataset: {},
      querySelector(selector) { return selector === '.tool-group-list' ? list : null }
    }
    const attributes = {}
    const header = {
      closest(selector) { return selector === '.tool-call-group' ? group : null },
      setAttribute(name, value) { attributes[name] = value }
    }
    sandbox.window.AiMessageUI.toggleToolGroup(header)
    ctx.assert.ok(list.classList.contains('collapsed'), 'clicking an expanded media header must collapse its media list')
    ctx.assert.ok(group.classList.contains('media-collapsed'), 'collapsed media group must enter its compact grid state')
    ctx.assert.equal(attributes['aria-expanded'], 'false', 'media header must expose its collapsed state')
    sandbox.window.AiMessageUI.toggleToolGroup(header)
    ctx.assert.ok(!list.classList.contains('collapsed'), 'clicking the media header again must restore its content')
    ctx.assert.equal(attributes['aria-expanded'], 'true', 'media header must expose its expanded state')

    ctx.assert.ok(chat.includes("name: 'inspect_image'"), 'vision relay must publish the same visual tool lifecycle')
    ctx.assert.ok(chat.includes("id: `vision-relay-${requestId}`"), 'vision relay lifecycle must use a stable request-scoped tool id')
    ctx.assert.ok(chat.includes("message: '视觉分析完成'"), 'successful relay analysis must resolve the pending stage')
    ctx.assert.ok(chat.includes("error: err.message || '视觉分析失败'"), 'failed relay analysis must resolve the pending stage as an error')
    ctx.assert.ok(chat.includes('probeImageDimensions') && chat.includes('width: visionRelayToolUi.width'), 'vision relay complete result must publish image dimensions for stage aspect ratio')
    ctx.assert.ok(chat.includes('dataUrl: firstVisionPreview'), 'vision relay tool-start must publish dataUrl so pending stage can render pasted images')
  }
}
