import { createApp } from './three/app'
import { createSim } from './game/simulation'
import { createLoop } from './game/loop'

const canvasHost = document.body
const app = createApp(canvasHost)
const sim = createSim()
const loop = createLoop({
  fixedDt: 1 / 60,
  onFixed: (dt) => sim.step(dt),
  onFrame: (alpha) => app.render(sim.snapshot(alpha))
})

app.bindInput({
  onResetCamera: () => app.resetCamera()
})

loop.start()

window.addEventListener('beforeunload', () => {
  loop.stop()
  app.dispose()
})
