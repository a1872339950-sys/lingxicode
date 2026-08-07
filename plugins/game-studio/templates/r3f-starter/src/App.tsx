import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useGameStore } from './game/store'
import { Scene } from './three/Scene'
import { Hud } from './ui/Hud'

/** React 宿主：DOM UI + Canvas；玩法状态在 store */
export function App() {
  const paused = useGameStore((s) => s.paused)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Hud />
      <Canvas
        camera={{ position: [3.2, 2.4, 4.2], fov: 50 }}
        style={{ width: '100%', height: '100%' }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#0b0c10']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 6, 2]} intensity={1.1} />
        <Scene />
        <OrbitControls enabled={!paused} makeDefault />
      </Canvas>
    </div>
  )
}
