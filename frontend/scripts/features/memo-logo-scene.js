(function () {
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)')

  function createFallback(host) {
    host.classList.add('is-fallback')
    host.innerHTML = '<img class="memo-logo-fallback" src="assets/brand/lingxi-logo-transparent.png" alt="">'
    return { setState() {}, destroy() { host.innerHTML = '' } }
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
    return shader
  }

  function createProgram(gl) {
    const vertex = createShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 aTarget;
      attribute vec2 aScatter;
      attribute float aSeed;
      uniform float uTime;
      uniform float uForm;
      uniform float uBurst;
      uniform float uError;
      void main() {
        float ease = 1.0 - pow(1.0 - uForm, 3.0);
        vec2 drift = vec2(sin(uTime * .72 + aSeed * 19.0), cos(uTime * .58 + aSeed * 23.0)) * .012;
        vec2 pos = mix(aScatter, aTarget + drift * (1.0 - ease * .82), ease);
        pos += normalize(aTarget + vec2(.001)) * uBurst * (.22 + aSeed * .28);
        gl_Position = vec4(pos, 0.0, 1.0);
        gl_PointSize = mix(1.2, 2.75, ease) + sin(uTime * 1.8 + aSeed * 30.0) * .3;
      }
    `)
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform float uAlpha;
      uniform float uError;
      void main() {
        vec2 p = gl_PointCoord - .5;
        float glow = smoothstep(.5, .04, length(p));
        vec3 calm = vec3(.10, .82, .68);
        vec3 warning = vec3(.95, .38, .28);
        gl_FragColor = vec4(mix(calm, warning, uError), glow * uAlpha);
      }
    `)
    const program = gl.createProgram()
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    return program
  }

  function sampleLogo(src, count = 560) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        const size = 128
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(image, 10, 10, size - 20, size - 20)
        const pixels = ctx.getImageData(0, 0, size, size).data
        const candidates = []
        for (let y = 0; y < size; y += 2) {
          for (let x = 0; x < size; x += 2) {
            if (pixels[(y * size + x) * 4 + 3] > 56) candidates.push([x, y])
          }
        }
        const points = []
        for (let i = 0; i < count; i++) {
          const point = candidates[Math.floor(Math.random() * candidates.length)] || [size / 2, size / 2]
          points.push((point[0] / size) * 1.5 - .75, .75 - (point[1] / size) * 1.5)
        }
        resolve(new Float32Array(points))
      }
      image.onerror = reject
      image.src = src
    })
  }

  async function mount(host) {
    if (!host || REDUCED_MOTION?.matches) return createFallback(host)
    const canvas = document.createElement('canvas')
    canvas.className = 'memo-logo-canvas'
    host.replaceChildren(canvas)
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power' })
    if (!gl) return createFallback(host)

    try {
      const targets = await sampleLogo('assets/brand/lingxi-logo-transparent.png')
      if (!host.isConnected) return { setState() {}, destroy() {} }
      const count = targets.length / 2
      const scatter = new Float32Array(targets.length)
      const seeds = new Float32Array(count)
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const radius = .82 + Math.random() * .65
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
      const buffers = [bind('aTarget', targets, 2), bind('aScatter', scatter, 2), bind('aSeed', seeds, 1)]
      const uniforms = Object.fromEntries(['uTime', 'uForm', 'uBurst', 'uAlpha', 'uError'].map(name => [name, gl.getUniformLocation(program, name)]))
      const started = performance.now()
      let frame = 0
      let state = 'idle'
      let stateAt = started
      let destroyed = false

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
        resize()
        const elapsed = (now - started) / 1000
        const phase = Math.min(1, (now - started) / 1050)
        const actionPhase = Math.min(1, (now - stateAt) / 430)
        const saving = state === 'save'
        const dismissing = state === 'dismiss'
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
        gl.uniform1f(uniforms.uTime, elapsed)
        gl.uniform1f(uniforms.uForm, saving ? 1 + actionPhase * .08 : dismissing ? 1 - actionPhase : phase)
        gl.uniform1f(uniforms.uBurst, dismissing ? actionPhase : 0)
        gl.uniform1f(uniforms.uAlpha, dismissing ? 1 - actionPhase : 1)
        gl.uniform1f(uniforms.uError, state === 'error' ? .9 : 0)
        gl.drawArrays(gl.POINTS, 0, count)
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)

      return {
        setState(next) {
          state = next || 'idle'
          stateAt = performance.now()
          host.dataset.sceneState = state
        },
        destroy() {
          destroyed = true
          cancelAnimationFrame(frame)
          buffers.forEach(buffer => gl.deleteBuffer(buffer))
          gl.deleteProgram(program)
          host.innerHTML = ''
        }
      }
    } catch (error) {
      console.warn('[MemoLogoScene] WebGL scene unavailable:', error)
      return createFallback(host)
    }
  }

  window.MemoLogoScene = { mount }
})()