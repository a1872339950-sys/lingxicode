import { useGameStore } from '../game/store'

/** DOM HUD：不挡玩法区中心 */
export function Hud() {
  const score = useGameStore((s) => s.score)
  const paused = useGameStore((s) => s.paused)
  const bump = useGameStore((s) => s.bump)
  const togglePause = useGameStore((s) => s.togglePause)
  const reset = useGameStore((s) => s.reset)

  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        top: 12,
        zIndex: 10,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: 10,
        background: 'rgba(0,0,0,.5)',
        border: '1px solid rgba(255,255,255,.12)',
        fontSize: 13
      }}
    >
      <span>分数 {score}</span>
      <button type="button" onClick={bump}>
        +1
      </button>
      <button type="button" onClick={togglePause}>
        {paused ? '继续' : '暂停'}
      </button>
      <button type="button" onClick={reset}>
        重置
      </button>
      <span style={{ opacity: 0.75 }}>拖拽旋转 · 暂停时锁轨道</span>
    </div>
  )
}
