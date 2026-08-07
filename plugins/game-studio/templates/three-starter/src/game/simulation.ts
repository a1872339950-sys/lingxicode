/** 纯模拟：可序列化玩法状态（与渲染对象分离） */
export type SimState = {
  t: number
  spin: number
}

export type SimSnapshot = {
  spin: number
}

export function createSim() {
  const state: SimState = { t: 0, spin: 0 }

  return {
    step(dt: number) {
      state.t += dt
      state.spin += dt * 1.2
    },
    snapshot(_alpha = 0): SimSnapshot {
      return { spin: state.spin }
    },
    /** 调试/存档用 */
    serialize(): SimState {
      return { ...state }
    }
  }
}
