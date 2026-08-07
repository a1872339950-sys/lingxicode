type LoopHooks = {
  fixedDt: number
  onFixed: (dt: number) => void
  onFrame: (alpha: number) => void
}

/** 固定步模拟 + rAF 渲染 */
export function createLoop(hooks: LoopHooks) {
  let raf = 0
  let acc = 0
  let last = 0
  let running = false

  function frame(now: number) {
    if (!running) return
    if (!last) last = now
    const raw = Math.min(0.05, (now - last) / 1000)
    last = now
    acc += raw
    while (acc >= hooks.fixedDt) {
      hooks.onFixed(hooks.fixedDt)
      acc -= hooks.fixedDt
    }
    hooks.onFrame(acc / hooks.fixedDt)
    raf = requestAnimationFrame(frame)
  }

  return {
    start() {
      if (running) return
      running = true
      last = 0
      acc = 0
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    }
  }
}
