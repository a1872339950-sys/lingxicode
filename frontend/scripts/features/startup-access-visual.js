import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Raycaster,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const CONFIG = {
  count: 24,
  cameraZ: 18,
  fieldPadding: 1.25,
  pointerRadius: 2.9,
  pointerForce: 24,
  attraction: 2.15,
  damping: 0.928,
  collisionBounce: 0.36,
  maxSpeed: 4.4
}

const CAPABILITY_FAMILIES = [
  { name: 'reasoning', color: '#e2e8f0', kind: 'prism', scale: [1, 1, 0.72] },
  { name: 'memory', color: '#a78bfa', kind: 'ring', scale: [1, 1, 0.78] },
  { name: 'vision', color: '#8b5cf6', kind: 'crystal', scale: [0.94, 0.94, 0.58] },
  { name: 'tools', color: '#22d3ee', kind: 'chip', scale: [0.94, 0.94, 0.82] },
  { name: 'workflow', color: '#38bdf8', kind: 'capsule', scale: [0.82, 1.08, 0.56] }
]

const state = {
  canvas: null,
  renderer: null,
  scene: null,
  camera: null,
  meshes: [],
  geometries: [],
  materials: [],
  rayPlane: null,
  rayGeometry: null,
  rayMaterial: null,
  rayUniforms: null,
  environment: null,
  items: [],
  frameId: 0,
  running: false,
  startedAt: 0,
  lastTime: 0,
  width: 1,
  height: 1,
  worldWidth: 1,
  worldHeight: 1,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true,
  pointer: {
    screen: new Vector2(2, 2),
    world: new Vector3(999, 999, 0),
    active: false,
    pulse: 0
  },
  raycaster: new Raycaster(),
  interactionPlane: new Plane(new Vector3(0, 0, 1), 0),
  resizeObserver: null,
  listenersBound: false,
  seed: 0x5f3759df
}

const dummy = new Object3D()
const delta = new Vector3()
const force = new Vector3()
const tangent = new Vector3()
const origin = new Vector3()

function random() {
  state.seed = (1664525 * state.seed + 1013904223) >>> 0
  return state.seed / 4294967296
}

function randomRange(min, max) {
  return min + (max - min) * random()
}

function getThemeColors() {
  const styles = getComputedStyle(document.documentElement)
  const accentText = styles.getPropertyValue('--accent-primary').trim() || '#22d3ee'
  const accent = new Color(accentText)
  return CAPABILITY_FAMILIES.map((family, index) => {
    const color = new Color(family.color)
    if (index === 1) color.lerp(accent, 0.58)
    if (index === 2) color.lerp(accent, 0.16)
    return color
  })
}

function createRenderer(canvas) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance'
  })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.24
  renderer.setClearColor(0x05070d, 1)
  renderer.setPixelRatio(Math.min(1.65, Math.max(1, window.devicePixelRatio || 1)))
  return renderer
}

function createEnvironment(renderer) {
  const environmentScene = new RoomEnvironment()
  const generator = new PMREMGenerator(renderer)
  const texture = generator.fromScene(environmentScene, 0.04).texture
  environmentScene.dispose?.()
  generator.dispose()
  return texture
}

