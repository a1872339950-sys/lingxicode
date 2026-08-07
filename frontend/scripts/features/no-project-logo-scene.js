(function () {
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const LOGO_SRC = 'assets/brand/lingxi-logo-transparent.png'

  function createFallback(host) {
    host.classList.add('is-fallback')
    host.innerHTML = `<img class="no-project-logo-fallback" src="${LOGO_SRC}" alt="">`
    return {
      setPointer() {},
      setActive() {},
      destroy() {
        host.innerHTML = ''
        host.classList.remove('is-fallback')
      }
    }
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed')
    }
    return shader
  }

  function createProgram(gl) {
    const vertex = createShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 aTarget;
      attribute vec2 aScatter;
      attribute float aSeed;
      uniform float uTime;
      uniform float uForm;
      uniform float uPointer;
      uniform vec2 uPointerPos;
      void main() {
        float ease = 1.0 - pow(1.0 - uForm, 3.0);
        vec2 drift = vec2(
          sin(uTime * 0.68 + aSeed * 17.0),
          cos(uTime * 0.54 + aSeed * 21.0)
        ) * 0.014;
        vec2 formed = aTarget + drift * (1.0 - ease * 0.78);
        vec2 pos = mix(aScatter, formed, ease);

        vec2 delta = pos - uPointerPos;
        float dist = length(delta) + 0.001;
        float pull = uPointer * smoothstep(0.72, 0.08, dist) * 0.08;
        pos -= normalize(delta) * pull;

        gl_Position = vec4(pos, 0.0, 1.0);
        gl_PointSize = mix(1.15, 2.9, ease) + sin(uTime * 1.7 + aSeed * 28.0) * 0.28 + uPointer * 0.25;
      }
    `)
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform float uAlpha;
      uniform float uActive;
      uniform vec3 uBaseColor;
      uniform vec3 uBrightColor;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float glow = smoothstep(0.5, 0.05, length(p));
        vec3 color = mix(uBaseColor, uBrightColor, uActive * 0.55);
        gl_FragColor = vec4(color, glow * uAlpha);
      }
    `)
    const program = gl.createProgram()
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program link failed')
    }
    return program
  }

  function sampleLogo(src, count = 980) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        const size = 192
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          reject(new Error('2d context unavailable'))
          return
        }
        // 透明底采样，避免浅色主题下把半透明边缘裁坏
        ctx.clearRect(0, 0, size, size)
        const pad = 18
        ctx.drawImage(image, pad, pad, size - pad * 2, size - pad * 2)
        const pixels = ctx.getImageData(0, 0, size, size).data
        const candidates = []
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const alpha = pixels[(y * size + x) * 4 + 3]
            // 只取主体像素，过滤掉极淡边缘噪点
            if (alpha > 90) candidates.push([x, y])
          }
        }
        if (!candidates.length) {
          reject(new Error('logo sample empty'))
          return
        }
        const points = []
        for (let i = 0; i < count; i++) {
          const point = candidates[Math.floor(Math.random() * candidates.length)]
          points.push((point[0] / size) * 1.42 - 0.71, 0.71 - (point[1] / size) * 1.42)
        }
        resolve(new Float32Array(points))
      }
      image.onerror = reject
      image.src = src
    })
  }

  async function mount(host) {
    if (!host) return { setPointer() {}, setActive() {}, destroy() {} }
    if (REDUCED_MOTION?.matches) return createFallback(host)

    const canvas = document.createElement('canvas')
    canvas.className = 'no-project-logo-canvas'
    host.classList.remove('is-fallback')
    host.replaceChildren(canvas)

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
      premultipliedAlpha: true
    })
    if (!gl) return createFallback(host)

    try {
      const targets = await sampleLogo(LOGO_SRC)
      if (!host.isConnected) return { setPointer() {}, setActive() {}, destroy() {} }

      const count = targets.length / 2
      const scatter = new Float32Array(targets.length)
      const seeds = new Float32Array(count)
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const radius = 0.78 + Math.random() * 0.72
        scatter[i * 2] = Math.cos(angle) * radius
        scatter[i * 2 + 1] = Math.sin(angle) * radius
        seeds[i] = Math.random()
      }

      const program = createProgram(gl)
      gl.useProgram(program)
      const bind = (name, data, size) => {
        const buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
        const location = gl.getAttribLocation(program, name)
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
        return buffer
      }
      const buffers = [
        bind('aTarget', targets, 2),
        bind('aScatter', scatter, 2),
        bind('aSeed', seeds, 1)
      ]
      const uniforms = Object.fromEntries(
        ['uTime', 'uForm', 'uPointer', 'uPointerPos', 'uAlpha', 'uActive', 'uBaseColor', 'uBrightColor']
          .map(name => [name, gl.getUniformLocation(program, name)])
      )

      function parseCssColor(value, fallback = [0.12, 0.84, 0.72]) {
        const text = String(value || '').trim()
        const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
        if (hex) {
          let h = hex[1]
          if (h.length === 3) h = h.split('').map(ch => ch + ch).join('')
          return [
            parseInt(h.slice(0, 2), 16) / 255,
            parseInt(h.slice(2, 4), 16) / 255,
            parseInt(h.slice(4, 6), 16) / 255
          ]
        }
        const rgb = text.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
        if (rgb) {
          return [
            Math.max(0, Math.min(1, Number(rgb[1]) / 255)),
            Math.max(0, Math.min(1, Number(rgb[2]) / 255)),
            Math.max(0, Math.min(1, Number(rgb[3]) / 255))
          ]
        }
        return fallback
      }

      function readThemeColors() {
        const styles = getComputedStyle(host)
        const base = parseCssColor(
          styles.getPropertyValue('--welcome-logo-accent') ||
          getComputedStyle(document.documentElement).getPropertyValue('--accent-primary'),
          [0.02, 0.71, 0.83]
        )
        const bright = parseCssColor(
          styles.getPropertyValue('--welcome-logo-accent-soft') ||
          getComputedStyle(document.documentElement).getPropertyValue('--accent-light'),
          [0.13, 0.83, 0.93]
        )
        return { base, bright }
      }

      const started = performance.now()
      let frame = 0
      let destroyed = false
      let pointerStrength = 0
      let targetPointer = 0
      let activeStrength = 0
      let targetActive = 0
      let pointerX = 0
      let pointerY = 0
      let targetPointerX = 0
      let targetPointerY = 0
      let themeColors = readThemeColors()

      function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const width = Math.max(1, Math.round(host.clientWidth * ratio))
        const height = Math.max(1, Math.round(host.clientHeight * ratio))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
          gl.viewport(0, 0, width, height)
        }
      }

      function draw(now) {
        if (destroyed) return
        if (!host.isConnected) {
          destroyed = true
          cancelAnimationFrame(frame)
          return
        }
        resize()
        // 每帧轻量读取主题色，切换明暗/强调色时自动跟随
        if ((Math.floor(now / 400) % 3) === 0) themeColors = readThemeColors()
        const elapsed = (now - started) / 1000
        const form = Math.min(1, (now - started) / 1100)
        pointerStrength += (targetPointer - pointerStrength) * 0.08
        activeStrength += (targetActive - activeStrength) * 0.1
        pointerX += (targetPointerX - pointerX) * 0.12
        pointerY += (targetPointerY - pointerY) * 0.12

        const lightMode = document.documentElement.getAttribute('data-theme-mode') === 'light'
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.enable(gl.BLEND)
        // 浅色主题用常规透明混合，避免粒子叠成发白/变形
        if (lightMode) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        else gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
        gl.uniform1f(uniforms.uTime, elapsed)
        gl.uniform1f(uniforms.uForm, form)
        gl.uniform1f(uniforms.uPointer, pointerStrength)
        gl.uniform2f(uniforms.uPointerPos, pointerX, pointerY)
        gl.uniform1f(uniforms.uAlpha, (lightMode ? 0.84 : 0.92) + activeStrength * 0.08)
        gl.uniform1f(uniforms.uActive, activeStrength)
        gl.uniform3f(uniforms.uBaseColor, themeColors.base[0], themeColors.base[1], themeColors.base[2])
        gl.uniform3f(uniforms.uBrightColor, themeColors.bright[0], themeColors.bright[1], themeColors.bright[2])
        gl.drawArrays(gl.POINTS, 0, count)
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)

      return {
        setPointer(next = {}) {
          targetPointer = Math.max(0, Math.min(1, Number(next.strength) || 0))
          if (Number.isFinite(next.x)) targetPointerX = Math.max(-1, Math.min(1, next.x))
          if (Number.isFinite(next.y)) targetPointerY = Math.max(-1, Math.min(1, next.y))
        },
        setActive(active) {
          targetActive = active ? 1 : 0
          host.dataset.sceneState = active ? 'active' : 'idle'
        },
        destroy() {
          destroyed = true
          cancelAnimationFrame(frame)
          buffers.forEach(buffer => gl.deleteBuffer(buffer))
          gl.deleteProgram(program)
          host.innerHTML = ''
          host.classList.remove('is-fallback')
          delete host.dataset.sceneState
        }
      }
    } catch (error) {
      console.warn('[NoProjectLogoScene] WebGL scene unavailable:', error)
      return createFallback(host)
    }
  }

  window.NoProjectLogoScene = { mount }
})()
