import * as THREE from 'three'
import type { SimSnapshot } from '../game/simulation'

/** 渲染层：场景图与相机，不拥有玩法规则 */
export function createApp(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0c10)

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
  const defaultCam = new THREE.Vector3(3.2, 2.4, 4.2)
  camera.position.copy(defaultCam)
  camera.lookAt(0, 0.4, 0)

  const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x222233, 1.1)
  scene.add(hemi)
  const dir = new THREE.DirectionalLight(0xffffff, 1.2)
  dir.position.set(4, 6, 2)
  scene.add(dir)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.9, metalness: 0.05 })
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const player = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x88c0d0, roughness: 0.35, metalness: 0.1 })
  )
  player.position.y = 0.45
  scene.add(player)

  // 简易轨道：拖拽旋转、滚轮缩放
  let dragging = false
  let lx = 0
  let ly = 0
  let theta = 0.7
  let phi = 0.9
  let radius = 5.5

  function syncCamera() {
    camera.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    )
    camera.lookAt(0, 0.4, 0)
  }
  syncCamera()

  const onPointerDown = (e: PointerEvent) => {
    dragging = true
    lx = e.clientX
    ly = e.clientY
  }
  const onPointerUp = () => {
    dragging = false
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - lx
    const dy = e.clientY - ly
    lx = e.clientX
    ly = e.clientY
    theta += dx * 0.01
    phi = Math.min(Math.max(0.15, phi - dy * 0.01), Math.PI - 0.15)
    syncCamera()
  }
  const onWheel = (e: WheelEvent) => {
    radius = Math.min(12, Math.max(2.5, radius + e.deltaY * 0.01))
    syncCamera()
  }
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('resize', onResize)

  return {
    bindInput(handlers: { onResetCamera: () => void }) {
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
          e.preventDefault()
          handlers.onResetCamera()
        }
      })
    },
    resetCamera() {
      theta = 0.7
      phi = 0.9
      radius = 5.5
      syncCamera()
    },
    render(snap: SimSnapshot) {
      player.rotation.y = snap.spin
      player.position.y = 0.45 + Math.sin(snap.spin * 2) * 0.08
      renderer.render(scene, camera)
    },
    dispose() {
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }
}
