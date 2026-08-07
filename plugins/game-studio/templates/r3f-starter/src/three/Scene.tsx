import { useFrame } from '@react-three/fiber'
import { getGameState, useGameStore } from '../game/store'

/** 薄场景：读 store、画物体；规则在 store.tick */
export function Scene() {
  const spin = useGameStore((s) => s.spin)

  useFrame((_, dt) => {
    getGameState().tick(dt)
  })

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[6, 48]} />
        <meshStandardMaterial color="#1f2430" roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.45 + Math.sin(spin * 2) * 0.08, 0]} rotation={[0, spin, 0]}>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshStandardMaterial color="#88c0d0" roughness={0.35} metalness={0.1} />
      </mesh>
    </group>
  )
}
