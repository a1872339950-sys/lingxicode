/** 纯玩法：根据输入与是否着地计算速度意图（示例级） */
export type MotionInput = { left: boolean; right: boolean; jump: boolean }
export type MotionState = { onGround: boolean; vx: number; vy: number }

export function stepMotion(state: MotionState, input: MotionInput, dt = 1): MotionState {
  const speed = 220
  let vx = 0
  if (input.left) vx -= speed
  if (input.right) vx += speed
  let vy = state.vy
  if (input.jump && state.onGround) vy = -420
  return { ...state, vx, vy }
}