function createLightRays() {
  const colors = getThemeColors()
  const uniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uMouse: { value: new Vector2(0.5, 0.5) },
    uColorA: { value: colors[1].clone() },
    uColorB: { value: colors[2].clone() },
    uIntensity: { value: 0.58 }
  }
  const geometry = new PlaneGeometry(2, 2)
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uAspect;
      uniform vec2 uMouse;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uIntensity;

      float hash21(vec2 point) {
        point = fract(point * vec2(123.34, 345.45));
        point += dot(point, point + 34.345);
        return fract(point.x * point.y);
      }

      float softRay(vec2 uv, vec2 source, float direction, float width, float drift) {
        vec2 delta = uv - source;
        float angle = atan(delta.x * uAspect, -delta.y);
        float angularDistance = abs(angle - direction - drift);
        float cone = exp(-pow(angularDistance / max(width, 0.001), 1.55));
        float distanceFade = 1.0 - smoothstep(0.08, 1.34, length(vec2(delta.x * uAspect, delta.y)));
        float verticalGate = smoothstep(0.02, 0.24, source.y - uv.y);
        return cone * distanceFade * verticalGate;
      }

      void main() {
        vec2 uv = vUv;
        vec2 source = vec2(0.5 + (uMouse.x - 0.5) * 0.08, 1.12);
        float mouseDrift = (uMouse.x - 0.5) * 0.1;
        float slowDrift = sin(uTime * 0.24) * 0.018;
        float rayA = softRay(uv, source, -0.32, 0.085, mouseDrift + slowDrift);
        float rayB = softRay(uv, source, 0.01, 0.06, mouseDrift * 0.65 - slowDrift * 0.6);
        float rayC = softRay(uv, source, 0.3, 0.1, mouseDrift - slowDrift);
        float grain = mix(0.93, 1.06, hash21(floor(uv * 180.0) + floor(uTime * 2.0)));
        float edgeFade = smoothstep(0.0, 0.18, uv.x) * smoothstep(0.0, 0.18, 1.0 - uv.x);
        float strength = (rayA * 0.72 + rayB * 0.54 + rayC * 0.62) * grain * edgeFade * uIntensity;
        vec3 color = mix(uColorA, uColorB, clamp(uv.x * 0.78 + rayC * 0.2, 0.0, 1.0));
        gl_FragColor = vec4(color * strength, 1.0);
      }
    `
  })
  const plane = new Mesh(geometry, material)
  plane.position.z = -6
  plane.renderOrder = -10
  state.rayPlane = plane
  state.rayGeometry = geometry
  state.rayMaterial = material
  state.rayUniforms = uniforms
  state.scene.add(plane)
}

function updateLightRayPlane() {
  if (!state.rayPlane || !state.camera) return
  const distance = state.camera.position.z - state.rayPlane.position.z
  const height = 2 * Math.tan(MathUtils.degToRad(state.camera.fov) / 2) * distance
  const width = height * state.camera.aspect
  state.rayPlane.scale.set(width / 2, height / 2, 1)
  state.rayUniforms.uAspect.value = state.camera.aspect
}

function updateLightRays(elapsed) {
  if (!state.rayUniforms) return
  const targetX = state.pointer.active ? state.pointer.screen.x * 0.5 + 0.5 : 0.5
  const targetY = state.pointer.active ? state.pointer.screen.y * -0.5 + 0.5 : 0.5
  state.rayUniforms.uMouse.value.x = MathUtils.lerp(state.rayUniforms.uMouse.value.x, targetX, 0.035)
  state.rayUniforms.uMouse.value.y = MathUtils.lerp(state.rayUniforms.uMouse.value.y, targetY, 0.035)
  state.rayUniforms.uTime.value = state.reducedMotion ? 0 : elapsed
}

function createSceneObjects() {
  const colors = getThemeColors()
  const counts = CAPABILITY_FAMILIES.map((_, familyIndex) => (
    Math.floor(CONFIG.count / CAPABILITY_FAMILIES.length) + (familyIndex < CONFIG.count % CAPABILITY_FAMILIES.length ? 1 : 0)
  ))
  const createGeometry = kind => {
    let geometry
    if (kind === 'prism') {
      geometry = new CylinderGeometry(0.54, 0.54, 0.24, 3, 1, false)
      geometry.rotateX(Math.PI / 2)
    } else if (kind === 'ring') {
      geometry = new TorusGeometry(0.43, 0.105, 10, 28)
    } else if (kind === 'crystal') {
      geometry = new OctahedronGeometry(0.55, 0)
    } else if (kind === 'capsule') {
      geometry = new CapsuleGeometry(0.2, 0.58, 5, 10)
    } else {
      geometry = new RoundedBoxGeometry(0.9, 0.9, 0.24, 4, 0.16)
    }
    geometry.center()
    return geometry
  }

  state.meshes = CAPABILITY_FAMILIES.map((family, familyIndex) => {
    const geometry = createGeometry(family.kind)
    const surfaceColor = colors[familyIndex].clone().lerp(new Color('#e8f0f7'), familyIndex === 0 ? 0.34 : 0.2)
    const material = new MeshPhysicalMaterial({
      color: surfaceColor,
      envMap: state.environment,
      metalness: family.kind === 'ring' ? 0.18 : 0.28,
      roughness: family.kind === 'crystal' ? 0.2 : 0.27,
      clearcoat: 1,
      clearcoatRoughness: 0.14,
      reflectivity: 0.82,
      sheen: 0.3,
      sheenRoughness: 0.34,
      emissive: colors[familyIndex].clone().multiplyScalar(0.06),
      emissiveIntensity: 0.3
    })
    const mesh = new InstancedMesh(geometry, material, counts[familyIndex])
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    state.geometries.push(geometry)
    state.materials.push(material)
    state.scene.add(mesh)
    return mesh
  })

  const familyInstanceIndex = CAPABILITY_FAMILIES.map(() => 0)

  state.items = Array.from({ length: CONFIG.count }, (_, index) => {
    const familyIndex = index % CAPABILITY_FAMILIES.length
    const family = CAPABILITY_FAMILIES[familyIndex]
    const baseScale = randomRange(0.66, 1.04)
    const scale = new Vector3(
      baseScale * family.scale[0],
      baseScale * family.scale[1],
      baseScale * family.scale[2]
    )
    const radius = Math.max(scale.x, scale.y) * 0.62
    const item = {
      family: family.name,
      familyIndex,
      color: colors[familyIndex].clone(),
      mesh: state.meshes[familyIndex],
      instanceIndex: familyInstanceIndex[familyIndex]++,
      ring: index % 3,
      phase: (index / CONFIG.count) * Math.PI * 2 + randomRange(-0.16, 0.16),
      drift: randomRange(0.72, 1.3),
      radius,
      scale,
      position: new Vector3(),
      target: new Vector3(),
      velocity: new Vector3(),
      rotation: new Vector3(
        randomRange(-0.42, 0.42),
        randomRange(-0.42, 0.42),
        randomRange(-Math.PI, Math.PI)
      ),
      spin: new Vector3(
        randomRange(-0.06, 0.06),
        randomRange(-0.06, 0.06),
        randomRange(-0.15, 0.15)
      )
    }
    return item
  })
}

function setLighting() {
  state.scene.add(new AmbientLight(0xc7d2e0, 1.4))
  const cyan = new PointLight(0x22d3ee, 76, 32, 1.75)
  cyan.position.set(-6, 4.5, 7)
  const violet = new PointLight(0x6366f1, 68, 30, 1.8)
  violet.position.set(7, -3.5, 6)
  const pearl = new PointLight(0xf8fafc, 56, 28, 1.7)
  pearl.position.set(0, 7.5, 8)
  state.scene.add(cyan, violet, pearl)
}

function updateWorldSize() {
  const fov = MathUtils.degToRad(state.camera.fov)
  state.worldHeight = 2 * Math.tan(fov / 2) * CONFIG.cameraZ
  state.worldWidth = state.worldHeight * state.camera.aspect
}

function updateTargets(time = 0, initialize = false) {
  const halfWidth = state.worldWidth / 2
  const halfHeight = state.worldHeight / 2
  const narrow = state.width < 760
  const clearX = narrow ? Math.min(3.1, halfWidth * 0.46) : Math.min(4.45, halfWidth * 0.39)
  const clearY = narrow ? Math.min(4.25, halfHeight * 0.48) : Math.min(3.4, halfHeight * 0.42)

  state.items.forEach((item, index) => {
    const ringRatio = item.ring / 2
    const angle = item.phase + Math.sin(time * 0.09 + item.phase) * 0.055
    const radiusX = clearX + 1.15 + ringRatio * Math.max(1.3, halfWidth * 0.18)
    const radiusY = clearY + 0.85 + ringRatio * Math.max(0.95, halfHeight * 0.13)
    const wave = Math.sin(item.phase * 2.6 + time * 0.18 * item.drift) * 0.34
    item.target.set(
      Math.cos(angle) * radiusX,
      Math.sin(angle) * radiusY + wave,
      Math.sin(item.phase * 1.7 + time * 0.12) * 1.35
    )

    const maxX = Math.max(1, halfWidth - CONFIG.fieldPadding - item.radius)
    const maxY = Math.max(1, halfHeight - CONFIG.fieldPadding - item.radius)
    item.target.x = MathUtils.clamp(item.target.x, -maxX, maxX)
    item.target.y = MathUtils.clamp(item.target.y, -maxY, maxY)

    if (initialize) {
      const launch = 1.45 + random() * 0.38
      item.position.copy(item.target).multiplyScalar(launch)
      item.position.z += randomRange(-2.5, 2.5)
      item.velocity.set(randomRange(-0.18, 0.18), randomRange(-0.18, 0.18), 0)
      if (index % 4 === 0) item.position.y += Math.sign(item.position.y || 1) * 2.8
    }
  })
}

function resize() {
  if (!state.canvas || !state.renderer || !state.camera) return
  const width = Math.max(1, state.canvas.clientWidth)
  const height = Math.max(1, state.canvas.clientHeight)
  if (width === state.width && height === state.height) return
  state.width = width
  state.height = height
  state.renderer.setPixelRatio(Math.min(1.65, Math.max(1, window.devicePixelRatio || 1)))
  state.renderer.setSize(width, height, false)
  state.camera.aspect = width / height
  state.camera.updateProjectionMatrix()
  updateWorldSize()
  updateLightRayPlane()
  updateTargets(0, state.items.every(item => item.position.lengthSq() === 0))
}

function resolveCollisions() {
  const items = state.items
  for (let i = 0; i < items.length; i += 1) {
    const current = items[i]
    for (let j = i + 1; j < items.length; j += 1) {
      const other = items[j]
      delta.copy(other.position).sub(current.position)
      const minDistance = (current.radius + other.radius) * 0.86
      const distanceSq = delta.lengthSq()
      if (distanceSq <= 0.0001 || distanceSq >= minDistance * minDistance) continue
      const distance = Math.sqrt(distanceSq)
      const overlap = minDistance - distance
      force.copy(delta).multiplyScalar(1 / distance)
      current.position.addScaledVector(force, -overlap * 0.5)
      other.position.addScaledVector(force, overlap * 0.5)
      current.velocity.addScaledVector(force, -CONFIG.collisionBounce * overlap)
      other.velocity.addScaledVector(force, CONFIG.collisionBounce * overlap)
    }
  }
}

function updatePhysics(dt, elapsed) {
  updateTargets(elapsed)
  const pointer = state.pointer
  const pulseBoost = pointer.pulse > 0 ? 1 + pointer.pulse * 1.7 : 1

  state.items.forEach(item => {
    force.copy(item.target).sub(item.position).multiplyScalar(CONFIG.attraction * dt)
    item.velocity.add(force)

    tangent.set(-item.position.y, item.position.x, 0)
    if (tangent.lengthSq() > 0.001) {
      tangent.normalize().multiplyScalar(0.07 * item.drift * dt)
      item.velocity.add(tangent)
    }

    if (pointer.active) {
      delta.copy(item.position).sub(pointer.world)
      const distance = Math.max(0.001, delta.length())
      const influence = CONFIG.pointerRadius + item.radius
      if (distance < influence) {
        const strength = (1 - distance / influence) * CONFIG.pointerForce * pulseBoost * dt
        item.velocity.addScaledVector(delta.normalize(), strength)
      }
    }

    item.velocity.multiplyScalar(Math.pow(CONFIG.damping, dt * 60))
    item.velocity.clampLength(0, CONFIG.maxSpeed)
    item.position.addScaledVector(item.velocity, dt)

    item.rotation.z += item.spin.z * dt
  })

  resolveCollisions()
  pointer.pulse = Math.max(0, pointer.pulse - dt * 2.4)
}

function updateInstances(elapsed) {
  const intro = MathUtils.smoothstep(Math.min(1, elapsed / 2.4), 0, 1)
  state.items.forEach(item => {
    dummy.position.copy(item.position)
    const pointerTiltX = state.pointer.active ? state.pointer.screen.y * 0.08 : 0
    const pointerTiltY = state.pointer.active ? state.pointer.screen.x * 0.08 : 0
    dummy.rotation.set(
      item.rotation.x + Math.sin(elapsed * 0.16 + item.phase) * 0.12 + pointerTiltX,
      item.rotation.y + Math.cos(elapsed * 0.14 + item.phase) * 0.12 + pointerTiltY,
      item.rotation.z
    )
    const breathe = 1 + Math.sin(elapsed * 0.46 + item.phase * 2) * 0.025
    dummy.scale.copy(item.scale).multiplyScalar(breathe * (0.74 + intro * 0.26))
    dummy.updateMatrix()
    item.mesh.setMatrixAt(item.instanceIndex, dummy.matrix)
  })
  state.meshes.forEach(mesh => {
    mesh.instanceMatrix.needsUpdate = true
  })
}

function renderFrame(now) {
  if (!state.renderer || !state.scene || !state.camera) return
  resize()
  const elapsed = Math.max(0, (now - state.startedAt) / 1000)
  const dt = state.lastTime ? Math.min(0.034, (now - state.lastTime) / 1000) : 1 / 60
  state.lastTime = now

  if (!state.reducedMotion) updatePhysics(dt, elapsed)
  updateInstances(elapsed)
  updateLightRays(elapsed)

  const parallaxX = state.pointer.active ? state.pointer.screen.x * 0.34 : 0
  const parallaxY = state.pointer.active ? state.pointer.screen.y * 0.22 : 0
  state.camera.position.x = MathUtils.lerp(state.camera.position.x, parallaxX, 0.035)
  state.camera.position.y = MathUtils.lerp(state.camera.position.y, parallaxY, 0.035)
  state.camera.lookAt(origin)
  state.renderer.render(state.scene, state.camera)
}

function animate(now) {
  if (!state.running) return
  renderFrame(now)
  if (state.reducedMotion) {
    state.running = false
    state.frameId = 0
    return
  }
  state.frameId = requestAnimationFrame(animate)
}

function updatePointer(event) {
  if (!state.canvas || !state.camera) return
  const rect = state.canvas.getBoundingClientRect()
  state.pointer.screen.set(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
  )
  state.raycaster.setFromCamera(state.pointer.screen, state.camera)
  state.raycaster.ray.intersectPlane(state.interactionPlane, state.pointer.world)
  state.pointer.active = true
}

function clearPointer() {
  state.pointer.active = false
  state.pointer.screen.set(0, 0)
}

function pulsePointer(event) {
  updatePointer(event)
  state.pointer.pulse = 1
}

function bindListeners() {
  if (state.listenersBound || !state.canvas) return
  state.listenersBound = true
  state.canvas.addEventListener('pointermove', updatePointer, { passive: true })
  state.canvas.addEventListener('pointerleave', clearPointer, { passive: true })
  state.canvas.addEventListener('pointerdown', pulsePointer, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop()
    else if (document.body.classList.contains('startup-access-active') && !document.getElementById('startupAccessGateway')?.classList.contains('is-auth-mode')) start()
  })
  state.resizeObserver = new ResizeObserver(resize)
  state.resizeObserver.observe(state.canvas.parentElement || state.canvas)
}

function init(canvas = document.getElementById('startupAccessCanvas')) {
  if (!canvas) return false
  if (state.canvas) return state.canvas === canvas
  state.canvas = canvas
  try {
    state.renderer = createRenderer(canvas)
    state.scene = new Scene()
    state.scene.background = new Color(0x05070d)
    state.camera = new PerspectiveCamera(46, 1, 0.1, 80)
    state.camera.position.set(0, 0, CONFIG.cameraZ)
    state.environment = createEnvironment(state.renderer)
    setLighting()
    createLightRays()
    createSceneObjects()
    resize()
    updateTargets(0, true)
    updateInstances(0)
    state.renderer.render(state.scene, state.camera)
    canvas.dataset.visual = 'cognitive-core'
    bindListeners()
    return true
  } catch (error) {
    console.warn('[StartupVisual] cognitive core unavailable:', error)
    canvas.dataset.visual = 'fallback'
    return false
  }
}

function start() {
  if (!state.canvas) init()
  if (!state.renderer || state.running) return
  state.running = true
  state.startedAt = performance.now()
  state.lastTime = 0
  state.frameId = requestAnimationFrame(animate)
}

function stop() {
  state.running = false
  if (state.frameId) cancelAnimationFrame(state.frameId)
  state.frameId = 0
}

function dispose() {
  stop()
  state.resizeObserver?.disconnect()
  state.geometries.forEach(geometry => geometry.dispose())
  state.materials.forEach(material => material.dispose())
  state.meshes.forEach(mesh => state.scene?.remove(mesh))
  state.rayGeometry?.dispose()
  state.rayMaterial?.dispose()
  state.scene?.remove(state.rayPlane)
  state.geometries = []
  state.materials = []
  state.meshes = []
  state.rayPlane = null
  state.rayGeometry = null
  state.rayMaterial = null
  state.rayUniforms = null
  state.environment?.dispose()
  state.renderer?.dispose()
  state.renderer?.forceContextLoss?.()
  state.canvas = null
}

window.StartupAccessVisual = { init, start, stop, dispose }

function autoBoot() {
  const gateway = document.getElementById('startupAccessGateway')
  const canvas = document.getElementById('startupAccessCanvas')
  if (!gateway || !canvas) return
  init(canvas)
  if (document.body.classList.contains('startup-access-active') && !gateway.classList.contains('is-auth-mode')) start()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoBoot, { once: true })
else autoBoot()
